// @requirement SC-BUN-019 — What an add-on costs depends on the plan beside it and the rhythm it is billed in
// @requirement SC-MKT-011 — The public catalogue shows base prices only

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionBundlesService } from '../dist/billing/index.js';
import { FakeBundleRepository, FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// What a bundle costs is not a property of the bundle.
//
// It depends on the plan — a `BundlePricingOverride` may set a different figure
// for one plan, or supply the only figure there is — and on the rhythm, since a
// bundle carries two. The public catalogue can answer neither: it has no tenant
// and therefore no plan, so it serves the base prices and a bundle priced only
// through an override reads there as having no price at all.
//
// Until 2026-08-27 the booked list answered with `bv.monthlyNet` whatever the
// booking was, so a bundle at 9.90 monthly and 99.00 yearly reported 9.90 after
// a yearly booking.

const STARTER = 'STARTER';
const PRO = 'PRO';
const SUB = 'sub-a';

let bundleRepo;
let subBundleRepo;
let service;

beforeEach(() => {
    bundleRepo = new FakeBundleRepository();
    subBundleRepo = new FakeSubscriptionBundleRepository();
    service = new SubscriptionBundlesService(subBundleRepo, bundleRepo);
});

async function publishBundle({ key, monthlyNet = '9.90', yearlyNet = '99.00', pricingOverrides }) {
    const bundle = await bundleRepo.create({ bundleKey: key, label: key });
    const draft = await bundleRepo.createDraft({
        bundleId: bundle.id,
        features: ['F'],
        monthlyNet,
        yearlyNet,
        ...(pricingOverrides ? { pricingOverrides } : {}),
    });
    return bundleRepo.publishDraft(draft.id, {
        publishedByUserId: null,
        publishedChanges: [],
        nonRegressive: true,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validUntil: null,
    });
}

describe('the price a booking is billed at', () => {
    test('follows the rhythm the booking was made in', async () => {
        const bv = await publishBundle({ key: 'B1' });
        await subBundleRepo.add({
            subscriptionId: SUB,
            bundleVersionId: bv.id,
            billingCycle: 'YEARLY',
            startedAt: new Date('2026-01-01T00:00:00Z'),
        });
        const [booked] = await service.listForSubscription(SUB, STARTER, 'YEARLY');
        assert.equal(booked.priceNet, 99, 'a yearly booking is billed the yearly price');
    });

    test('a monthly booking beside a yearly plan is billed monthly', async () => {
        const bv = await publishBundle({ key: 'B2' });
        await subBundleRepo.add({
            subscriptionId: SUB,
            bundleVersionId: bv.id,
            billingCycle: 'MONTHLY',
            startedAt: new Date('2026-01-01T00:00:00Z'),
        });
        const [booked] = await service.listForSubscription(SUB, STARTER, 'YEARLY');
        assert.equal(booked.priceNet, 9.9);
    });

    test('a booking from before the rhythm was recorded takes the plan’s', async () => {
        // Absent is not monthly: such a booking took the plan's rhythm, because
        // that was the only rhythm it could take.
        const bv = await publishBundle({ key: 'B3' });
        await subBundleRepo.add({
            subscriptionId: SUB,
            bundleVersionId: bv.id,
            billingCycle: null,
            startedAt: new Date('2026-01-01T00:00:00Z'),
        });
        const [booked] = await service.listForSubscription(SUB, STARTER, 'YEARLY');
        assert.equal(booked.priceNet, 99);
    });

    test('a plan-specific override is what the tenant on that plan is billed', async () => {
        const bv = await publishBundle({
            key: 'B4',
            pricingOverrides: [{ planId: PRO, monthlyNet: '4.90', yearlyNet: '49.00' }],
        });
        await subBundleRepo.add({
            subscriptionId: SUB,
            bundleVersionId: bv.id,
            billingCycle: 'YEARLY',
            startedAt: new Date('2026-01-01T00:00:00Z'),
        });
        assert.equal((await service.listForSubscription(SUB, PRO, 'YEARLY'))[0].priceNet, 49);
        // And a tenant on another plan keeps the base price.
        assert.equal((await service.listForSubscription(SUB, STARTER, 'YEARLY'))[0].priceNet, 99);
    });

    test('a booking whose version has vanished reports no price rather than a wrong one', async () => {
        await subBundleRepo.add({
            subscriptionId: SUB,
            bundleVersionId: 'gone',
            billingCycle: 'MONTHLY',
            startedAt: new Date('2026-01-01T00:00:00Z'),
        });
        const [booked] = await service.listForSubscription(SUB, STARTER, 'MONTHLY');
        assert.equal(booked.priceNet, null);
        assert.equal(booked.label, null);
    });
});

describe('the prices a store is shown', () => {
    test('are resolved for the plan, in both rhythms', async () => {
        const bv = await publishBundle({ key: 'S1' });
        const prices = await service.resolvePricesFor(STARTER, [bv.id]);
        assert.deepEqual(prices[bv.id], { monthlyNet: 9.9, yearlyNet: 99 });
    });

    test('carry an override the public catalogue cannot know about', async () => {
        // The case that made the card wrong: base prices absent, the only price
        // there is comes from the override. The catalogue reads that as "no
        // price", the store hid the bundle, and the booking would have worked.
        const bv = await publishBundle({
            key: 'S2',
            monthlyNet: null,
            yearlyNet: null,
            pricingOverrides: [{ planId: PRO, monthlyNet: '3.00', yearlyNet: '30.00' }],
        });
        assert.deepEqual(await service.resolvePricesFor(PRO, [bv.id]).then((p) => p[bv.id]), {
            monthlyNet: 3,
            yearlyNet: 30,
        });
        // A tenant on another plan genuinely has no price — and the booking
        // refuses it, so the store is right to say so.
        assert.deepEqual(await service.resolvePricesFor(STARTER, [bv.id]).then((p) => p[bv.id]), {
            monthlyNet: null,
            yearlyNet: null,
        });
    });

    test('a bundle sold in one rhythm only says so for the other', async () => {
        const bv = await publishBundle({ key: 'S3', yearlyNet: null });
        assert.deepEqual((await service.resolvePricesFor(STARTER, [bv.id]))[bv.id], {
            monthlyNet: 9.9,
            yearlyNet: null,
        });
    });

    test('an id nobody knows is left out rather than answered with nulls', async () => {
        // Absent and "priced at nothing" are different answers, and a caller
        // that cannot tell them apart shows a price of zero.
        assert.deepEqual(await service.resolvePricesFor(STARTER, ['gone']), {});
    });

    test('asking for nothing costs nothing', async () => {
        assert.deepEqual(await service.resolvePricesFor(STARTER, []), {});
    });
});

describe('which bundles a tenant may ask the price of', () => {
    test('a draft is not priced, because it was never on offer', async () => {
        // The caller names ids. An authenticated tenant can name one that never
        // appeared in their catalogue, and answering would disclose the
        // plan-specific pricing of something nobody has published.
        const bundle = await bundleRepo.create({
            bundleKey: 'DRAFT_ONLY',
            label: 'Draft only',
        });
        const draft = await bundleRepo.createDraft({
            bundleId: bundle.id,
            features: ['F'],
            monthlyNet: '9.90',
            yearlyNet: '99.00',
            pricingOverrides: [{ planId: STARTER, monthlyNet: '1.00' }],
        });
        assert.deepEqual(await service.resolvePricesFor(STARTER, [draft.id]), {});
    });

    test('a superseded version is not priced either', async () => {
        const first = await publishBundle({ key: 'SUP' });
        const secondDraft = await bundleRepo.createDraft({
            bundleId: first.bundleId,
            features: ['F'],
            monthlyNet: '19.90',
            yearlyNet: '199.00',
        });
        const second = await bundleRepo.publishDraft(secondDraft.id, {
            publishedByUserId: null,
            publishedChanges: [],
            nonRegressive: true,
            validFrom: new Date('2026-06-01T00:00:00Z'),
            validUntil: null,
        });
        // The live one answers; the one it replaced does not.
        assert.deepEqual((await service.resolvePricesFor(STARTER, [second.id]))[second.id], {
            monthlyNet: 19.9,
            yearlyNet: 199,
        });
        assert.deepEqual(await service.resolvePricesFor(STARTER, [first.id]), {});
    });

    test('a live version among dead ones still answers', async () => {
        // Without this, an implementation that answers nothing at all passes
        // both tests above.
        const live = await publishBundle({ key: 'MIXED' });
        const prices = await service.resolvePricesFor(STARTER, [live.id, 'gone']);
        assert.deepEqual(Object.keys(prices), [live.id]);
    });
});

describe('a bundle the operator retired', () => {
    test('is not priced, though its version is still live', async () => {
        // Retiring soft-deletes the stem and leaves the published version
        // exactly as it was, so a check that reads only the version says yes to
        // something the catalogue has stopped serving.
        const live = await publishBundle({ key: 'RETIRED' });
        assert.ok(
            (await service.resolvePricesFor(STARTER, [live.id]))[live.id],
            'priced while it is on sale',
        );
        await bundleRepo.softDelete(live.bundleId);
        assert.deepEqual(await service.resolvePricesFor(STARTER, [live.id]), {});
    });
});
