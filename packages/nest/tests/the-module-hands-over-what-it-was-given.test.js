import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SubscriptionBundleModule,
    SUBSCRIPTION_BUNDLE_CONFIG_TOKEN,
} from '../dist/billing/index.js';
import { DEFAULT_BUNDLE_MINIMUM_TERM_MONTHS } from '../dist/billing/index.js';

// What a consumer actually gets from `forRoot`.
//
// The services fall back to `DEFAULT_BUNDLE_MINIMUM_TERM_MONTHS` when their
// config says nothing — and every test of that fallback builds the service by
// hand, so none of them passes through the module. The module sat in between
// filling the value in, which meant the fallback was unreachable in a real Nest
// installation and every add-on stayed committed for twelve months while the
// suite was green.
//
// A default belongs to one layer. This one belongs to the services, because
// they are what a consumer can also construct directly; the module hands over
// what it was given and nothing else.

const REPOS = {
    subscriptionBundleRepository: { useValue: {} },
    bundleRepository: { useValue: {} },
};

const configFrom = (options) => {
    const providers = SubscriptionBundleModule.forRoot(options).providers ?? [];
    const entry = providers.find(
        (p) => typeof p === 'object' && p.provide === SUBSCRIPTION_BUNDLE_CONFIG_TOKEN,
    );
    assert.ok(entry, 'the module must provide the bundle config');
    return entry.useValue;
};

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide
describe('SubscriptionBundleModule.forRoot', () => {
    test('says nothing about the term when the consumer said nothing', () => {
        // Not "provides 0": the module must not decide this at all, or the
        // services' own default becomes decoration again the next time
        // somebody changes one of the two.
        assert.equal(configFrom(REPOS).defaultMinimumTermMonths, undefined);
    });

    test('hands over a term the consumer did configure', () => {
        assert.equal(
            configFrom({ ...REPOS, defaultMinimumTermMonths: 24 }).defaultMinimumTermMonths,
            24,
        );
    });

    test('hands over an explicit zero rather than treating it as unset', () => {
        // `?? 0` and `|| 0` differ here, and a consumer switching a commitment
        // off deliberately must not be given one back.
        assert.equal(
            configFrom({ ...REPOS, defaultMinimumTermMonths: 0 }).defaultMinimumTermMonths,
            0,
        );
    });

    test('and the services then commit the tenant to nothing', () => {
        // The end of the chain: what the module leaves unsaid, the service
        // answers — and its answer is no commitment.
        assert.equal(DEFAULT_BUNDLE_MINIMUM_TERM_MONTHS, 0);
    });
});
