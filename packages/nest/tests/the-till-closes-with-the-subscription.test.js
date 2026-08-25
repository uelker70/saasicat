import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTenantSubscriptionBundlesController } from '../dist/billing/index.js';

// A bundle hangs off the subscription that pays for it.
//
// It is bought, priced, and given a minimum term of its own, and it grants its
// features through the parent — which grants nothing once its cancellation has
// landed. Sold there it is a commitment that can never deliver: charged,
// listed, and inert. The tenant store went on offering it, because the bundle
// routes asked only whether a subscription row existed.
//
// Reading and cancelling stay open, deliberately. Somebody whose subscription
// ended must still be able to see what they booked and tidy it up. What closes
// is the till.

const DAY = 86_400_000;

function subscription(overrides = {}) {
    return {
        id: 'sub-1',
        plan: 'STANDARD',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        currentPeriodStart: new Date('2026-06-01'),
        currentPeriodEnd: new Date(Date.now() + 20 * DAY),
        canceledAt: null,
        canceledEffectiveAt: null,
        planVersion: { id: 'pv-1', planId: 'plan-uuid', version: 1 },
        ...overrides,
    };
}

const ENDED = subscription({
    canceledAt: new Date(Date.now() - 90 * DAY),
    canceledEffectiveAt: new Date(Date.now() - 60 * DAY),
});

function controllerFor(sub) {
    const Ctrl = buildTenantSubscriptionBundlesController();
    const calls = { added: 0, previewed: 0, reactivated: 0, listed: 0, cancelled: 0 };
    const service = {
        addBundleToSubscription: async (input) => {
            calls.added += 1;
            return { id: 'sb-1', ...input };
        },
        cancelBundleFromSubscription: async (input) => {
            calls.cancelled += 1;
            return { id: input.subscriptionBundleId };
        },
        reactivateBundle: async () => {
            calls.reactivated += 1;
            return { id: 'sb-1' };
        },
        listForSubscription: async () => {
            calls.listed += 1;
            return [];
        },
    };
    const previewService = {
        previewAdd: async () => {
            calls.previewed += 1;
            return { ok: true };
        },
        previewCancel: async () => ({ ok: true }),
    };
    const ctrl = new Ctrl(
        service,
        previewService,
        { findForTenant: async () => sub },
        (req) => req.user?.tenantId ?? null,
        null,
    );
    return { ctrl, calls };
}

const REQ = { user: { tenantId: 't1' } };
const ended = (err) => err.getResponse?.().code === 'SUBSCRIPTION_ENDED';

describe('once the subscription has ended', () => {
    test('a bundle cannot be booked', async () => {
        const { ctrl, calls } = controllerFor(ENDED);

        await assert.rejects(ctrl.add(REQ, { bundleVersionId: 'bv-1' }), ended);
        assert.equal(calls.added, 0, 'a bundle was sold to a contract that is over');
    });

    test('nor priced', async () => {
        // The preview is where the tenant sees what it costs. Answering it
        // invites the purchase the route above refuses.
        const { ctrl, calls } = controllerFor(ENDED);

        await assert.rejects(ctrl.preview(REQ, { bundleVersionId: 'bv-1' }), ended);
        assert.equal(calls.previewed, 0);
    });

    test('nor reactivated, which is buying it again', async () => {
        const { ctrl, calls } = controllerFor(ENDED);

        await assert.rejects(ctrl.reactivate(REQ, 'sb-1'), ended);
        assert.equal(calls.reactivated, 0);
    });

    test('while pricing a cancellation stays open, because that is tidying up', async () => {
        // One route, two questions: `preview` answers both "what would this
        // cost me" and "what happens if I drop it". Only the first is a sale.
        const { ctrl } = controllerFor(ENDED);

        const answer = await ctrl.preview(REQ, { subscriptionBundleId: 'sb-1' });

        assert.deepEqual(answer, { ok: true });
    });

    test('but what was booked can still be read', async () => {
        // Not a formality: a tenant who has left still has invoices to explain
        // and bookings to recognise.
        const { ctrl, calls } = controllerFor(ENDED);

        await ctrl.list(REQ);

        assert.equal(calls.listed, 1);
    });

    test('and still cancelled', async () => {
        const { ctrl, calls } = controllerFor(ENDED);

        await ctrl.cancel(REQ, 'sb-1', {});

        assert.equal(calls.cancelled, 1);
    });
});

describe('while the subscription is running', () => {
    // The premise for all five above: what closes the till is the ending, not
    // the routes. A cancellation still to come closes nothing — that customer
    // has paid for the term they are in.
    const ENDING = subscription({
        canceledAt: new Date(),
        canceledEffectiveAt: new Date(Date.now() + 20 * DAY),
    });

    test('a bundle can be booked, priced and reactivated', async () => {
        const { ctrl, calls } = controllerFor(subscription());

        await ctrl.add(REQ, { bundleVersionId: 'bv-1' });
        await ctrl.preview(REQ, { bundleVersionId: 'bv-1' });
        await ctrl.reactivate(REQ, 'sb-1');

        assert.deepEqual([calls.added, calls.previewed, calls.reactivated], [1, 1, 1]);
    });

    test('and a cancellation still to come does not close it either', async () => {
        const { ctrl, calls } = controllerFor(ENDING);

        await ctrl.add(REQ, { bundleVersionId: 'bv-1' });

        assert.equal(calls.added, 1);
    });
});
