// @requirement SC-ADM-001 — Only a platform administrator reaches the administration surface

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { AUTH_ERROR_CODES } from '@saasicat/core';

import { SuperAdminGuard } from '../dist/platform/index.js';

import {
    SignedInGuard,
    controllersIn,
    everythingOn,
    guardsOf,
    isOperatorRoute,
    isPublic,
    pathOf,
} from './helpers/operator-routes.js';

// Every controller `SaaSiCatModule.forRoot` mounts under `admin/` runs
// `SuperAdminGuard`, unless it is marked as a public route — which is what the
// first-run setup and the login page's branding carry.
//
// `controller.guards` establishes who is calling, and nothing more: the tenant
// manifest falls back to that same list, so a role check cannot live there.
// The platform adds it. The expectation below is derived from the module graph
// `forRoot` returns rather than from a list of controllers, so a composer that
// mounts an operator route later is held to the rule without anybody
// remembering to add it here.

/** Runs a class-level guard chain the way Nest does, in order, for one caller. */
async function passes(controller, user) {
    const request = { user, headers: {} };
    const context = {
        switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
        getClass: () => controller,
        getHandler: () => () => undefined,
        getType: () => 'http',
    };
    for (const Guard of guardsOf(controller)) {
        if (!(await new Guard().canActivate(context))) return false;
    }
    return true;
}

describe('every operator route the platform mounts requires the platform administrator', () => {
    const controllers = controllersIn(everythingOn());
    const operator = controllers.filter(isOperatorRoute);

    test('the walk reaches the operator routes of more than one composer', () => {
        // A walk that found nothing would satisfy every assertion below. The
        // catalogue and the manifest come from different composers, and both
        // are mounted by the configuration above.
        const paths = operator.map(pathOf);
        assert.ok(paths.includes('admin/catalog/plans'), paths.join(', '));
        assert.ok(paths.includes('admin'), paths.join(', '));
    });

    test('each one runs SuperAdminGuard', () => {
        const unguarded = operator
            .filter((controller) => !guardsOf(controller).includes(SuperAdminGuard))
            .map((controller) => `${controller.name} (${pathOf(controller)})`);
        assert.deepEqual(unguarded, []);
    });

    test('after the guards that establish the caller, never before them', () => {
        const misordered = operator
            .filter((controller) => {
                const guards = guardsOf(controller);
                return guards.indexOf(SignedInGuard) > guards.indexOf(SuperAdminGuard);
            })
            .map((controller) => `${controller.name} (${pathOf(controller)})`);
        assert.deepEqual(misordered, []);
    });

    test('a signed-in tenant user is refused by name, and the platform administrator passes', async () => {
        for (const controller of operator) {
            await assert.rejects(
                () => passes(controller, { role: 'TENANT_ADMIN', tenantId: 't-1' }),
                (error) => {
                    assert.ok(error instanceof ForbiddenException, controller.name);
                    assert.equal(
                        error.getResponse().code,
                        AUTH_ERROR_CODES.SUPER_ADMIN_REQUIRED,
                        controller.name,
                    );
                    return true;
                },
            );
            assert.equal(await passes(controller, { role: 'SUPER_ADMIN' }), true, controller.name);
        }
    });

    test('a route marked public keeps no role check, so setup and the login branding stay reachable', () => {
        const exempt = controllers.filter(
            (controller) => pathOf(controller).startsWith('admin') && isPublic(controller),
        );
        assert.ok(exempt.length > 0, 'no public admin route was mounted — the probe is wrong');
        for (const controller of exempt) {
            assert.equal(guardsOf(controller).includes(SuperAdminGuard), false, controller.name);
        }
    });

    test('with no guards passed, a request without a caller is refused rather than let through', async () => {
        // `controller: { guards: [] }` establishes nobody. The role check is
        // still there, and a request with no user fails it.
        const bare = controllersIn(everythingOn([])).filter(isOperatorRoute);
        assert.ok(bare.length > 0);
        for (const controller of bare) {
            await assert.rejects(
                () => passes(controller, undefined),
                (error) => {
                    assert.ok(error instanceof ForbiddenException, controller.name);
                    assert.equal(
                        error.getResponse().code,
                        AUTH_ERROR_CODES.NOT_AUTHENTICATED,
                        controller.name,
                    );
                    return true;
                },
            );
        }
    });

    test('the tenant manifest keeps authentication alone', () => {
        // It falls back to `controller.guards` when tenant billing binds none,
        // and it answers a tenant: the role check there would lock every
        // tenant out of its own manifest.
        const tenantManifest = controllers.filter((c) => pathOf(c) === 'tenant/manifest');
        assert.equal(tenantManifest.length, 1);
        assert.deepEqual(guardsOf(tenantManifest[0]), [SignedInGuard]);
    });
});
