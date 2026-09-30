// While the lock holds, no tenant request reaches the application — asked over
// real HTTP, on both platforms an installation runs Nest on.
//
// Over HTTP because the three things this depends on are Nest's and the
// platform's, not this package's: the order global guards run in, the status a
// thrown exception becomes, and whether a header set on the response survives
// the exception filter. Express's response and Fastify's reply take a header
// differently, and AutohausPro runs on Fastify.
//
// The application here authenticates the way the example does: a global guard
// registered before the platform, which fills `request.user`. Whether the
// feature guard ran is read off the plan resolver it asks — a request refused
// for maintenance must not have asked it.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Controller, Get, Global, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';

import {
    AllowDuringMaintenance,
    MaintenanceService,
    RequireFeature,
    SaaSiCatModule,
} from '../dist/index.js';
import { FakeMaintenanceWindowPort, OPERATOR, inMinutes } from './helpers/maintenance-windows.js';

/** Applies decorators the way the TypeScript compiler would; plain JavaScript has no syntax for them. */
function decorate(target, classDecorators, methods = {}) {
    for (const [name, decorators] of Object.entries(methods)) {
        const descriptor = Object.getOwnPropertyDescriptor(target.prototype, name);
        Reflect.decorate(decorators, target.prototype, name, descriptor);
    }
    return Reflect.decorate(classDecorators, target);
}

/** Fills `request.user` from a header; rejects nobody, as the platform's guards decide. */
class HeaderAuthGuard {
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const role = request.headers['x-role'];
        if (role) {
            request.user = {
                id: 'u-1',
                email: 'u@example.com',
                platformRole: role,
                tenantId: 't-1',
            };
        }
        return true;
    }
}
decorate(HeaderAuthGuard, [Injectable()]);

class HeaderAuthModule {}
decorate(HeaderAuthModule, [
    Global(),
    Module({
        providers: [HeaderAuthGuard, { provide: APP_GUARD, useExisting: HeaderAuthGuard }],
        exports: [HeaderAuthGuard],
    }),
]);

class PassGuard {
    canActivate() {
        return true;
    }
}
decorate(PassGuard, [Injectable()]);

class NotesController {
    list() {
        return { notes: [] };
    }
}
decorate(NotesController, [Controller('notes')], { list: [Get(), RequireFeature('NOTES')] });

class HealthController {
    health() {
        return { ok: true };
    }
}
decorate(HealthController, [Controller('health'), AllowDuringMaintenance()], { health: [Get()] });

const NOOP = { write: async () => {} };

function appModule(port, resolverCalls) {
    class LockProbeModule {}
    return decorate(LockProbeModule, [
        Module({
            imports: [
                HeaderAuthModule,
                SaaSiCatModule.forRoot({
                    planCatalog: {
                        schemaVersion: 1,
                        app: { name: 'LockProbe' },
                        currency: 'EUR',
                        vatRate: 19,
                        plans: [{ id: 'PRO', features: ['NOTES'], quotas: {} }],
                    },
                    controller: { guards: [PassGuard] },
                    imports: [HeaderAuthModule],
                    discoverySnapshotPath: null,
                    persistence: {
                        capabilities: {
                            transactions: true,
                            pessimisticLocking: true,
                            rowLevelSecurity: false,
                            advisoryLocks: false,
                        },
                        core: {
                            mfa: {},
                            audit: NOOP,
                            // What an installation without row policies binds: the
                            // operator's routes run through it.
                            rlsBypass: { runWithBypass: (work) => work() },
                            transactionRunner: {},
                            maintenanceWindows: port,
                        },
                    },
                    adapters: {
                        planResolver: {
                            async getPlanIdForTenant(tenantId) {
                                resolverCalls.push(tenantId);
                                return 'PRO';
                            },
                        },
                    },
                    maintenance: true,
                }),
            ],
            providers: [PassGuard],
            controllers: [NotesController, HealthController],
        }),
    ]);
}

const PLATFORMS = [
    { name: 'Express', adapter: () => undefined },
    { name: 'Fastify', adapter: () => new FastifyAdapter() },
];

