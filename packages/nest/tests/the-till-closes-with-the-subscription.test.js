import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SubscriptionBundlePreviewService,
    SubscriptionBundlesService,
    buildTenantSubscriptionBundlesController,
} from '../dist/billing/index.js';

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

describe('what a bundle may commit to', () => {
    // The other half of the boundary, and the one that costs money rather than
    // access: a bundle cannot bind a customer past the subscription that pays
    // for it. A twelve-month default term on a subscription ending in three
    // weeks is a commitment with three weeks left to give.
    //
    // Clamped rather than refused. Somebody who cancelled for the end of the
    // month may still want a bundle for this month, and the bundle price is per
    // period rather than per term — so a shorter commitment cannot overcharge
    // them, only stop binding them beyond what they can use.
    function service() {
        const added = [];
        const svc = new SubscriptionBundlesService(
            {
                add: async (data) => {
                    added.push(data);
                    return { id: 'sb-1', ...data };
                },
                listBySubscription: async () => [],
                listActiveBySubscription: async () => [],
                findById: async () => null,
            },
            {
                findVersionById: async () => ({
                    id: 'bv-1',
                    bundleId: 'b-1',
                    publishedAt: new Date('2025-01-01'),
                    supersededAt: null,
                    compatibility: {},
                    features: ['F'],
                }),
            },
            { defaultMinimumTermMonths: 12 },
        );
        return { svc, added };
    }

    const book = (svc, parentEndsAt) =>
        svc.addBundleToSubscription({
            subscriptionId: 'sub-1',
            bundleVersionId: 'bv-1',
            currentPlanKey: 'STANDARD',
            startedAt: new Date('2026-01-01'),
            parentEndsAt,
        });

    test('never past the parent, when the parent ends first', async () => {
        const { svc, added } = service();

        await book(svc, new Date('2026-02-01'));

        assert.deepEqual(added[0].minimumTermEndsAt, new Date('2026-02-01'));
    });

    test('and its own term when that ends first', async () => {
        // The premise: the clamp takes the earlier date, it does not replace
        // one rule with the other.
        const { svc, added } = service();

        await book(svc, new Date('2030-01-01'));

        assert.deepEqual(added[0].minimumTermEndsAt, new Date('2027-01-01'));
    });

    test('and no term at all where the caller asked for none', async () => {
        // `minimumTermMonths: 0` says there is no commitment. Capping that to
        // the parent's end would invent one — the booking could then not be
        // cancelled until the subscription ended, which is the opposite of what
        // a zero-month term is for.
        const { svc, added } = service();

        await svc.addBundleToSubscription({
            subscriptionId: 'sub-1',
            bundleVersionId: 'bv-1',
            currentPlanKey: 'STANDARD',
            startedAt: new Date('2026-01-01'),
            minimumTermMonths: 0,
            parentEndsAt: new Date('2026-02-01'),
        });

        assert.equal(added[0].minimumTermEndsAt, null);
    });

    test('and the full term where nothing ends the parent', async () => {
        const { svc, added } = service();

        await book(svc, null);

        assert.deepEqual(added[0].minimumTermEndsAt, new Date('2027-01-01'));
    });
});

describe('what the dialog promises before the booking', () => {
    // The confirmation states the term the booking commits to, and the write
    // caps that at the parent's end. A preview that does not cap it describes a
    // different contract from the one that gets persisted — the reader agrees
    // to one thing and receives another.
    const now = new Date('2026-01-01');

    function preview() {
        return new SubscriptionBundlePreviewService(
            {
                listActiveBySubscription: async () => [],
                findById: async () => null,
            },
            {
                findVersionById: async () => ({
                    id: 'bv-1',
                    bundleId: 'b-1',
                    publishedAt: new Date('2025-01-01'),
                    supersededAt: null,
                    compatibility: {},
                    features: ['F'],
                    monthlyNet: 5,
                    yearlyNet: 50,
                }),
            },
            { defaultMinimumTermMonths: 12 },
        );
    }

    const ask = (svc, parentEndsAt) =>
        svc.previewAdd(
            {
                subscriptionId: 'sub-1',
                currentPlanKey: 'STANDARD',
                billingCycle: 'MONTHLY',
                status: 'ACTIVE',
                startedAt: now,
                currentPeriodStart: now,
                currentPeriodEnd: new Date('2026-02-01'),
                parentEndsAt,
            },
            { bundleVersionId: 'bv-1' },
            now,
        );

    test('states the capped term, not the uncapped one', async () => {
        const dto = await ask(preview(), new Date('2026-02-01'));

        assert.deepEqual(dto.minimumTermEndsAt, new Date('2026-02-01'));
    });

    test('and the full term where nothing ends the parent', async () => {
        // The premise: the preview caps, it does not shorten by default.
        const dto = await ask(preview(), null);

        assert.deepEqual(dto.minimumTermEndsAt, new Date('2027-01-01'));
    });
});
