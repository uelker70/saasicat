import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { EntitlementService } from '../dist/entitlement/index.js';

// A cancellation that has taken effect ends what the subscription granted.
//
// Until this suite existed, it did not. A subscription cancelled eight months
// ago was granted exactly what it was granted while active — same plan, same
// features, same quotas — because nothing on the entitlement path read either
// cancellation date. The record the path reads did not carry them at all, which
// is the root of it: no repository filters a cancelled subscription out, and
// the renewal decision stops the billing period without touching what the
// tenant may still do.
//
// What a cancelled subscription keeps is an installation's decision, so the
// default is the strict reading — nothing — and `canceledEntitlementPlan` names
// a floor for installations that want one: a read-only tier to export from, a
// free plan to fall back to.
//
// Declaring a cancellation is NOT the end. A subscription cancelled in month
// three of a year runs, is billed and keeps everything until the term ends;
// half of this file is there so that a rule about the end cannot quietly become
// a rule about the declaration.

const PRO = {
    id: 'PRO',
    name: 'Pro',
    tagline: '',
    marketed: true,
    monthlyNet: 49,
    yearlyNet: 490,
    quotas: { users: 50 },
    features: ['EXPORT'],
};
const FREE = {
    id: 'FREE',
    name: 'Free',
    tagline: '',
    marketed: true,
    monthlyNet: 0,
    yearlyNet: 0,
    quotas: { users: 1 },
    features: ['READ_ONLY'],
};
const CATALOG = {
    schemaVersion: 1,
    projectKey: 'demo',
    currency: 'EUR',
    vatRate: 19,
    plans: [PRO, FREE],
};

const NOW = new Date('2026-08-25');
const LANDED = new Date('2026-01-01');
const STILL_TO_COME = new Date('2027-01-01');

function subscription(overrides = {}) {
    return {
        id: 's1',
        tenantId: 't1',
        plan: 'PRO',
        status: 'ACTIVE',
        isPilot: false,
        trialEntitlementPlan: null,
        pendingPlan: null,
        pendingEffectiveAt: null,
        customLimits: null,
        planVersionId: 'pv1',
        planVersion: { planId: 'PRO', quotas: PRO.quotas, features: PRO.features },
        canceledAt: null,
        canceledEffectiveAt: null,
        ...overrides,
    };
}

function limitsFor(sub, { config = null, contract = null, bundles = null } = {}) {
    const service = new EntitlementService(
        CATALOG,
        { findByTenantId: async () => sub },
        {
            findActive: async (planId) => {
                const plan = CATALOG.plans.find((p) => p.id === planId);
                return plan ? { planId, quotas: plan.quotas, features: plan.features } : null;
            },
        },
        { run: async (fn) => fn(undefined) },
        config,
        bundles ? { listActiveBySubscription: async () => bundles } : null,
        bundles ? { findVersionById: async () => null } : null,
        contract ? { findActiveByTenantId: async () => contract } : null,
    );
    return service.computeLimits('t1', NOW);
}

const nothing = (limits, why) => {
    assert.deepEqual(limits.quotas, {}, why);
    assert.deepEqual([...limits.features], [], why);
};

describe('while a subscription is running', () => {
    test('it is granted its plan', async () => {
        const limits = await limitsFor(subscription());

        assert.equal(limits.plan, 'PRO');
        assert.deepEqual([...limits.features], ['EXPORT']);
        assert.deepEqual(limits.quotas, { users: 50 });
    });

    test('and a cancellation still to come changes nothing', async () => {
        // The half that matters most: a customer who cancels in March has paid
        // for the year and keeps every feature until it ends. A rule that reads
        // the declaration instead of the date takes it away nine months early.
        const limits = await limitsFor(
            subscription({
                canceledAt: new Date('2026-03-01'),
                canceledEffectiveAt: STILL_TO_COME,
            }),
        );

        assert.deepEqual([...limits.features], ['EXPORT']);
        assert.deepEqual(limits.quotas, { users: 50 });
    });
});

describe('once the cancellation has taken effect', () => {
    const ended = subscription({ canceledAt: new Date('2025-06-01'), canceledEffectiveAt: LANDED });

    test('nothing is granted', async () => {
        nothing(await limitsFor(ended), 'a subscription that ended still grants its plan');
    });

    test('the plan is still named, so a page can say which one ended', async () => {
        assert.equal((await limitsFor(ended)).plan, 'PRO');
    });

    test('a configured floor is granted instead', async () => {
        const limits = await limitsFor(ended, { config: { canceledEntitlementPlan: 'FREE' } });

        assert.equal(limits.plan, 'FREE');
        assert.deepEqual([...limits.features], ['READ_ONLY']);
        assert.deepEqual(limits.quotas, { users: 1 });
    });

    test('and the floor does not inherit what was bought on top', async () => {
        // Bundles and custom limits belonged to the subscription that ended.
        const withExtras = subscription({
            canceledAt: new Date('2025-06-01'),
            canceledEffectiveAt: LANDED,
            customLimits: { quotas: { users: 999 }, features: ['ADMIN'] },
        });

        const limits = await limitsFor(withExtras, {
            config: { canceledEntitlementPlan: 'FREE' },
            bundles: [
                {
                    id: 'sb1',
                    bundleVersionId: 'bv1',
                    canceledAt: null,
                    canceledEffectiveAt: null,
                },
            ],
        });

        assert.deepEqual(limits.quotas, { users: 1 });
        assert.deepEqual([...limits.features], ['READ_ONLY']);
    });

    test('a contract signed earlier does not outlive it', async () => {
        // A contract is the frozen agreement of the subscription that signed
        // it, so it cannot grant more than the subscription still does.
        const limits = await limitsFor(ended, {
            contract: {
                id: 'c1',
                entitlementSnapshot: { plan: 'PRO', quotas: { users: 50 }, features: ['EXPORT'] },
                lineItems: [],
            },
        });

        nothing(limits, 'an ended subscription kept its contract entitlements');
    });
});

describe('a cancellation older than the fields that describe it', () => {
    test('is read from the only column it has', async () => {
        // The pre-split row: `canceledAt` IS the effective date and the second
        // column is genuinely null. Reading it strictly grants everything for
        // ever, which is the worst of the three possible mistakes here.
        const legacy = subscription({ canceledAt: LANDED, canceledEffectiveAt: null });

        nothing(await limitsFor(legacy), 'a legacy cancellation was read as none');
    });

    test('and a legacy row whose date is still to come keeps everything', async () => {
        const legacy = subscription({ canceledAt: STILL_TO_COME, canceledEffectiveAt: null });

        assert.deepEqual([...(await limitsFor(legacy)).features], ['EXPORT']);
    });
});
