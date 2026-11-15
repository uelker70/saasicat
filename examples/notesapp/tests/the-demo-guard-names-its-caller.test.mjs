// The demo guard puts the caller on the request where the platform reads it:
// the tenant routes that record who acted take the user's `id`, and refuse a
// request without one, and the admin app's caller is the SuperAdmin the seed
// gives a second factor. DB-free — the guard runs over a request object.

// @requirement SC-COMP-014

import 'reflect-metadata';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

/** Runs the guard over a request carrying `headers`, and returns the request. */
async function guarded(headers) {
    const { Reflector } = await import('@nestjs/core');
    const { DemoAuthGuard } = await import('../dist/auth/demo-auth.guard.js');
    const asked = [];
    const access = { enforce: async (...args) => asked.push(args) };
    const request = { headers };
    const context = {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => function handler() {},
        getClass: () => class Controller {},
    };

    assert.equal(await new DemoAuthGuard(new Reflector(), access).canActivate(context), true);
    return { request, asked };
}

describe('the demo guard', () => {
    test("names a tenant's user under `id`, where the platform reads who acted", async () => {
        const { request } = await guarded({
            'x-demo-tenant': 'tenant-a',
            'x-demo-role': 'TENANT_ADMIN',
        });

        assert.equal(request.user.id, 'demo-user-tenant-a');
        assert.equal(request.user.tenantId, 'tenant-a');
        assert.equal(request.user.platformRole, 'TENANT_ADMIN');
    });

    test('names the admin app’s caller as the SuperAdmin the seed gives a second factor', async () => {
        const { DEMO_SUPER_ADMIN } = await import('../dist/seed-super-admin.js');

        const { request, asked } = await guarded({
            'x-demo-tenant': 'admin',
            'x-demo-role': 'SUPER_ADMIN',
        });

        assert.equal(request.user.id, DEMO_SUPER_ADMIN.id);
        assert.equal(request.user.email, DEMO_SUPER_ADMIN.email);
        // Asked as the operator, whom a suspended or read-only tenant lets through.
        assert.deepEqual(asked[0].slice(1), ['admin', { actingAsOperator: true }]);
    });
});
