import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionBundlePreviewService } from '../dist/billing/index.js';
import { PublicMarketingCatalogService } from '../dist/catalog/index.js';
import { CheckoutOfferPricing } from '../dist/checkout-offer/index.js';
import {
    FakeBundleRepository,
    FakeMarketingProjectionRepository,
    FakePlanRepository,
    FakeSubscriptionBundleRepository,
} from '../dist/testing/index.js';

// A prospect picks a plan and add-ons on the public catalogue and is shown what
// they cost. What it is shown is what a booking of the same choice writes into
// its contract: the checkout offer a sign-up concludes, and the booking a tenant
// already on that plan makes. Neither the catalogue nor these tests decide the
// price; they ask the one rule (`resolveBundlePriceNet`) and the one promotion
// choice (`promotionOnPrice`) each, and the tests hold the answers together.
//
// The combinations come from the catalogue itself, never from a list kept
// here, so an add-on, a plan or an override added to the fixture is checked
// without anybody adding a case for it.

const ASOF = new Date('2026-06-01T00:00:00Z');
const LOCALE = 'de';
const VAT = 19;

/** One rhythm, in the spelling each side of the comparison uses. */
const RHYTHMS = [
    {
        price: 'monthlyNet',
        discounted: 'discountedMonthlyNet',
        offer: 'monthly',
        booking: 'MONTHLY',
    },
    {
        price: 'yearlyNet',
        discounted: 'discountedYearlyNet',
        offer: 'yearly',
        booking: 'YEARLY',
    },
];

let planRepo;
let bundleRepo;
let marketingRepo;
let promotions;

beforeEach(async () => {
    planRepo = new FakePlanRepository();
    bundleRepo = new FakeBundleRepository();
    marketingRepo = new FakeMarketingProjectionRepository();
    promotions = [];

    // The catalogue lists plans by priority, highest first.
    await sellPlan({ planKey: 'BASIC', priority: 3, monthlyNet: '49.00', yearlyNet: '490.00' });
    await sellPlan({ planKey: 'PRO', priority: 2, monthlyNet: '99.00', yearlyNet: '990.00' });
    await sellPlan({ planKey: 'MONTHLY_ONLY', priority: 1, monthlyNet: '19.00', yearlyNet: null });
    // On sale, but not marketed: no prospect can choose it.
    await sellPlan({ planKey: 'LEGACY', marketed: false, monthlyNet: '9.00', yearlyNet: '90.00' });

    // #525: 10.00 net, and 15.00 net for BASIC.
    await sellAddOn({
        key: 'STORAGE',
        monthlyNet: '10.00',
        yearlyNet: '100.00',
        pricingOverrides: [{ planId: 'BASIC', monthlyNet: '15.00', yearlyNet: '150.00' }],
    });
    // Priced for one plan only, which `SC-BUN-019` allows.
    await sellAddOn({
        key: 'ONLY_PRO',
        monthlyNet: null,
        yearlyNet: null,
        pricingOverrides: [{ planId: 'PRO', monthlyNet: '3.00', yearlyNet: '30.00' }],
    });
    // An override that takes a rhythm away from one plan.
    await sellAddOn({
        key: 'NO_YEAR_ON_BASIC',
        monthlyNet: '5.00',
        yearlyNet: '50.00',
        pricingOverrides: [{ planId: 'BASIC', yearlyNet: null }],
    });
    // Restricted to a plan the catalogue offers and one it does not.
    await sellAddOn({
        key: 'RESTRICTED',
        monthlyNet: '7.00',
        yearlyNet: '70.00',
        compatibility: { planIds: ['PRO', 'LEGACY'] },
    });

    promotions.push(
        bundlePromotion({ id: 'storage-20', appliesTo: ['STORAGE'], type: 'percent', value: 20 }),
        bundlePromotion({ id: 'only-pro-1', appliesTo: ['ONLY_PRO'], type: 'amount', value: 1 }),
    );
});

async function sellPlan({ planKey, priority = 0, monthlyNet, yearlyNet, marketed = true }) {
    await planRepo.create({ planKey, label: planKey });
    const versionId = `pv-${planKey}`;
    // What a version on sale needs for pricing; the rest of the row is read by nothing here.
    planRepo.seedVersion({
        id: versionId,
        planId: planKey,
        version: 1,
        publishedAt: '2026-01-01T00:00:00Z',
        supersededAt: null,
        validFrom: '2026-01-01',
        validUntil: null,
        features: ['CORE'],
        quotas: {},
        monthlyNet,
        yearlyNet,
        marketed,
    });
    if (!marketed) return;
    await marketingRepo.create({
        targetType: 'PLAN',
        targetVersionId: versionId,
        locale: LOCALE,
        displayLabel: planKey,
        description: '',
        priority,
    });
}

