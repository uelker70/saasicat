// A tenant held back is refused on its next request — asked over real HTTP, on
// both platforms an installation runs Nest on.
//
// The application here checks the way AutohausPro and VereinsFux will: its own
// authentication guard, on the controller, establishes the user and then asks
// `TenantAccessService.enforce`. Over HTTP because what the check rests on is
// Nest's: the method of the request as each platform hands it over, the marks
// read off the handler, and the status a thrown refusal becomes.
//
// A suspension, an overdue invoice and a deletion are recorded straight into
// the store; how each gets there is the business of the change that brings it.

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Controller, Get, Inject, Injectable, Module, Post, UseGuards } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { TenantAccessModule, TenantAccessService, Writes, WritesNothing } from '../dist/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';

/** Applies decorators the way the TypeScript compiler would; plain JavaScript has no syntax for them. */
function decorate(target, classDecorators, methods = {}, parameters = []) {
    for (const [index, decorator] of parameters) decorator(target, undefined, index);
    for (const [name, decorators] of Object.entries(methods)) {
        const descriptor = Object.getOwnPropertyDescriptor(target.prototype, name);
        Reflect.decorate(decorators, target.prototype, name, descriptor);
    }
    return Reflect.decorate(classDecorators, target);
}

/**
 * The application's own guard: the session names the user and the tenant, and
 * an operator acting as the tenant says so. Then the tenant's state is asked.
 */
class AppAuthGuard {
    constructor(access) {
        this.access = access;
    }

    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const tenantId = request.headers['x-tenant'];
        if (!tenantId) return false;
        request.user = { id: 'u-1', tenantId };
        await this.access.enforce(context, tenantId, {
            actingAsOperator: request.headers['x-acting-as-operator'] === 'yes',
        });
        return true;
    }
}
decorate(AppAuthGuard, [Injectable()], {}, [[0, Inject(TenantAccessService)]]);

class NotesController {
    list() {
        return { notes: [] };
    }
    create() {
        return { created: true };
    }
    preview() {
        return { preview: true };
    }
    touch() {
        return { touched: true };
    }
}
decorate(NotesController, [Controller('notes'), UseGuards(AppAuthGuard)], {
    list: [Get()],
    create: [Post()],
    preview: [Post('preview'), WritesNothing()],
    touch: [Get('touch'), Writes()],
});

function appModule(holds) {
    class AccessProbeModule {}
    return decorate(AccessProbeModule, [
        Module({
            imports: [TenantAccessModule.forRoot({ holds })],
            providers: [AppAuthGuard],
            controllers: [NotesController],
        }),
    ]);
}

const SINCE = new Date('2026-11-02T08:30:00.000Z');
const OPERATOR = 'web:ops@example.com:s1';

const PLATFORMS = [
    { name: 'Express', adapter: () => undefined },
    { name: 'Fastify', adapter: () => new FastifyAdapter() },
];

for (const platform of PLATFORMS) {
    // @requirement SC-ADM-052 — A suspended tenant cannot act, and a read-only one writes nothing but a payment
    describe(`a tenant's state on its requests, on ${platform.name}`, () => {
        const holds = new FakeTenantAccessHoldRepository();
        let app;
        let base;

        before(async () => {
            const moduleRef = await Test.createTestingModule({
                imports: [appModule(holds)],
            }).compile();
            app = moduleRef.createNestApplication(platform.adapter(), { logger: false });
            await app.listen(0, '127.0.0.1');
            base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
        });

        after(async () => {
            await app?.close();
        });

        beforeEach(() => {
            holds.holds.length = 0;
        });

        const ask = (method, path, { tenant = 't-1', operator = false } = {}) =>
            fetch(`${base}${path}`, {
                method,
                headers: {
                    'x-tenant': tenant,
                    'x-acting-as-operator': operator ? 'yes' : 'no',
                },
            });
        const hold = (kind, overrides = {}) =>
            holds.record({
                tenantId: 't-1',
                kind,
                reference: kind === 'suspended' ? null : `${kind}-1`,
                note: kind === 'suspended' ? 'Contract under review' : null,
                since: SINCE,
                recordedBy: OPERATOR,
                ...overrides,
            });

        test('an open tenant reads and writes', async () => {
            assert.equal((await ask('GET', '/notes')).status, 200);
            assert.equal((await ask('POST', '/notes')).status, 201);
        });

        test('read-only lets a read through and refuses a write with the reason', async () => {
            await hold('overdue');
            assert.equal((await ask('GET', '/notes')).status, 200);
            const refused = await ask('POST', '/notes');
            assert.equal(refused.status, 403);
            const body = await refused.json();
            assert.equal(body.code, 'TENANT_READ_ONLY');
            assert.deepEqual(body.params.reasons, [
                { kind: 'overdue', since: SINCE.toISOString() },
            ]);
        });

        test('a route marked as writing nothing stays open under read-only, a writing GET does not', async () => {
            await hold('ended');
            assert.equal((await ask('POST', '/notes/preview')).status, 201);
            const touched = await ask('GET', '/notes/touch');
            assert.equal(touched.status, 403);
            assert.equal((await touched.json()).code, 'TENANT_READ_ONLY');
        });

        test('a suspension refuses reading too, and the operator note stays with the operator', async () => {
            await hold('suspended');
            const refused = await ask('GET', '/notes');
            assert.equal(refused.status, 403);
            const text = await refused.text();
            assert.equal(JSON.parse(text).code, 'TENANT_SUSPENDED');
            assert.ok(!text.includes('Contract under review'), 'the note is not in the refusal');
        });

        test('a session opened before the state changed is held to it on its next request', async () => {
            assert.equal((await ask('POST', '/notes')).status, 201);
            await hold('suspended');
            assert.equal((await ask('POST', '/notes')).status, 403);
        });

        test('lifting the suspension leaves an overdue invoice holding', async () => {
            const suspension = await hold('suspended');
            await hold('overdue');
            assert.equal((await (await ask('GET', '/notes')).json()).code, 'TENANT_SUSPENDED');
            await holds.lift(suspension.id, new Date(), OPERATOR);
            assert.equal((await ask('GET', '/notes')).status, 200);
            assert.equal((await (await ask('POST', '/notes')).json()).code, 'TENANT_READ_ONLY');
        });

        test('another tenant is not held back by this one', async () => {
            await hold('suspended');
            assert.equal((await ask('POST', '/notes', { tenant: 't-2' })).status, 201);
        });

        test('the operator acting as the tenant passes a suspension, not a deletion', async () => {
            await hold('suspended');
            assert.equal((await ask('POST', '/notes', { operator: true })).status, 201);
            await hold('deleting', { reference: 'run-1' });
            const refused = await ask('GET', '/notes', { operator: true });
            assert.equal(refused.status, 403);
            assert.equal((await refused.json()).code, 'TENANT_BEING_DELETED');
        });
    });
}
