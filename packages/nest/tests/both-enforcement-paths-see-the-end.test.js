import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { EntitlementService } from '../dist/entitlement/index.js';
import { givenPlanCatalogSource } from '../dist/billing/index.js';
import { SaaSiCatModule, SubscriptionPlanResolver } from '../dist/platform/index.js';
import { PLAN_RESOLVER_PORT_TOKEN } from '../dist/testing/index.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';
import {
    CATALOG,
    entitlementServiceFor,
    subscriptionRecord as subscription,
} from './helpers/subscription-fixtures.js';

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

const LANDED = new Date('2026-01-01');

const repository = (sub) => ({ findByTenantId: async () => sub });

// @requirement SC-ENTL-015 — The end of a subscription is seen on every enforcement path
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

/** Every provider a module and the modules it imports declare. */
function providersOf(module, seen = new Set()) {
    if (!module || seen.has(module)) return [];
    seen.add(module);
    return [
        ...(module.providers ?? []),
        ...(module.imports ?? []).flatMap((imported) => providersOf(imported, seen)),
    ];
}

// @requirement SC-ENTL-015 — The end of a subscription is seen on every enforcement path
describe('the floor the module options name, in the composed module', () => {
    // The default stack reaches its resolver through the composition, which
    // reads the floor from `entitlement.resolutionConfig` — the option
    // `EntitlementService` reads. Without a resolver of the application's own,
    // tenant billing resolves plans through the subscriptions.
    const ended = subscription({ canceledAt: LANDED, canceledEffectiveAt: LANDED });

    async function floorFor(entitlement) {
        const options = bootable(everythingOnOptions());
        const { planResolver: _own, ...adapters } = options.adapters;
        const resolver = providersOf(SaaSiCatModule.forRoot({ ...options, adapters, entitlement }))
            .find((provider) => provider?.provide === PLAN_RESOLVER_PORT_TOKEN)
            .useFactory({ findByTenantId: async () => ended });
        assert.ok(resolver instanceof SubscriptionPlanResolver);
        return resolver.getPlanIdForTenant('t1');
    }

    for (const [what, entitlement, floor] of [
        ['without entitlement options', undefined, null],
        ['with entitlement turned off', false, null],
        ['with entitlement turned on and nothing set', true, null],
        ['with a null, as a configuration read from JSON can hold', null, null],
        [
            'with a floor configured',
            { resolutionConfig: { canceledEntitlementPlan: 'FREE' } },
            'FREE',
        ],
    ]) {
        test(`is ${floor ?? 'nothing'} ${what}`, async () => {
            assert.equal(await floorFor(entitlement), floor);
        });
    }
});

// @requirement SC-ENTL-016 — An answer computed before an end date arrives is not served after it
describe('a cached answer at the cancellation boundary', () => {
    const LANDS = new Date('2026-08-25T12:00:00.000Z');
    const ending = subscription({
        canceledAt: new Date('2026-06-01'),
        canceledEffectiveAt: LANDS,
    });

    function service() {
        return entitlementServiceFor(EntitlementService, ending);
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
            givenPlanCatalogSource(CATALOG),
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