async function sellAddOn({ key, monthlyNet, yearlyNet, pricingOverrides = [], compatibility }) {
    const bundle = await bundleRepo.create({ bundleKey: key, label: key });
    const draft = await bundleRepo.createDraft({
        bundleId: bundle.id,
        features: [`${key}_FEATURE`],
        monthlyNet,
        yearlyNet,
        pricingOverrides,
        compatibility: compatibility ?? {},
        marketed: true,
    });
    return bundleRepo.publishDraft(draft.id, {
        publishedByUserId: null,
        publishedChanges: [],
        nonRegressive: true,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validUntil: null,
    });
}

function bundlePromotion({ id, appliesTo, type, value }) {
    return {
        id,
        internalLabel: id,
        type,
        value,
        appliesTo,
        targetType: 'BUNDLE',
        billingCycle: 'both',
        validFrom: '2026-01-01',
        validTo: '2099-12-31',
        priority: 1,
        onlyLocales: null,
        requiresCoupon: false,
        codes: [],
        color: '#000000',
        i18n: { [LOCALE]: { badge: id } },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
    };
}

function catalogue() {
    return new PublicMarketingCatalogService(
        planRepo,
        marketingRepo,
        { list: async () => promotions },
        null,
        bundleRepo,
    ).getCatalog(LOCALE, 'EUR', VAT, ASOF);
}

function offerPricing() {
    return new CheckoutOfferPricing(
        { vatRate: VAT, currency: 'EUR' },
        planRepo,
        bundleRepo,
        { list: async () => promotions },
        null,
        null,
    );
}

function bookingPreview() {
    return new SubscriptionBundlePreviewService(
        new FakeSubscriptionBundleRepository(),
        bundleRepo,
        planRepo,
    );
}

/** What a sign-up choosing this add-on beside this plan concludes: its list price, and what is charged. */
async function offerFor(bundle, planKey, rhythm) {
    const priced = await offerPricing().price(
        {
            planKey,
            billingCycle: rhythm.offer,
            bundleVersionIds: [bundle.bundleVersionId],
            promoCode: null,
            locale: LOCALE,
        },
        ASOF,
    );
    const line = priced.lineItems.find((item) => item.sourceKey === bundle.bundleKey);
    const promotion = priced.promotionSnapshots.find((snapshot) =>
        snapshot.appliesTo.includes(bundle.bundleKey),
    );
    return {
        listNet: line.priceNet,
        discountedNet: promotion ? toCents(line.priceNet - promotion.resolvedAmountNet) : null,
    };
}

/** What a tenant already on this plan is quoted for booking the add-on. */
function bookingFor(bundle, planKey, rhythm) {
    return bookingPreview().previewAdd(
        {
            subscriptionId: 'sub-a',
            currentPlanKey: planKey,
            billingCycle: rhythm.booking,
            status: 'ACTIVE',
            startedAt: new Date('2026-01-01T00:00:00Z'),
            currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
            parentEndsAt: null,
            plansAhead: [],
        },
        { bundleVersionId: bundle.bundleVersionId },
        ASOF,
    );
}

function toCents(amount) {
    return Math.round(amount * 100) / 100;
}

/** Every add-on × plan × rhythm the catalogue names a price for. */
function pricedCombinations(cat) {
    return cat.bundles.flatMap((bundle) =>
        bundle.planPrices.flatMap((planPrice) =>
            RHYTHMS.filter((rhythm) => planPrice[rhythm.price] !== null).map((rhythm) => ({
                bundle,
                planPrice,
                rhythm,
            })),
        ),
    );
}

/** Every add-on × plan × rhythm a prospect could choose that the catalogue names no price for. */
function unpricedCombinations(cat) {
    return cat.bundles.flatMap((bundle) =>
        cat.plans.flatMap((plan) =>
            RHYTHMS.filter((rhythm) => plan[rhythm.price] !== null)
                .filter((rhythm) => {
                    const planPrice = bundle.planPrices.find((p) => p.planKey === plan.planKey);
                    return !planPrice || planPrice[rhythm.price] === null;
                })
                .map((rhythm) => ({ bundle, planKey: plan.planKey, rhythm })),
        ),
    );
}

const named = ({ bundle, planKey, planPrice, rhythm }) =>
    `${bundle.bundleKey} on ${planKey ?? planPrice.planKey}, ${rhythm.offer}`;

