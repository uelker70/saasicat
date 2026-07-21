// useSubscriptionDraft — reactive configuration state + derived prices.
// Tests against the built bundle (`dist/index.js`) without DOM/Vue Test Utils —
// the composable is HTTP-free and reactivity-only, so directly callable.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { useSubscriptionDraft, DEFAULT_YEARLY_FACTOR } from '../dist/index.js';
import { ref } from 'vue';

const PLANS = [
    {
        id: 'STARTER',
        name: 'Allgemein',
        tagline: 'Verein, Förderverein, Stiftung',
        monthlyNet: 9.9,
        yearlyNet: 99,
        popular: false,
        quotas: { members: 100, storageGb: 5, admins: 3 },
        features: ['CORE_MEMBERS'],
    },
    {
        id: 'SPORT',
        name: 'Sportverein',
        tagline: 'Mit Mannschaften, Turnieren',
        monthlyNet: 19.9,
        yearlyNet: 199,
        popular: true,
        quotas: { members: 200, storageGb: 10, admins: 5 },
        features: ['CORE_MEMBERS', 'TEAMS'],
    },
];

const BUNDLES = [
    {
        bundleKey: 'SPORTPAKET',
        label: 'Sportpaket',
        bundleVersionId: 'bv-sport',
        monthlyNet: 16.9,
        yearlyNet: 169,
        description: '',
        features: ['TRAINING_PLANNER', 'TEAMS', 'TOURNAMENT'],
        quotas: {},
        promo: null,
        compatiblePlanKeys: [],
    },
    {
        bundleKey: 'NUR_SPORT',
        label: 'Nur für Sportvereine',
        bundleVersionId: 'bv-only-sport',
        monthlyNet: 5,
        yearlyNet: 50,
        description: '',
        features: ['FIELD_MGMT'],
        quotas: {},
        promo: null,
        compatiblePlanKeys: ['SPORT'],
    },
];

function buildDraft(overrides = {}) {
    return useSubscriptionDraft({
        plans: ref(overrides.plans ?? PLANS),
        subscriptionBundles: ref(overrides.subscriptionBundles ?? BUNDLES),
        // explicit null must be allowed → don't default via `??`
        initialPlan: 'initialPlan' in overrides ? overrides.initialPlan : 'SPORT',
        initialCycle: overrides.initialCycle ?? 'MONTHLY',
        initialBundleVersionIds: overrides.initialBundleVersionIds,
    });
}

describe('useSubscriptionDraft — plan selection', () => {
    test('selectedPlan is null before selection', () => {
        const d = buildDraft({ initialPlan: null });
        assert.equal(d.selectedPlan.value, null);
        assert.equal(d.pricing.value.planNet, 0);
    });

    test('setPlan removes bundles incompatible with the new plan', () => {
        const d = buildDraft({ initialPlan: 'SPORT' });
        d.toggleSubscriptionBundle('bv-only-sport');
        assert.equal(d.selectedBundleVersionIds.value.has('bv-only-sport'), true);

        d.setPlan('STARTER');
        assert.equal(
            d.selectedBundleVersionIds.value.has('bv-only-sport'),
            false,
            'NUR_SPORT is only compatible with SPORT → must be removed',
        );
        assert.equal(d.selectedPlan.value.id, 'STARTER');
    });

    test('setPlan keeps universally compatible bundles', () => {
        const d = buildDraft({ initialPlan: 'SPORT' });
        d.toggleSubscriptionBundle('bv-sport');
        d.setPlan('STARTER');
        assert.equal(d.selectedBundleVersionIds.value.has('bv-sport'), true);
    });
});

describe('useSubscriptionDraft — cycle toggle', () => {
    test('Monthly uses monthlyNet, Yearly uses yearlyNet', () => {
        const d = buildDraft({ initialPlan: 'SPORT', initialCycle: 'MONTHLY' });
        assert.equal(d.pricing.value.planNet, 19.9);

        d.setCycle('YEARLY');
        assert.equal(d.pricing.value.planNet, 199);
    });

    test('yearSavings = 12*monthly − yearly', () => {
        const d = buildDraft({ initialPlan: 'SPORT' });
        // SPORT: monthly 19.9 × 12 = 238.80, yearly 199 → savings 39.80
        assert.equal(Math.round(d.pricing.value.yearSavings * 100), 3980);
    });

    test('yearlyNet=null falls back to monthly × DEFAULT_YEARLY_FACTOR', () => {
        const plansNoYearly = [
            {
                id: 'X',
                name: 'X',
                tagline: '',
                monthlyNet: 10,
                yearlyNet: null,
                popular: false,
                quotas: {},
                features: [],
            },
        ];
        const d = buildDraft({ plans: plansNoYearly, initialPlan: 'X', initialCycle: 'YEARLY' });
        assert.equal(d.pricing.value.planNet, 10 * DEFAULT_YEARLY_FACTOR);
    });
});