for (const platform of PLATFORMS) {
    describe(`the lock, on ${platform.name}`, () => {
        const port = new FakeMaintenanceWindowPort();
        const resolverCalls = [];
        let app;
        let base;
        let maintenance;

        before(async () => {
            const moduleRef = await Test.createTestingModule({
                imports: [appModule(port, resolverCalls)],
            }).compile();
            app = moduleRef.createNestApplication(platform.adapter(), { logger: false });
            await app.listen(0, '127.0.0.1');
            base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
            maintenance = app.get(MaintenanceService);
        });
        after(async () => {
            await app?.close();
        });

        const get = (path, role) =>
            fetch(`${base}${path}`, { headers: role ? { 'x-role': role } : {} });

        // @requirement SC-OPS-013 — While the lock holds, no tenant request reaches the application
        test('without a lock a tenant request goes through, and its entitlements are read', async () => {
            const response = await get('/notes', 'TENANT_ADMIN');
            assert.equal(response.status, 200);
            assert.equal(resolverCalls.length, 1);
        });

        // @requirement SC-OPS-012 — An operator announces a maintenance window, and tenants see it before it begins
        test('an announced window locks nobody out, and the status says it is coming', async () => {
            const window = await maintenance.announce(
                { startsAt: inMinutes(60), endsAt: inMinutes(90), message: 'Upgrade' },
                OPERATOR,
            );
            assert.equal((await get('/notes', 'TENANT_ADMIN')).status, 200);
            const status = await (await get('/public/maintenance')).json();
            assert.equal(status.state, 'announced');
            assert.equal(status.message, 'Upgrade');
            await maintenance.cancel(window.id, OPERATOR);
        });

        // @requirement SC-OPS-013 — While the lock holds, no tenant request reaches the application
        describe('while the lock holds', () => {
            before(async () => {
                await maintenance.lock({ endsAt: inMinutes(30), message: 'Migrating' }, OPERATOR);
            });

            test('a tenant request is refused with 503, the code and when to try again', async () => {
                const before = resolverCalls.length;
                const response = await get('/notes', 'TENANT_ADMIN');
                assert.equal(response.status, 503);
                const body = await response.json();
                assert.equal(body.code, 'MAINTENANCE');
                assert.equal(body.maintenance.state, 'locked');
                assert.equal(body.maintenance.message, 'Migrating');
                assert.equal(body.maintenance.overrun, false);
                assert.ok(body.params.endsAt, 'the announced end travels beside the code');
                const retryAfter = Number(response.headers.get('retry-after'));
                assert.ok(retryAfter > 1790 && retryAfter <= 1800, `Retry-After ${retryAfter}`);
                assert.equal(resolverCalls.length, before, 'no entitlement was read for it');
            });

            test('a request nobody signed in to is refused for maintenance, not for its sign-in', async () => {
                const response = await get('/notes');
                assert.equal(response.status, 503);
            });

            test('a route the application marks — its health probe — still answers', async () => {
                const response = await get('/health');
                assert.equal(response.status, 200);
            });

            test('the status a tenant’s page reads answers, to nobody in particular', async () => {
                const response = await get('/public/maintenance');
                assert.equal(response.status, 200);
                assert.equal((await response.json()).state, 'locked');
            });

            test('the administration answers the operator', async () => {
                const response = await get('/admin/maintenance', 'SUPER_ADMIN');
                assert.equal(response.status, 200);
                assert.equal((await response.json()).open.status, 'locked');
            });

            test('a platform administrator can try the application before letting tenants in', async () => {
                const response = await get('/notes', 'SUPER_ADMIN');
                assert.equal(response.status, 200);
            });

            test('past its announced end it says so, and asks the client back in a minute', async () => {
                Object.assign(
                    port.windows.find((w) => w.endedAt === null),
                    {
                        endsAt: inMinutes(-1),
                    },
                );
                // What this process remembers is the lock as written; ask afresh.
                await maintenance.overview();
                const response = await get('/notes', 'TENANT_ADMIN');
                assert.equal(response.status, 503);
                assert.equal(response.headers.get('retry-after'), '60');
                assert.equal((await response.json()).maintenance.overrun, true);
            });
        });

        // @requirement SC-OPS-014 — The lock begins and ends when somebody says so, not when the clock does
        test('once unlocked, tenants are back', async () => {
            await maintenance.unlock({}, OPERATOR);
            const response = await get('/notes', 'TENANT_ADMIN');
            assert.equal(response.status, 200);
            assert.deepEqual(await (await get('/public/maintenance')).json(), { state: 'none' });
        });
    });
}
