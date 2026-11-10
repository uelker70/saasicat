// The platform's own tenant routes hold a tenant to its state, behind the
// application's guards (`SC-ADM-052`).
//
// Every tenant route of the platform passes through `ComposedTenantAuthGuard`,
// which runs the application's guards and then the access check, so the check
// is asked of that guard directly: what it does with the application's answer,
// which tenant it asks about, and what it lets through. Which controllers have
// to pass through it is derived rather than listed — every controller that
// reads the tenant from the request — so a tenant route added without it fails
// here. The routes a read-only tenant may still call with a writing method are
// named, because each of them is a decision somebody has to have made, and so
// are the routes that start a payment.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    ComposedTenantAuthGuard,
    TENANT_ACCESS_MARK_KEY,
    TENANT_ID_RESOLVER_TOKEN,
    TenantAccessService,
} from '../dist/index.js';
import { SaaSiCatModule, findViolations, storeSecretsInPlainText } from '../dist/platform/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';
import { controllersIn, everythingOnOptions } from './helpers/operator-routes.js';

const SINCE = new Date('2026-11-02T08:30:00.000Z');

/** A store that counts how often it is asked. */
function countedStore() {
    const store = new FakeTenantAccessHoldRepository();
    const listOpen = store.listOpen.bind(store);
    store.asked = 0;
    store.listOpen = async (tenantId) => {
        store.asked += 1;
        return listOpen(tenantId);
    };
    return store;
}

const held = (store, tenantId, kind) =>
    store.record({
        tenantId,
        kind,
        reference: kind === 'suspended' ? null : `${kind}-1`,
        note: null,
        since: SINCE,
        recordedBy: 'web:ops@example.com:s1',
    });

/** An execution context for one request to a handler without marks. */
function contextFor(request) {
    class Route {
        handle() {}
    }
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => Route.prototype.handle,
        getClass: () => Route,
    };
}

/** An execution context for one request to a handler carrying `mark`. */
function contextMarked(request, mark) {
    const context = contextFor(request);
    Reflect.defineMetadata(TENANT_ACCESS_MARK_KEY, mark, context.getHandler());
    return context;
}

const guardWith = ({ appGuards = [{ canActivate: () => true }], store, resolver = null }) =>
    new ComposedTenantAuthGuard(
        appGuards,
        store ? new TenantAccessService(store, new Reflector()) : null,
        resolver,
    );

const asTenant = (tenantId, method = 'GET') => ({ method, user: { tenantId }, headers: {} });

