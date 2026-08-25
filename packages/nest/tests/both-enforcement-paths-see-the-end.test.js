import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { EntitlementService } from '../dist/entitlement/index.js';
import { SubscriptionPlanResolver } from '../dist/platform/index.js';

// Entitlements are enforced along two paths, and a rule written in one of them
// is enforced in half the applications.
//
// `EntitlementService` answers the tenant billing stack. The DEFAULT stack —
// `StaticFeatureGuard` and `EnforceQuotaInterceptor`, which an app gets without
// registering tenant billing at all — reaches its plan through
// `SubscriptionPlanResolver`, and that resolver asked one question: is the
// status ACTIVE or TRIAL? Nothing transitions that column when a cancellation
// lands, so a subscription that ended last January answered yes, and every
// feature and quota of the plan it no longer had was granted indefinitely.
//
// The second half is time. A cached answer is invalidated by mutations, and a
// date arriving is not a mutation: limits computed a minute before the
// cancellation lands were served for up to a minute after it.

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

const LANDED = new Date('2026-01-01');

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

const repository = (sub) => ({ findByTenantId: async () => sub });

describe('the default enforcement stack', () => {
    // What `StaticFeatureGuard` and `EnforceQuotaInterceptor` resolve through.
    const resolve = (sub, floor = null) =>
        new SubscriptionPlanResolver(repository(sub), undefined, floor).getPlanIdForTenant('t1');

    test('grants nothing once the cancellation has landed', async () => {
        // The row still says ACTIVE, and always will — that is the point.
        const ended = subscription({ canceledAt: LANDED, canceledEffectiveAt: LANDED });

        assert.equal(await resolve(ended), null);
    });

    test('grants the configured floor instead, where one is configured', async () => {
        // The two paths must not disagree about what a cancelled subscription
        // keeps; both read the same option.
        const ended = subscription({ canceledAt: LANDED, canceledEffectiveAt: LANDED });

        assert.equal(await resolve(ended, 'FREE'), 'FREE');
    });

    test('while a cancellation still to come grants everything', async () => {
        // The premise, and the half that a rule about "cancelled" gets wrong: a
        // customer who cancels in March keeps the plan they paid for.
        const ending = subscription({
            canceledAt: new Date('2026-03-01'),
            canceledEffectiveAt: new Date('2027-01-01'),
        });

        assert.equal(await resolve(ending), 'PRO');
    });

    test('and an uncancelled subscription is unaffected', async () => {
        assert.equal(await resolve(subscription()), 'PRO');
    });
});

describe('a cached answer at the cancellation boundary', () => {
    const LANDS = new Date('2026-08-25T12:00:00.000Z');
    const ending = subscription({
        canceledAt: new Date('2026-06-01'),
        canceledEffectiveAt: LANDS,
    });

    function service() {
        return new EntitlementService(
            CATALOG,
            repository(ending),
            { findActive: async () => null },
            { run: async (fn) => fn(undefined) },
        );
    }

    test('is not served past the moment it ends', async () => {
        const svc = service();
        // Computed a second before the end, which caches it for sixty.
        const before = await svc.computeLimits('t1', new Date(LANDS.getTime() - 1_000));
        assert.deepEqual([...before.features], ['EXPORT']);

        // One millisecond after. Nothing mutated the subscription, so nothing
        // invalidated the entry — only the cap can.
        const after = await svc.computeLimits('t1', new Date(LANDS.getTime() + 1));

        assert.deepEqual([...after.features], [], 'the ended contract kept its features');
        assert.deepEqual(after.quotas, {});
    });

    test('and is still served inside its ordinary lifetime', async () => {
        // The premise: the cap shortens one entry, it does not disable caching.
        const svc = service();
        const at = new Date(LANDS.getTime() - 30_000);
        await svc.computeLimits('t1', at);

        let reads = 0;
        const counting = new EntitlementService(
            CATALOG,
            {
                findByTenantId: async () => {
                    reads += 1;
                    return ending;
                },
            },
            { findActive: async () => null },
            { run: async (fn) => fn(undefined) },
        );
        await counting.computeLimits('t1', at);
        await counting.computeLimits('t1', new Date(at.getTime() + 1_000));

        assert.equal(reads, 1, 'the second read went to the repository');
    });
});
