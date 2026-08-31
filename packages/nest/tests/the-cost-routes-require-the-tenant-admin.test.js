import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TenantAdminGuard, TenantBillingController } from '../dist/billing/index.js';
import { AUTH_ERROR_CODES } from '@saasicat/core';

// Which tenant-facing routes cost money, and what a caller without the role
// gets on them.
//
// The list is READ from the controller, not written here. A route added later
// with `@UseGuards(TenantAdminGuard)` joins these assertions by existing, and a
// route that quietly loses the decorator leaves them — which is the failure
// this is for. A hand-written list would agree with itself forever.
//
// It matters because the answer reaches a browser: the notesapp web client
// shipped without the role header and every one of these answered
// `403 TENANT_ADMIN_REQUIRED`, so the whole "Change plan" flow was unreachable
// in the example an integrator copies from. `tests/the-example-sends-the-role-
// its-guards-require.test.js` is the other half — that the client sends it.

/** Nest's own metadata key for `@UseGuards`. */
const GUARDS = '__guards__';
/** Nest's metadata keys for `@Post(path)` and friends. */
const ROUTE_PATH = 'path';
const ROUTE_METHOD = 'method';

/** Handlers on the controller that `@UseGuards(TenantAdminGuard)` decorates. */
function costRoutes() {
    const prototype = TenantBillingController.prototype;
    const found = [];
    for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === 'constructor') continue;
        const handler = prototype[name];
        if (typeof handler !== 'function') continue;
        const guards = Reflect.getMetadata(GUARDS, handler) ?? [];
        if (!guards.includes(TenantAdminGuard)) continue;
        found.push({
            name,
            path: Reflect.getMetadata(ROUTE_PATH, handler),
            method: Reflect.getMetadata(ROUTE_METHOD, handler),
        });
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** The shape the guard reads — `request.user`, or nothing at all. */
function contextFor(user) {
    return {
        switchToHttp: () => ({ getRequest: () => (user ? { user } : {}) }),
        getHandler: () => ({}),
        getClass: () => ({}),
    };
}

const routes = costRoutes();
const guard = new TenantAdminGuard();

// @requirement SC-ADM-013 — A tenant-facing action that costs money requires the tenant's own administrator
describe('the cost-relevant tenant routes', () => {
    test('the controller declares some, and each one is a real route', () => {
        // Every assertion below iterates this list. On an empty one they all
        // pass, and a renamed metadata key or a controller that moved would
        // read as "all routes are guarded".
        assert.ok(routes.length >= 5, `only ${routes.length} guarded routes found`);
        for (const route of routes) {
            assert.equal(typeof route.path, 'string', `${route.name} carries no route path`);
            assert.ok(route.method !== undefined, `${route.name} carries no HTTP method`);
        }
    });

    test('a caller without a role is refused, with the code the client reads', () => {
        for (const route of routes) {
            assert.throws(
                () => guard.canActivate(contextFor({ tenantId: 't1' })),
                (error) => {
                    const body = error.getResponse();
                    assert.equal(body.code, AUTH_ERROR_CODES.TENANT_ADMIN_REQUIRED);
                    assert.equal(error.getStatus(), 403);
                    return true;
                },
                `${route.method} ${route.path} let a roleless caller through`,
            );
        }
    });

    test('an unauthenticated caller is refused separately', () => {
        // A different code, because it is a different fix: send credentials
        // rather than ask an administrator for the role.
        assert.throws(
            () => guard.canActivate(contextFor(undefined)),
            (error) => {
                assert.equal(error.getResponse().code, AUTH_ERROR_CODES.NOT_AUTHENTICATED);
                return true;
            },
        );
    });

    test("the tenant's own administrator is admitted", () => {
        for (const route of routes) {
            assert.equal(
                guard.canActivate(contextFor({ tenantId: 't1', platformRole: 'TENANT_ADMIN' })),
                true,
                `${route.method} ${route.path} refused the role it asks for`,
            );
        }
    });

    test('`role` is honoured where `platformRole` is absent', () => {
        // Both spellings are documented as equivalent, and the example backend
        // fills only one of them. A guard that read one would refuse half the
        // consumers.
        assert.equal(guard.canActivate(contextFor({ role: 'TENANT_ADMIN' })), true);
    });

    test('a platform operator is admitted too', () => {
        assert.equal(guard.canActivate(contextFor({ platformRole: 'SUPER_ADMIN' })), true);
    });

    test('a plain member is refused', () => {
        assert.throws(() => guard.canActivate(contextFor({ platformRole: 'MEMBER' })));
    });
});