// @requirement SC-ADM-052 — A suspended tenant cannot act, and a read-only one writes nothing but a payment
describe("the platform's tenant guard asks the state once the application let the request in", () => {
    test('an application guard that refuses ends it before the state is read', async () => {
        const store = countedStore();
        const guard = guardWith({ appGuards: [{ canActivate: () => false }], store });
        assert.equal(await guard.canActivate(contextFor(asTenant('t-1'))), false);
        assert.equal(store.asked, 0);
    });

    test('a suspended tenant is refused on a read', async () => {
        const store = countedStore();
        await held(store, 't-1', 'suspended');
        await assert.rejects(
            guardWith({ store }).canActivate(contextFor(asTenant('t-1'))),
            (error) =>
                error instanceof ForbiddenException &&
                error.getResponse().code === 'TENANT_SUSPENDED',
        );
    });

    test('a read-only tenant reads, and is refused a write', async () => {
        const store = countedStore();
        await held(store, 't-1', 'overdue');
        const guard = guardWith({ store });
        assert.equal(await guard.canActivate(contextFor(asTenant('t-1', 'GET'))), true);
        await assert.rejects(
            guard.canActivate(contextFor(asTenant('t-1', 'POST'))),
            (error) => error.getResponse().code === 'TENANT_READ_ONLY',
        );
    });

    test("the tenant is the application's resolver's, not another value on the request", async () => {
        const store = countedStore();
        await held(store, 't-session', 'suspended');
        const guard = guardWith({ store, resolver: () => 't-session' });
        await assert.rejects(
            guard.canActivate(contextFor(asTenant('t-elsewhere'))),
            (error) => error.getResponse().code === 'TENANT_SUSPENDED',
        );
    });

    test('a request without a tenant is refused rather than let through unchecked', async () => {
        const store = countedStore();
        await assert.rejects(
            guardWith({ store }).canActivate(contextFor({ method: 'GET', headers: {} })),
            (error) => error.getResponse().code === 'TENANT_CONTEXT_MISSING',
        );
    });

    describe('where the application already checked the request', () => {
        /** The application's guard, checking as the example says, with whoever it names. */
        const applicationChecking = (service, tenantId, actor) => ({
            canActivate: async (context) => {
                await service.enforce(context, tenantId, actor);
                return true;
            },
        });
        const platformWith = (store, appGuard) => {
            const service = new TenantAccessService(store, new Reflector());
            return new ComposedTenantAuthGuard([appGuard(service)], service, null);
        };

        test('the operator it let through, acting as the tenant, is not refused again', async () => {
            const store = countedStore();
            await held(store, 't-1', 'suspended');
            await held(store, 't-1', 'overdue');
            const guard = platformWith(store, (service) =>
                applicationChecking(service, 't-1', { actingAsOperator: true }),
            );
            assert.equal(await guard.canActivate(contextFor(asTenant('t-1', 'POST'))), true);
            assert.equal(store.asked, 1, 'the state is read once for the request');
        });

        test('a deletion stops the operator in the application check itself', async () => {
            const store = countedStore();
            await held(store, 't-1', 'deleting');
            const guard = platformWith(store, (service) =>
                applicationChecking(service, 't-1', { actingAsOperator: true }),
            );
            await assert.rejects(
                guard.canActivate(contextFor(asTenant('t-1'))),
                (error) => error.getResponse().code === 'TENANT_BEING_DELETED',
            );
        });

        test('a check for another tenant does not stand for this one', async () => {
            const store = countedStore();
            await held(store, 't-1', 'suspended');
            const guard = platformWith(store, (service) =>
                applicationChecking(service, 't-elsewhere', { actingAsOperator: true }),
            );
            await assert.rejects(
                guard.canActivate(contextFor(asTenant('t-1'))),
                (error) => error.getResponse().code === 'TENANT_SUSPENDED',
            );
        });

        test('a check on another request does not stand for this one', async () => {
            const store = countedStore();
            await held(store, 't-1', 'suspended');
            const service = new TenantAccessService(store, new Reflector());
            await service.enforce(contextFor(asTenant('t-1')), 't-1', { actingAsOperator: true });
            const guard = new ComposedTenantAuthGuard([{ canActivate: () => true }], service, null);
            await assert.rejects(
                guard.canActivate(contextFor(asTenant('t-1'))),
                (error) => error.getResponse().code === 'TENANT_SUSPENDED',
            );
        });
    });

    // @requirement SC-ADM-054 — A tenant's users read why it is held back
    test("a route that answers the tenant's own state is let through in every state, unread", async () => {
        for (const kind of ['suspended', 'deleting', 'overdue']) {
            const store = countedStore();
            await held(store, 't-1', kind);
            const guard = guardWith({ store });
            assert.equal(
                await guard.canActivate(contextMarked(asTenant('t-1'), 'reads-its-state')),
                true,
                kind,
            );
            assert.equal(store.asked, 0, kind);
        }
    });

    // @requirement SC-ADM-054 — A tenant's users read why it is held back
    test("the application's own check lets the same route through", async () => {
        const store = countedStore();
        await held(store, 't-1', 'suspended');
        const service = new TenantAccessService(store, new Reflector());
        await service.enforce(contextMarked(asTenant('t-1'), 'reads-its-state'), 't-1');
        assert.equal(store.asked, 0);
    });

    test('without the service, as in a module wired by hand, the application guards decide alone', async () => {
        assert.equal(
            await guardWith({ store: null }).canActivate(contextFor(asTenant('t-1'))),
            true,
        );
    });
});

/** The constructor tokens a controller injects, from Nest's own metadata. */
const injected = (controller) =>
    (Reflect.getMetadata('self:paramtypes', controller) ?? []).map((entry) => entry.param);

const guardsOf = (controller) => Reflect.getMetadata('__guards__', controller) ?? [];