describe('useSubscriptionDraft — Bundles', () => {
    test('Bundle toggle marks bundle + activates its features', () => {
        const d = buildDraft({ initialPlan: 'SPORT' });
        d.toggleSubscriptionBundle('bv-sport');
        assert.equal(d.selectedBundleVersionIds.value.has('bv-sport'), true);
        assert.equal(d.activeFeatures.value.has('TRAINING_PLANNER'), true);
        assert.equal(d.activeFeatures.value.has('TOURNAMENT'), true);
        // TEAMS is also included in SPORT — no matter, the active set contains it only once
        assert.equal(d.activeFeatures.value.has('TEAMS'), true);
    });

    test('Bundle deselect removes activated features again', () => {
        const d = buildDraft({ initialPlan: 'SPORT' });
        d.toggleSubscriptionBundle('bv-sport');
        d.toggleSubscriptionBundle('bv-sport');
        assert.equal(d.selectedBundleVersionIds.value.size, 0);
        assert.equal(d.activeFeatures.value.has('TRAINING_PLANNER'), false);
    });

    test('Bundle price flows into subtotalNet', () => {
        const d = buildDraft({ initialPlan: 'SPORT' });
        const beforeNet = d.pricing.value.subtotalNet;
        d.toggleSubscriptionBundle('bv-sport');
        // SPORT 19.9 + bundle 16.9 = 36.80 (×100 because of FP drift)
        assert.equal(Math.round(d.pricing.value.subtotalNet * 100), 3680);
        assert.ok(d.pricing.value.subtotalNet > beforeNet);
        assert.equal(d.pricing.value.breakdown.bundles.length, 1);
        assert.equal(d.pricing.value.breakdown.bundles[0].key, 'subscription-bundle:bv-sport');
    });
});

describe('useSubscriptionDraft — Promo-Discount', () => {
    test('PERCENT promo is applied to subtotalNet', () => {
        const d = buildDraft({ initialPlan: 'SPORT' });
        d.setPromoCode('TEST20');
        d.setPromoState({
            status: 'valid',
            preview: {
                valid: true,
                code: 'TEST20',
                label: '20% Rabatt',
                discount: {
                    valueType: 'PERCENT',
                    value: '20',
                    durationType: 'ONCE',
                    durationValue: null,
                },
                price: {
                    originalGross: '0',
                    discountGross: '0',
                    discountedGross: '0',
                    includedVat: '0',
                    nextRegularAmountGross: '0',
                    regularStartsAt: null,
                },
            },
            message: 'OK',
        });
        // SPORT 19.9 × 0.2 = 3.98 → total 19.90 − 3.98 = 15.92
        assert.equal(Math.round(d.pricing.value.discountNet * 100), 398);
        assert.equal(Math.round(d.pricing.value.totalNet * 100), 1592);
    });

    test('ABSOLUTE promo is capped at subtotal', () => {
        const d = buildDraft({ initialPlan: 'STARTER' });
        d.setPromoCode('FREE100');
        d.setPromoState({
            status: 'valid',
            preview: {
                valid: true,
                code: 'FREE100',
                label: '100€ Rabatt',
                discount: {
                    valueType: 'ABSOLUTE',
                    value: '100',
                    durationType: 'ONCE',
                    durationValue: null,
                },
                price: {
                    originalGross: '0',
                    discountGross: '0',
                    discountedGross: '0',
                    includedVat: '0',
                    nextRegularAmountGross: '0',
                    regularStartsAt: null,
                },
            },
            message: 'OK',
        });
        // STARTER 9.90, ABSOLUTE 100 → capped at 9.90, total = 0
        assert.equal(d.pricing.value.discountNet, 9.9);
        assert.equal(d.pricing.value.totalNet, 0);
    });

    test('clearPromo removes discount + sets status idle', () => {
        const d = buildDraft();
        d.setPromoCode('X');
        d.setPromoState({ status: 'valid', preview: null, message: '' });
        d.clearPromo();
        assert.equal(d.promoCode.value, '');
        assert.equal(d.promoState.value.status, 'idle');
    });

    test('setPromoCode clears a previous valid status', () => {
        const d = buildDraft();
        d.setPromoCode('OLDCODE');
        d.setPromoState({ status: 'valid', preview: null, message: 'OK' });
        d.setPromoCode('NEWCODE');
        // Status must go back to idle because the tenant types a new code
        assert.equal(d.promoState.value.status, 'idle');
    });
});

describe('useSubscriptionDraft — toApiPayload', () => {
    test('serializes plan + cycle + bundle version IDs', () => {
        const d = buildDraft({ initialPlan: 'SPORT', initialCycle: 'YEARLY' });
        d.toggleSubscriptionBundle('bv-sport');

        const payload = d.toApiPayload();
        assert.equal(payload.plan, 'SPORT');
        assert.equal(payload.billingCycle, 'YEARLY');
        assert.deepEqual(payload.bundleVersionIds, ['bv-sport']);
    });

    test('without bundle selection bundleVersionIds is missing from the payload', () => {
        const d = buildDraft({ initialPlan: 'SPORT' });
        assert.equal(d.toApiPayload().bundleVersionIds, undefined);
    });

    test('serializes promoCode only when status is valid', () => {
        const d = buildDraft();
        d.setPromoCode('TEST20');
        // status idle → no promoCode
        assert.equal(d.toApiPayload().promoCode, undefined);

        d.setPromoState({ status: 'valid', preview: null, message: 'OK' });
        assert.equal(d.toApiPayload().promoCode, 'TEST20');
    });

    test('throws when plan is not set', () => {
        const d = buildDraft({ initialPlan: null });
        assert.throws(() => d.toApiPayload(), /plan ist nicht gesetzt/);
    });
});