// @requirement SC-MKT-030 — The public catalogue names an add-on's price per plan, as its contract takes it
// @requirement SC-BUN-006 — The price an add-on is advertised at is the price it is booked at
describe('every price the public catalogue names for an add-on', () => {
    test('is the list price a sign-up concluding that choice puts into its contract', async () => {
        const combinations = pricedCombinations(await catalogue());
        // STORAGE 5, ONLY_PRO 2, NO_YEAR_ON_BASIC 4, RESTRICTED 2: an entry the
        // catalogue drops would otherwise pass unnoticed.
        assert.equal(combinations.length, 13);
        for (const combination of combinations) {
            const { bundle, planPrice, rhythm } = combination;
            const offer = await offerFor(bundle, planPrice.planKey, rhythm);
            assert.equal(planPrice[rhythm.price], offer.listNet, named(combination));
        }
    });

    test('is, after its promotion, what that sign-up is charged', async () => {
        for (const combination of pricedCombinations(await catalogue())) {
            const { bundle, planPrice, rhythm } = combination;
            const offer = await offerFor(bundle, planPrice.planKey, rhythm);
            assert.equal(planPrice[rhythm.discounted], offer.discountedNet, named(combination));
        }
    });

    test('is what a tenant on that plan is quoted for booking it', async () => {
        for (const combination of pricedCombinations(await catalogue())) {
            const { bundle, planPrice, rhythm } = combination;
            const preview = await bookingFor(bundle, planPrice.planKey, rhythm);
            assert.deepEqual(preview.blockers, [], named(combination));
            assert.equal(planPrice[rhythm.price], preview.nextPeriodPriceNet, named(combination));
        }
    });

    test('is missing exactly where a sign-up and a booking are both refused', async () => {
        const combinations = unpricedCombinations(await catalogue());
        assert.ok(combinations.length > 0, 'the fixture offers no unpriced combination');
        for (const combination of combinations) {
            const { bundle, planKey, rhythm } = combination;
            await assert.rejects(
                offerFor(bundle, planKey, rhythm),
                (error) => error.status === 422,
                named(combination),
            );
            const preview = await bookingFor(bundle, planKey, rhythm);
            assert.notDeepEqual(preview.blockers, [], named(combination));
        }
    });
});

// @requirement SC-MKT-030 — The public catalogue names an add-on's price per plan, as its contract takes it
describe('what the catalogue names, case by case', () => {
    const addOn = async (key) => (await catalogue()).bundles.find((b) => b.bundleKey === key);
    const forPlan = (bundle, planKey) => bundle.planPrices.find((p) => p.planKey === planKey);

    test('an add-on priced for one plan names that price for it, and the base price beside it', async () => {
        const storage = await addOn('STORAGE');
        assert.deepEqual(forPlan(storage, 'BASIC'), {
            planKey: 'BASIC',
            monthlyNet: 15,
            yearlyNet: 150,
            discountedMonthlyNet: 12,
            discountedYearlyNet: 120,
        });
        assert.equal(forPlan(storage, 'PRO').monthlyNet, 10);
        // An application reading only the base price keeps reading it.
        assert.equal(storage.monthlyNet, 10);
        assert.equal(storage.yearlyNet, 100);
    });

    test('names the plans in the order the catalogue lists them', async () => {
        const storage = await addOn('STORAGE');
        const plans = (await catalogue()).plans.map((plan) => plan.planKey);
        assert.deepEqual(plans, ['BASIC', 'PRO', 'MONTHLY_ONLY']);
        assert.deepEqual(
            storage.planPrices.map((p) => p.planKey),
            plans,
        );
    });

    test('an add-on with no base price is still offered, for the plan that prices it', async () => {
        const onlyPro = await addOn('ONLY_PRO');
        assert.ok(onlyPro, 'the add-on vanished from the catalogue');
        assert.deepEqual(onlyPro.planPrices, [
            {
                planKey: 'PRO',
                monthlyNet: 3,
                yearlyNet: 30,
                discountedMonthlyNet: 2,
                discountedYearlyNet: 29,
            },
        ]);
        // Its promotion lowers a plan's price, so the card carries the badge.
        assert.equal(onlyPro.promo?.badge, 'only-pro-1');
        // There is no base price to lower.
        assert.equal(onlyPro.promo.discountedMonthlyNet, null);
    });

    test('an override that takes a rhythm away says so with null, never with 0', async () => {
        const noYear = await addOn('NO_YEAR_ON_BASIC');
        assert.deepEqual(forPlan(noYear, 'BASIC'), {
            planKey: 'BASIC',
            monthlyNet: 5,
            yearlyNet: null,
            discountedMonthlyNet: null,
            discountedYearlyNet: null,
        });
    });

    test('a plan not sold in a rhythm has no add-on price in it', async () => {
        const storage = await addOn('STORAGE');
        assert.equal(forPlan(storage, 'MONTHLY_ONLY').monthlyNet, 10);
        assert.equal(forPlan(storage, 'MONTHLY_ONLY').yearlyNet, null);
    });

    test('a restricted add-on names only the marketed plans it may be booked with', async () => {
        const restricted = await addOn('RESTRICTED');
        assert.deepEqual(
            restricted.planPrices.map((p) => p.planKey),
            ['PRO'],
        );
        assert.deepEqual(restricted.compatiblePlanKeys, ['PRO', 'LEGACY']);
    });
});
