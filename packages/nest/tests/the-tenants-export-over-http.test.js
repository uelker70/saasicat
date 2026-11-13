// `GET billing/export` asked over real HTTP, on both platforms an installation
// runs Nest on (`SC-PRIV-019`). Over HTTP because what these cases rest on is
// the platform's: a `HEAD` is answered by the `GET` handler on both, and the
// operator acting as the tenant is said so by the application's own guard,
// which only a request passing through the guards carries to the route.
//
// The application's guard here works the way the upgrade guide tells an
// application to write it: it names the user and the tenant from the session,
// and asks `TenantAccessService.enforce`, saying where the operator acts.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Inject, Injectable, Module } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import { TenantDataExportController, TenantDataExportService } from '../dist/billing/index.js';
import { TenantAccessModule, TenantAccessService } from '../dist/index.js';
import {
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';

const TENANT_AUTH_GUARDS = Symbol.for('saasicat/nest/TenantAuthGuards');
const SUBSCRIPTION_END_PORT = Symbol.for('saasicat/nest/SubscriptionEndPort');
const TENANT_DATA_EXPORT_PORT = Symbol.for('saasicat/nest/TenantDataExportPort');

const ENDED = new Date('2026-11-30T23:00:00.000Z');
const CONTENT = new TextEncoder().encode('{"notes":[]}');

/** Applies decorators the way the TypeScript compiler would; plain JavaScript has no syntax for them. */
function decorate(target, classDecorators, parameters = []) {
    for (const [index, decorator] of parameters) decorator(target, undefined, index);
    return Reflect.decorate(classDecorators, target);
}

/**
 * The application's own guard: the session names the user, their role and the
 * tenant, and an operator acting as the tenant says so. Then the tenant's state
 * is asked.
 */
class AppAuthGuard {
    constructor(access) {
        this.access = access;
    }

    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        request.user = {
            sub: 'u-1',
            tenantId: 't1',
            email: 'admin@t1.example',
            role: request.headers['x-role'] ?? 'TENANT_ADMIN',
        };
        await this.access.enforce(context, 't1', {
            actingAsOperator: request.headers['x-acting-as-operator'] === 'yes',
        });
        return true;
    }
}
decorate(AppAuthGuard, [Injectable()], [[0, Inject(TenantAccessService)]]);

/** The application's export, recording which tenant it was asked for. */
function exportPort() {
    const askedFor = [];
    return {
        askedFor,
        export: async (tenantId) => {
            askedFor.push(tenantId);
            return { content: CONTENT, mediaType: 'application/json', fileName: 'export.json' };
        },
    };
}

/** The export's route over `ends` and `port`, behind the application's guard. */
function appModule(holds, ends, port) {
    class ExportOverHttpModule {}
    return decorate(ExportOverHttpModule, [
        Module({
            imports: [TenantAccessModule.forRoot({ holds })],
            providers: [
                AppAuthGuard,
                {
                    provide: TENANT_AUTH_GUARDS,
                    useFactory: (guard) => [guard],
                    inject: [AppAuthGuard],
                },
                { provide: SUBSCRIPTION_END_PORT, useValue: ends },
                { provide: TENANT_DATA_EXPORT_PORT, useValue: port },
                TenantDataExportService,
            ],
            controllers: [TenantDataExportController],
        }),
    ]);
}

const PLATFORMS = [
    { name: 'Express', adapter: () => undefined },
    { name: 'Fastify', adapter: () => new FastifyAdapter() },
];

/**
 * Runs `work` once on each platform, against `t1` whose subscription ended and
 * whose end is recorded, with a fresh store and export each time.
 */
async function onEachPlatform(work) {
    for (const platform of PLATFORMS) {
        const holds = new FakeTenantAccessHoldRepository();
        const ends = new FakeSubscriptionEndRepository();
        const port = exportPort();
        await holds.record({
            tenantId: 't1',
            kind: 'ended',
            reference: 'sub-t1',
            note: null,
            since: ENDED,
            recordedBy: 'job:platform:subscription-ends',
        });
        await ends.record({
            tenantId: 't1',
            subscriptionId: 'sub-t1',
            endsAt: ENDED,
            deletesOn: '2026-12-31',
            recordedAt: ENDED,
            recordedBy: 'job:platform:subscription-ends',
        });
        const moduleRef = await Test.createTestingModule({
            imports: [appModule(holds, ends, port)],
        }).compile();
        const app = moduleRef.createNestApplication(platform.adapter(), { logger: false });
        try {
            await app.listen(0, '127.0.0.1');
            const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
            const ask = (method, headers = {}) =>
                fetch(`${base}/billing/export`, { method, headers });
            await work({ on: platform.name, ask, ends, port });
        } finally {
            await app.close();
        }
    }
}

// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe("the tenant's export over HTTP, on Express and on Fastify", () => {
    test('a GET hands the administrator the file and records the download', async () => {
        await onEachPlatform(async ({ on, ask, ends, port }) => {
            const response = await ask('GET');

            assert.equal(response.status, 200, on);
            assert.deepEqual(new Uint8Array(await response.arrayBuffer()), CONTENT, on);
            assert.deepEqual(port.askedFor, ['t1'], on);
            assert.equal(ends.downloads.length, 1, on);
        });
    });

    test('the operator the application says is acting as the tenant is refused, and nothing is asked or recorded', async () => {
        await onEachPlatform(async ({ on, ask, ends, port }) => {
            const response = await ask('GET', { 'x-acting-as-operator': 'yes' });

            assert.equal(response.status, 403, on);
            assert.equal((await response.json()).code, 'TENANT_EXPORT_NOT_FOR_OPERATOR', on);
            assert.deepEqual(port.askedFor, [], `${on}: the application is not asked`);
            assert.deepEqual(ends.downloads, [], `${on}: no download is recorded`);
        });
    });

    test('a user holding SUPER_ADMIN is refused as the operator', async () => {
        await onEachPlatform(async ({ on, ask, port }) => {
            const response = await ask('GET', { 'x-role': 'SUPER_ADMIN' });

            assert.equal(response.status, 403, on);
            assert.equal((await response.json()).code, 'TENANT_EXPORT_NOT_FOR_OPERATOR', on);
            assert.deepEqual(port.askedFor, [], on);
        });
    });

    test('a HEAD is refused with the method the route allows, and asks and records nothing', async () => {
        await onEachPlatform(async ({ on, ask, ends, port }) => {
            const response = await ask('HEAD');

            assert.equal(response.status, 405, on);
            assert.equal(response.headers.get('allow'), 'GET', on);
            assert.deepEqual(port.askedFor, [], `${on}: the application is not asked`);
            assert.deepEqual(ends.downloads, [], `${on}: no download is recorded`);
        });
    });
});