describe('useSubscriptionDraft — redundant (covered) bundles', () => {
    // Repro: plan STANDARD={features:[C]}-free; Y={C}, Z={C,D}. Y is fully
    // covered by plan ∪ Z → must be neither charged nor sent.
    const STANDARD = {
        id: 'STANDARD',
        name: 'Standard',
        tagline: '',
        monthlyNet: 10,
        yearlyNet: 100,
        popular: false,
        quotas: {},
        features: [],
    };
    const Y = {
        bundleKey: 'Y',
        label: 'Bundle Y',
        bundleVersionId: 'bv-y',
        monthlyNet: 4,
        yearlyNet: 40,
        description: '',
        features: ['C'],
        quotas: {},
        promo: null,
        compatiblePlanKeys: [],
    };
    const Z = {
        bundleKey: 'Z',
        label: 'Bundle Z',
        bundleVersionId: 'bv-z',
        monthlyNet: 7,
        yearlyNet: 70,
        description: '',
        features: ['C', 'D'],
        quotas: {},
        promo: null,
        compatiblePlanKeys: [],
    };

    function buildOverlapDraft() {
        return buildDraft({
            plans: [STANDARD],
            subscriptionBundles: [Y, Z],
            initialPlan: 'STANDARD',
        });
    }

    test('covered bundle does not flow into bundlesNet nor into the breakdown', () => {
        const d = buildOverlapDraft();
        d.toggleSubscriptionBundle('bv-y');
        d.toggleSubscriptionBundle('bv-z');
        // Only Z is charged (7), Y is covered by Z.
        assert.equal(d.pricing.value.bundlesNet, 7);
        assert.equal(d.pricing.value.subtotalNet, 17);
        const keys = d.pricing.value.breakdown.bundles.map((b) => b.key);
        assert.deepEqual(keys, ['subscription-bundle:bv-z']);
    });

    test('covered bundle is missing from toApiPayload().bundleVersionIds', () => {
        const d = buildOverlapDraft();
        d.toggleSubscriptionBundle('bv-y');
        d.toggleSubscriptionBundle('bv-z');
        assert.deepEqual(d.toApiPayload().bundleVersionIds, ['bv-z']);
    });

    test('deselecting the covering bundle charges the other one again', () => {
        const d = buildOverlapDraft();
        d.toggleSubscriptionBundle('bv-y');
        d.toggleSubscriptionBundle('bv-z');
        assert.equal(d.pricing.value.bundlesNet, 7);

        d.toggleSubscriptionBundle('bv-z');
        // Y stands alone → charged + sent again.
        assert.equal(d.pricing.value.bundlesNet, 4);
        assert.deepEqual(d.toApiPayload().bundleVersionIds, ['bv-y']);
    });

    // Mutual coverage: Y={C} and Z={C} cover each other. A
    // one-time filter would discard BOTH (under-charging + lost
    // entitlement for C). The iterative selection keeps exactly ONE.
    test('mutual coverage Y={C},Z={C} → exactly ONE bundle charged + sent', () => {
        const C_ONLY = {
            bundleKey: 'C2',
            label: 'Bundle C2',
            bundleVersionId: 'bv-z',
            monthlyNet: 7,
            yearlyNet: 70,
            description: '',
            features: ['C'],
            quotas: {},
            promo: null,
            compatiblePlanKeys: [],
        };
        const d = buildDraft({
            plans: [STANDARD],
            subscriptionBundles: [Y, C_ONLY],
            initialPlan: 'STANDARD',
        });
        d.toggleSubscriptionBundle('bv-y');
        d.toggleSubscriptionBundle('bv-z');

        // Exactly ONE bundle remains (not null) — deterministically bv-z
        // (bundleVersionId asc → bv-y checked first + discarded).
        const ids = d.toApiPayload().bundleVersionIds;
        assert.equal(ids.length, 1);
        assert.deepEqual(ids, ['bv-z']);
        assert.equal(d.pricing.value.bundlesNet, 7);
        assert.equal(d.pricing.value.breakdown.bundles.length, 1);
        // Feature C stays active (entitlement not lost).
        assert.equal(d.activeFeatures.value.has('C'), true);
    });
});

describe('useSubscriptionDraft — isDirty', () => {
    test('false with fresh state', () => {
        const d = buildDraft();
        assert.equal(d.isDirty.value, false);
    });

    test('true as soon as a bundle is added', () => {
        const d = buildDraft();
        d.toggleSubscriptionBundle('bv-sport');
        assert.equal(d.isDirty.value, true);
    });
});
