// A tenant that is read-only may still leave (`SC-ADM-055`): its administrator
// declares the cancellation of its subscription, cancels an add-on, and ends
// either at once while a feature is withdrawn, whatever it owes — a tenant is
// never told it may not leave (`SC-CANC-001`). A suspension and a deletion
// under way have no such exception, and nothing else a read-only tenant writes
// is let through.
//
// The exception is decided where every tenant request is checked —
// `TenantAccessService` —, so the application's own guard, which checks first
// on the same handler, lets the request through as the platform's does. Each
// handler is the platform's own route, with the mark it carries.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import * as billing from '../dist/billing/index.js';
import { Leaves, TENANT_ACCESS_MARK_KEY, TenantAccessService } from '../dist/index.js';
import { FakeTenantAccessHoldRepository } from '../dist/testing/index.js';

const {
    ComposedTenantAuthGuard,
    FeatureWithdrawalTenantController,
    TenantAdminGuard,
    TenantBillingController,
} = billing;
const TenantSubscriptionBundlesController = billing.buildTenantSubscriptionBundlesController();

const SINCE = new Date('2026-11-02T00:00:00.000Z');

/** Holds `tenantId` back for `kind`. */
const held = (store, tenantId, kind) =>
    store.record({
        tenantId,
        kind,
        reference: kind === 'suspended' ? null : `${kind}-1`,
        note: null,
        since: SINCE,
        recordedBy: 'job:platform:overdue-invoices',
    });

/** The access check over `store`. */
const accessOver = (store) => new TenantAccessService(store, new Reflector());

/** A request of `t1`'s user to `handler` of `controller`. */
function contextFor(controller, handler, method) {
    const request = { method, user: { tenantId: 't1' }, headers: {} };
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => controller.prototype[handler],
        getClass: () => controller,
    };
}

/** The four routes a tenant leaves through. */
const CANCELLING = () => contextFor(TenantBillingController, 'cancelSubscription', 'POST');
const CANCELLING_AN_ADD_ON = () =>
    contextFor(TenantSubscriptionBundlesController, 'cancel', 'DELETE');
const ENDING_AT_ONCE = () => contextFor(FeatureWithdrawalTenantController, 'end', 'POST');
const ENDING_AN_ADD_ON_AT_ONCE = () =>
    contextFor(FeatureWithdrawalTenantController, 'endBooking', 'POST');

const LEAVING = {
    'declaring the cancellation': CANCELLING,
    'cancelling an add-on': CANCELLING_AN_ADD_ON,
    'ending at once': ENDING_AT_ONCE,
    'ending an add-on at once': ENDING_AN_ADD_ON_AT_ONCE,
};

/** Writes of a read-only tenant that are not leaving. */
const STAYING = {
    'changing the plan': () => contextFor(TenantBillingController, 'changePlan', 'POST'),
    'booking an add-on': () => contextFor(TenantSubscriptionBundlesController, 'add', 'POST'),
    'reinstating a cancelled add-on': () =>
        contextFor(TenantSubscriptionBundlesController, 'reactivate', 'POST'),
};

const refusedWith = (code) => (error) =>
    error instanceof ForbiddenException && error.getResponse().code === code;

/** Whether `t1`, held back for `kinds`, is let through `context`. */
async function letThrough(kinds, context) {
    const store = new FakeTenantAccessHoldRepository();
    for (const kind of kinds) await held(store, 't1', kind);
    await accessOver(store).enforce(context, 't1');
}

/** That `t1`, held back for `kinds`, is refused `context` with `code`. */
async function refused(kinds, context, code, what) {
    const store = new FakeTenantAccessHoldRepository();
    for (const kind of kinds) await held(store, 't1', kind);
    await assert.rejects(accessOver(store).enforce(context, 't1'), refusedWith(code), what);
}

// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave
describe('a read-only tenant leaving', () => {
    // @requirement SC-CANC-001 — A cancellation may always be declared
    test('is let through declaring the cancellation of its subscription, an invoice unpaid notwithstanding', async () => {
        await letThrough(['overdue'], CANCELLING());
    });

    // @requirement SC-BUN-063 — An add-on can be cancelled at any time and ends with the period it is in
    test('is let through cancelling an add-on, an invoice unpaid notwithstanding', async () => {
        await letThrough(['overdue'], CANCELLING_AN_ADD_ON());
    });

    // @requirement SC-CANC-024 — While a feature it holds is withdrawn, a subscription may end at once
    test('is let through ending its subscription at once, an invoice unpaid notwithstanding', async () => {
        await letThrough(['overdue'], ENDING_AT_ONCE());
    });

    // @requirement SC-BUN-062 — An add-on that grants a withdrawn feature can be ended at once on its own
    test('is let through ending an add-on at once, an invoice unpaid notwithstanding', async () => {
        await letThrough(['overdue'], ENDING_AN_ADD_ON_AT_ONCE());
    });

    test('is let through after its subscription ended as well', async () => {
        await letThrough(['ended'], CANCELLING());
    });

    test('asked without a request, as a scheduled job asks, follows the same rule', async () => {
        const store = new FakeTenantAccessHoldRepository();
        await held(store, 't1', 'overdue');
        const access = accessOver(store);
        await access.assertAllowed('t1', { writes: true, leaves: true });
        await assert.rejects(
            access.assertAllowed('t1', { writes: true }),
            refusedWith('TENANT_READ_ONLY'),
        );
    });
});

// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave
describe('leaving is read-only’s exception alone', () => {
    test('a suspended tenant is refused every way of leaving, an invoice unpaid or not', async () => {
        for (const [what, context] of Object.entries(LEAVING)) {
            await refused(['suspended', 'overdue'], context(), 'TENANT_SUSPENDED', what);
        }
    });

    test('a tenant being deleted is refused every way of leaving', async () => {
        for (const [what, context] of Object.entries(LEAVING)) {
            await refused(['deleting', 'overdue'], context(), 'TENANT_BEING_DELETED', what);
        }
    });

    test('a read-only tenant is still refused changing the plan, booking an add-on and reinstating one', async () => {
        for (const [what, context] of Object.entries(STAYING)) {
            await refused(['overdue'], context(), 'TENANT_READ_ONLY', what);
        }
    });
});

// @requirement SC-ADM-055 — A suspended tenant cannot act, and a read-only one writes only to pay or to leave
describe('where the request is checked', () => {
    test('each route a tenant leaves through carries the mark, and stays behind the administrator', () => {
        for (const [what, context] of Object.entries(LEAVING)) {
            const route = context().getHandler();
            assert.equal(Reflect.getMetadata(TENANT_ACCESS_MARK_KEY, route), 'leaves', what);
            assert.ok(
                (Reflect.getMetadata('__guards__', route) ?? []).includes(TenantAdminGuard),
                what,
            );
        }
    });

    test('a route of the application’s own through which a tenant leaves is let through with the same mark', async () => {
        class Membership {
            end() {}
        }
        Leaves()(
            Membership.prototype,
            'end',
            Object.getOwnPropertyDescriptor(Membership.prototype, 'end'),
        );
        await letThrough(['overdue'], contextFor(Membership, 'end', 'POST'));
    });

    test('the application’s guard, checking first on the same handler, lets it through as the platform does', async () => {
        const store = new FakeTenantAccessHoldRepository();
        await held(store, 't1', 'overdue');
        const access = accessOver(store);
        const application = {
            canActivate: async (context) => {
                await access.enforce(context, 't1');
                return true;
            },
        };
        const guard = new ComposedTenantAuthGuard([application], access, null);

        assert.equal(await guard.canActivate(CANCELLING()), true);
        await assert.rejects(
            guard.canActivate(STAYING['changing the plan']()),
            refusedWith('TENANT_READ_ONLY'),
        );
    });
});
