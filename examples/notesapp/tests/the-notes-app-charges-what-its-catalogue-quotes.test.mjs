// A prospect choosing a plan and an add-on on the public catalogue is shown a
// price, and the notes app's contract freeze source writes the line its
// contract and invoice take. The two have to agree: the catalogue asks the
// platform's price rule, and the source has to ask the same one rather than
// read the add-on's own price past a plan's override. DB-free — the catalogue
// runs over the platform's in-memory repositories, filled from the notes app's
// own seed, and the source over a stand-in for its Prisma client.

// @requirement SC-COMP-014 — The example application is kept in step with the platform
// @requirement SC-MKT-030 — The public catalogue names an add-on's price per plan, as its contract takes it

import 'reflect-metadata';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PublicMarketingCatalogService } from '@saasicat/nest/catalog';
import {
    FakeBundleRepository,
    FakeMarketingProjectionRepository,
    FakePlanRepository,
} from '@saasicat/nest/testing';

import { NotesContractFreezeSource } from '../dist/saas/notes-contract-freeze-source.js';
import { BUNDLES, PLANS } from '../dist/seed-catalogue.js';

const ASOF = new Date('2026-11-01T00:00:00Z');
const ON_SALE_FROM = new Date('2026-01-01T00:00:00Z');
const LOCALE = 'en';

/** One rhythm, in the spelling of the catalogue, of a booking and of a contract line. */
const RHYTHMS = [
    { price: 'monthlyNet', booking: 'MONTHLY', line: 'monthly' },
    { price: 'yearlyNet', booking: 'YEARLY', line: 'yearly' },
];

/**
 * Not in the seed, because the demo sells nothing it cannot price: an add-on
 * whose override takes the yearly price away from PRO, so that a combination
 * the catalogue names no price for exists to be checked.
 */
const NO_YEAR_ON_PRO = {
    bundleKey: 'NO_YEAR_ON_PRO',
    label: 'No year on Pro',
    features: [],
    quotas: { notesMax: 50 },
    monthlyNet: 3,
    yearlyNet: 30,
    pricingOverrides: [{ planId: 'PRO', yearlyNet: null }],
};

/** A price as the repositories hand it back: decimal text, or null. */
const asStored = (net) => (net === null ? null : String(net));

async function sellPlan(plans, marketing, seed) {
    await plans.create({ planKey: seed.planKey, label: seed.label });
    const versionId = `pv-${seed.planKey}`;
    plans.seedVersion({
        id: versionId,
        planId: seed.planKey,
        version: 1,
        publishedAt: ON_SALE_FROM,
        supersededAt: null,
        validFrom: ON_SALE_FROM,
        validUntil: null,
        features: seed.features,
        quotas: seed.quotas,
        monthlyNet: asStored(seed.monthlyNet),
        yearlyNet: asStored(seed.yearlyNet),
        marketed: true,
    });
    // The seed markets no plan of its own; this is the entry an operator writes
    // on the marketing page, without which the catalogue shows no plan.
    await marketing.create({
        targetType: 'PLAN',
        targetVersionId: versionId,
        locale: LOCALE,
        displayLabel: seed.label,
        description: '',
        priority: 0,
    });
}

async function sellAddOn(bundles, seed) {
    const bundle = await bundles.create({ bundleKey: seed.bundleKey, label: seed.label });
    const draft = await bundles.createDraft({
        bundleId: bundle.id,
        features: seed.features,
        quotas: seed.quotas,
        monthlyNet: asStored(seed.monthlyNet),
        yearlyNet: asStored(seed.yearlyNet),
        pricingOverrides: seed.pricingOverrides,
        marketed: true,
    });
    await bundles.publishDraft(draft.id, {
        publishedByUserId: null,
        publishedChanges: [],
        nonRegressive: true,
        validFrom: ON_SALE_FROM,
        validUntil: null,
    });
}

/**
 * The source over a notes app whose one subscription is on `planKey`, holding
 * one booking of `bundleVersionId` in `billingCycle`.
 */
