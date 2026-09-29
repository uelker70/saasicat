// @requirement SC-SEC-015 — An operator's route runs across tenants, and no other route does

// A route only the platform's administrator reaches acts for the platform,
// not for a tenant, and under row-level security that means it runs in the
// bypass: inside a tenant's policy its lists come back empty and its counts as
// 0. Every other route runs in the tenant's frame, whatever it is.
//
// Two halves, because either alone reads as correct. The first asks the
// running composition, route by route, whether the frame follows the guard
// chain — so a controller added tomorrow is covered without being listed, and
// a route that is not an operator's carries nothing that could open a frame.
// The second sends requests and watches where the handler actually runs,
// because metadata on a class says nothing about what an interceptor does with
// it.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { AdminBypassRlsInterceptor, SaaSiCatModule, SuperAdminGuard } from '../dist/index.js';
import { FakeMaintenanceWindowPort } from './helpers/maintenance-windows.js';

/** Fills `request.user` from a header, and rejects nobody: the platform's guards decide. */
class HeaderAuthGuard {
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const role = request.headers['x-role'];
        if (role) request.user = { id: 'u-1', platformRole: role, tenantId: 't-1' };
        return true;
    }
}
Reflect.decorate([Injectable()], HeaderAuthGuard);

/** The frame the bypass port opens, and where each read found itself. */
const frame = new AsyncLocalStorage();

class WatchedWindows extends FakeMaintenanceWindowPort {
    seenIn = [];
    async listRecent(limit) {
        this.seenIn.push(frame.getStore() === 'bypass' ? 'bypass' : 'tenant');
        return super.listRecent(limit);
    }
    async findOpen() {
        this.seenIn.push(frame.getStore() === 'bypass' ? 'bypass' : 'tenant');
        return super.findOpen();
    }
}

function platform(windows) {
    return SaaSiCatModule.forRoot({
        planCatalog: {
            schemaVersion: 1,
            app: { name: 'AcrossTenants' },
            currency: 'EUR',
            vatRate: 19,
            plans: [{ id: 'PRO', features: [], quotas: {} }],
        },
        controller: { guards: [HeaderAuthGuard] },
        discoverySnapshotPath: null,
        persistence: {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: true,
                advisoryLocks: false,
            },
            core: {
                mfa: {},
                audit: { write: async () => {} },
                rlsBypass: { runWithBypass: (work) => frame.run('bypass', work) },
                transactionRunner: {},
                maintenanceWindows: windows,
            },
        },
        adapters: { planResolver: { getPlanIdForTenant: async () => 'PRO' } },
        maintenance: true,
        // Built from a composed chain that is not an operator's: the case a
        // frame decided by anything but the chain would get wrong.
        tenantManifest: true,
    });
}

/** Guards or interceptors on a handler, the class's first as Nest runs them. */
function effective(key, controller, handler) {
    return [
        ...(Reflect.getMetadata(key, controller) ?? []),
        ...(Reflect.getMetadata(key, handler) ?? []),
    ];
}

describe('the frame a route runs in follows its guard chain', () => {
    let moduleRef;
    before(async () => {
        moduleRef = await Test.createTestingModule({
            imports: [platform(new WatchedWindows())],
            providers: [HeaderAuthGuard],
        }).compile();
    });
    after(async () => {
        await moduleRef?.close();
    });

    test('every route behind the administrator runs in the bypass, and no other does', () => {
        const operatorRoutes = [];
        const otherRoutes = [];
        for (const module of moduleRef.get(ModulesContainer).values()) {
            for (const wrapper of module.controllers.values()) {
                const controller = wrapper.metatype;
                for (const name of Object.getOwnPropertyNames(controller.prototype)) {
                    const handler = controller.prototype[name];
                    if (name === 'constructor' || typeof handler !== 'function') continue;
                    if (!Reflect.getMetadata('path', handler)) continue;
                    const route = `${controller.name}.${name}`;
                    const operator = effective(GUARDS_METADATA, controller, handler).includes(
                        SuperAdminGuard,
                    );
                    const bypass = effective(INTERCEPTORS_METADATA, controller, handler).includes(
                        AdminBypassRlsInterceptor,
                    );
                    (operator ? operatorRoutes : otherRoutes).push(route);
                    const opened = [controller, handler].filter((target) =>
                        (Reflect.getMetadata(INTERCEPTORS_METADATA, target) ?? []).includes(
                            AdminBypassRlsInterceptor,
                        ),
                    );
                    assert.ok(
                        opened.length <= 1,
                        `${route} opens the bypass twice, once on the class and once on the handler`,
                    );
                    assert.equal(
                        bypass,
                        operator,
                        operator
                            ? `${route} admits only the administrator but runs in the tenant's frame`
                            : `${route} is not an operator route but runs in the bypass`,
                    );
                }
            }
        }
        // The premise: both kinds are there to be compared, among them a route
        // whose chain the composition built without the administrator.
        assert.ok(operatorRoutes.length > 0, 'no operator route found to check');
        assert.ok(
            otherRoutes.some((route) => route.includes('TenantManifest')),
            `no composed route of a tenant found to check: ${otherRoutes.join(', ')}`,
        );
    });
});

describe('where the handler of a route actually runs', () => {
    const windows = new WatchedWindows();
    let app;
    let base;
    before(async () => {
        const moduleRef = await Test.createTestingModule({
            imports: [platform(windows)],
            providers: [HeaderAuthGuard],
        }).compile();
        app = moduleRef.createNestApplication(undefined, { logger: false });
        await app.listen(0, '127.0.0.1');
        base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    });
    after(async () => {
        await app?.close();
    });

    test("an operator's route reads in the bypass", async () => {
        windows.seenIn.length = 0;
        const response = await fetch(`${base}/admin/maintenance`, {
            headers: { 'x-role': 'SUPER_ADMIN' },
        });

        assert.equal(response.status, 200);
        assert.ok(windows.seenIn.length > 0, 'the route read nothing');
        assert.ok(
            windows.seenIn.every((where) => where === 'bypass'),
            `read in ${windows.seenIn.join(', ')}`,
        );
    });

    test('a tenant turned away from the operator route never reached a frame', async () => {
        windows.seenIn.length = 0;
        const response = await fetch(`${base}/admin/maintenance`, {
            headers: { 'x-role': 'TENANT_ADMIN' },
        });

        assert.equal(response.status, 403);
        assert.deepEqual(windows.seenIn, [], 'the guard ran after the frame was opened');
    });
});