/** Every handler of a controller with its HTTP method, path and mark. */
function handlersOf(controller) {
    const prefix = Reflect.getMetadata('path', controller) ?? '';
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
    return Object.getOwnPropertyNames(controller.prototype)
        .map((name) => controller.prototype[name])
        .filter(
            (handler) => typeof handler === 'function' && Reflect.hasMetadata('method', handler),
        )
        .map((handler) => ({
            method: methods[Reflect.getMetadata('method', handler)],
            // The route's own path is '/' where it has none of its own.
            path: [prefix, Reflect.getMetadata('path', handler)]
                .filter((part) => part && part !== '/')
                .join('/'),
            mark: Reflect.getMetadata(TENANT_ACCESS_MARK_KEY, handler) ?? null,
        }));
}

// @requirement SC-ADM-052 — A suspended tenant cannot act, and a read-only one writes nothing but a payment
describe('which routes the check reaches', () => {
    // Add-on bookings are switched on here as well: the shared fixture leaves
    // them off, and a derivation over it would never see their tenant routes.
    const installation = SaaSiCatModule.forRoot({
        ...everythingOnOptions(),
        subscriptionBundles: true,
    });
    const tenantControllers = controllersIn(installation).filter((controller) =>
        injected(controller).includes(TENANT_ID_RESOLVER_TOKEN),
    );

    test('there are tenant controllers to look at', () => {
        // Without this the next test passes on an empty list.
        assert.ok(tenantControllers.length >= 6, `found ${tenantControllers.length}`);
    });

    test('every controller that reads the tenant from the request passes through the guard', () => {
        const unguarded = tenantControllers
            .filter((controller) => !guardsOf(controller).includes(ComposedTenantAuthGuard))
            .map((controller) => controller.name);
        assert.deepEqual(unguarded, []);
    });

    test('exactly these routes let a read-only tenant through with a writing method', () => {
        const writingNothing = tenantControllers
            .flatMap(handlersOf)
            .filter((handler) => handler.mark === 'writes-nothing')
            .map((handler) => `${handler.method} ${handler.path}`)
            .sort();
        assert.deepEqual(writingNothing, [
            'POST billing/plan/preview',
            'POST billing/subscription-bundles/preview',
            'POST billing/subscription-bundles/prices',
        ]);
    });

    // Writes all the same, let through under read-only only while one of the
    // subscriber's invoices is open (`a-read-only-tenant-replaces-its-payment-method`).
    test('exactly these routes start a payment', () => {
        const starting = tenantControllers
            .flatMap(handlersOf)
            .filter((handler) => handler.mark === 'starts-payment')
            .map((handler) => `${handler.method} ${handler.path}`)
            .sort();
        assert.deepEqual(starting, [
            'POST billing/account/pay',
            'POST billing/payment-method/setup',
        ]);
    });

    // Let through in every state, so each of them is a decision somebody has
    // to have made: a route carrying the mark that reads anything else of the
    // tenant's would let a suspended tenant read it.
    // @requirement SC-ADM-054 — A tenant's users read why it is held back
    test("exactly these routes answer the tenant's own state", () => {
        const answering = tenantControllers
            .flatMap(handlersOf)
            .filter((handler) => handler.mark === 'reads-its-state')
            .map((handler) => `${handler.method} ${handler.path}`)
            .sort();
        assert.deepEqual(answering, ['GET billing/access', 'GET billing/account/access']);
    });
});

describe('the configuration the check needs', () => {
    const CORE = { mfa: {}, audit: {}, rlsBypass: {}, transactionRunner: {} };
    const violationsOf = (core) =>
        findViolations({
            options: {
                planCatalog: { schemaVersion: 1, app: { name: 'X' }, currency: 'EUR', plans: [] },
                controller: { guards: [] },
                tenantBilling: { authGuards: [] },
                persistence: {
                    capabilities: {
                        transactions: true,
                        pessimisticLocking: true,
                        rowLevelSecurity: false,
                        advisoryLocks: false,
                    },
                    core: { ...CORE, ...core },
                },
            },
            adapters: { ...CORE, secretSealer: storeSecretsInPlainText() },
        }).map((violation) => violation.id);

    test('serving tenants with nowhere to keep their reasons, the start is refused, naming the rule', () => {
        assert.ok(violationsOf({}).includes('tenant-access.requires-holds-port'));
    });

    test('a bundle that keeps the reasons is enough', () => {
        assert.ok(
            !violationsOf({ tenantAccessHolds: new FakeTenantAccessHoldRepository() }).includes(
                'tenant-access.requires-holds-port',
            ),
        );
    });
});