function sourceFor(bundles, planKey, bundleVersionId, billingCycle) {
    const prisma = {
        subscription: {
            findUnique: async ({ where }) =>
                where.tenantId === 'acme' ? { id: 'sub-acme', plan: planKey } : null,
        },
    };
    const bookings = {
        listActiveBySubscription: async () => [
            {
                id: 'sb-1',
                subscriptionId: 'sub-acme',
                bundleVersionId,
                startedAt: ASOF,
                minimumTermEndsAt: null,
                canceledAt: null,
                canceledEffectiveAt: null,
                billingCycle,
                currentPeriodStart: null,
                currentPeriodEnd: null,
                pendingBundleVersionId: null,
                pendingVersionEffectiveAt: null,
                pendingAgreement: null,
                agreement: null,
                createdAt: ASOF,
                updatedAt: ASOF,
            },
        ],
    };
    return new NotesContractFreezeSource(prisma, bookings, bundles);
}

/** The line the source writes for the booking, in the plan's own rhythm. */
async function lineFor(bundles, planKey, bundle, rhythm) {
    const source = sourceFor(bundles, planKey, bundle.bundleVersionId, rhythm.booking);
    const { lineItems } = await source.loadBookedBundles('acme', rhythm.line);
    return lineItems[0];
}

let bundles;
let catalogue;

before(async () => {
    const plans = new FakePlanRepository();
    const marketing = new FakeMarketingProjectionRepository();
    bundles = new FakeBundleRepository();
    for (const plan of PLANS) await sellPlan(plans, marketing, plan);
    for (const addOn of [...BUNDLES, NO_YEAR_ON_PRO]) await sellAddOn(bundles, addOn);
    catalogue = await new PublicMarketingCatalogService(
        plans,
        marketing,
        { list: async () => [] },
        null,
        bundles,
    ).getCatalog(LOCALE, 'EUR', 19, ASOF);
});

/** Every add-on × plan × rhythm the catalogue names a price for. */
function pricedCombinations() {
    return catalogue.bundles.flatMap((bundle) =>
        bundle.planPrices.flatMap((planPrice) =>
            RHYTHMS.filter((rhythm) => planPrice[rhythm.price] !== null).map((rhythm) => ({
                bundle,
                planPrice,
                rhythm,
            })),
        ),
    );
}

/**
 * Every add-on × plan × rhythm a prospect could choose — the plan is sold in
 * the rhythm — that the catalogue names no price for. No add-on here is
 * restricted to some plans, so each of them lacks a price and nothing else.
 */
function unpricedCombinations() {
    return catalogue.bundles.flatMap((bundle) =>
        catalogue.plans.flatMap((plan) =>
            RHYTHMS.filter((rhythm) => plan[rhythm.price] !== null)
                .filter((rhythm) => {
                    const planPrice = bundle.planPrices.find(
                        (entry) => entry.planKey === plan.planKey,
                    );
                    return (planPrice?.[rhythm.price] ?? null) === null;
                })
                .map((rhythm) => ({ bundle, planKey: plan.planKey, rhythm })),
        ),
    );
}

describe("the notes app's contract, beside its public catalogue", () => {
    test("writes each add-on's line at the price the catalogue names beside the plan", async () => {
        const combinations = pricedCombinations();
        assert.ok(combinations.length > 0, 'the catalogue names no add-on price at all');

        for (const { bundle, planPrice, rhythm } of combinations) {
            const line = await lineFor(bundles, planPrice.planKey, bundle, rhythm);
            assert.equal(
                line.priceNet,
                planPrice[rhythm.price],
                `${bundle.bundleKey} beside ${planPrice.planKey}, ${rhythm.line}`,
            );
            assert.equal(line.billingCycle, rhythm.line);
            assert.equal(line.sourceVersionId, bundle.bundleVersionId);
        }
    });

    test("takes a plan's override, not the add-on's own price, where the seed sets one", () => {
        const overridden = pricedCombinations().filter(
            ({ bundle, planPrice, rhythm }) => planPrice[rhythm.price] !== bundle[rhythm.price],
        );

        // Without a combination whose price is not the add-on's own, the test
        // above could not tell the two prices apart.
        assert.ok(overridden.length > 0, 'the seed overrides no add-on price for a plan');
    });

    test('refuses a booking the catalogue names no price for, rather than writing 0', async () => {
        const combinations = unpricedCombinations();
        assert.deepEqual(
            combinations.map(({ bundle, planKey, rhythm }) => [
                bundle.bundleKey,
                planKey,
                rhythm.line,
            ]),
            [['NO_YEAR_ON_PRO', 'PRO', 'yearly']],
        );

        for (const { bundle, planKey, rhythm } of combinations) {
            await assert.rejects(lineFor(bundles, planKey, bundle, rhythm), (error) =>
                error.message.includes(`no ${rhythm.line} price for plan ${planKey}`),
            );
        }
    });
});
