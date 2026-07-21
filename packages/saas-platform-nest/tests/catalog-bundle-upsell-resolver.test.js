import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CatalogBundleUpsellResolver } from '../dist/billing/index.js';
import { FakeBundleRepository } from '../dist/testing/index.js';

// CatalogBundleUpsellResolver (#36) — default implementation of the
// UpsellOfferResolver port against published+marketed catalog bundles.
// Ranking: coverage (feature + uncovered requires, #35) before price.

const PROJECT = 'clubapp';

let bundleRepo;

beforeEach(() => {
    bundleRepo = new FakeBundleRepository();
});

async function createLiveBundle({ bundleKey, features, monthlyNet, marketed = true }) {
    const bundle = await bundleRepo.create({ projectKey: PROJECT, bundleKey, label: bundleKey });
    const draft = await bundleRepo.createDraft({
        bundleId: bundle.id,
        features,
        monthlyNet,
        compatibility: {},
        marketed,
    });
    return bundleRepo.publishDraft(draft.id, {
        publishedByUserId: null,
        publishedChanges: [],
        nonRegressive: true,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validUntil: null,
    });
}

function catalogEntryRepoWith(requiresByFeature) {
    return {
        async listFeatures() {
            return Object.entries(requiresByFeature).map(([featureKey, requires]) => ({
                featureKey,
                requires,
            }));
        },
    };
}

describe('CatalogBundleUpsellResolver', () => {
    test('returns published+marketed bundles that contain the missing feature', async () => {
        const live = await createLiveBundle({
            bundleKey: 'TURNIERE',
            features: ['TOURNAMENT_MANAGEMENT'],
            monthlyNet: '7.90',
        });
        await createLiveBundle({
            bundleKey: 'FINANZEN',
            features: ['RECEIVABLES'],
            monthlyNet: '12.00',
        });

        const resolver = new CatalogBundleUpsellResolver(bundleRepo, PROJECT);
        const offers = await resolver.resolveOffers(['TOURNAMENT_MANAGEMENT'], 't1');

        assert.deepEqual(offers, [
            {
                bundleKey: 'TURNIERE',
                bundleVersionId: live.id,
                priceMonthlyNet: 7.9,
                currency: 'EUR',
                label: 'TURNIERE',
            },
        ]);
    });

    test('non-marketed and draft bundles are not offers', async () => {
        await createLiveBundle({
            bundleKey: 'INTERN',
            features: ['TOURNAMENT_MANAGEMENT'],
            monthlyNet: '1.00',
            marketed: false,
        });
        const stem = await bundleRepo.create({
            projectKey: PROJECT,
            bundleKey: 'DRAFT_ONLY',
            label: 'Draft',
        });
        await bundleRepo.createDraft({
            bundleId: stem.id,
            features: ['TOURNAMENT_MANAGEMENT'],
            monthlyNet: '2.00',
            compatibility: {},
            marketed: true,
        });

        const resolver = new CatalogBundleUpsellResolver(bundleRepo, PROJECT);
        assert.deepEqual(await resolver.resolveOffers(['TOURNAMENT_MANAGEMENT'], 't1'), []);
    });

    test('without requires data the cheaper price wins', async () => {
        await createLiveBundle({
            bundleKey: 'TEUER',
            features: ['TOURNAMENT_MANAGEMENT'],
            monthlyNet: '14.90',
        });
        await createLiveBundle({
            bundleKey: 'GUENSTIG',
            features: ['TOURNAMENT_MANAGEMENT'],
            monthlyNet: '7.90',
        });

        const resolver = new CatalogBundleUpsellResolver(bundleRepo, PROJECT);
        const offers = await resolver.resolveOffers(['TOURNAMENT_MANAGEMENT'], 't1');
        assert.deepEqual(
            offers.map((o) => o.bundleKey),
            ['GUENSTIG', 'TEUER'],
        );
    });

    test('requires known (#35): combo bundle with dependency ranks before cheaper single bundle', async () => {
        // TOURNAMENT_MANAGEMENT requires RESOURCE_MANAGEMENT. SPORTPLATZ covers
        // both (14.90), TURNIERE only the feature (7.90) — SPORTPLATZ is the
        // better offer despite the higher price.
        await createLiveBundle({
            bundleKey: 'TURNIERE',
            features: ['TOURNAMENT_MANAGEMENT'],
            monthlyNet: '7.90',
        });
        await createLiveBundle({
            bundleKey: 'SPORTPLATZ',
            features: ['TOURNAMENT_MANAGEMENT', 'RESOURCE_MANAGEMENT', 'TRAINING_PLANNER'],
            monthlyNet: '14.90',
        });

        const resolver = new CatalogBundleUpsellResolver(
            bundleRepo,
            PROJECT,
            catalogEntryRepoWith({ TOURNAMENT_MANAGEMENT: ['RESOURCE_MANAGEMENT'] }),
        );
        const offers = await resolver.resolveOffers(['TOURNAMENT_MANAGEMENT'], 't1');
        assert.deepEqual(
            offers.map((o) => o.bundleKey),
            ['SPORTPLATZ', 'TURNIERE'],
        );
    });

    test('bundle that contains only the dependency (not the feature) is not an offer', async () => {
        await createLiveBundle({
            bundleKey: 'NUR_RESSOURCEN',
            features: ['RESOURCE_MANAGEMENT'],
            monthlyNet: '5.00',
        });

        const resolver = new CatalogBundleUpsellResolver(
            bundleRepo,
            PROJECT,
            catalogEntryRepoWith({ TOURNAMENT_MANAGEMENT: ['RESOURCE_MANAGEMENT'] }),
        );
        assert.deepEqual(await resolver.resolveOffers(['TOURNAMENT_MANAGEMENT'], 't1'), []);
    });

    test('currency comes from the optional currency token, default EUR', async () => {
        await createLiveBundle({
            bundleKey: 'TURNIERE',
            features: ['TOURNAMENT_MANAGEMENT'],
            monthlyNet: '7.90',
        });
        const resolver = new CatalogBundleUpsellResolver(bundleRepo, PROJECT, null, 'CHF');
        const offers = await resolver.resolveOffers(['TOURNAMENT_MANAGEMENT'], 't1');
        assert.equal(offers[0].currency, 'CHF');
    });

    test('priceless bundle (pricing override only) yields priceMonthlyNet null and ranks last', async () => {
        await createLiveBundle({
            bundleKey: 'OVERRIDE_ONLY',
            features: ['TOURNAMENT_MANAGEMENT'],
            monthlyNet: null,
        });
        await createLiveBundle({
            bundleKey: 'TURNIERE',
            features: ['TOURNAMENT_MANAGEMENT'],
            monthlyNet: '7.90',
        });

        const resolver = new CatalogBundleUpsellResolver(bundleRepo, PROJECT);
        const offers = await resolver.resolveOffers(['TOURNAMENT_MANAGEMENT'], 't1');
        assert.deepEqual(
            offers.map((o) => [o.bundleKey, o.priceMonthlyNet]),
            [
                ['TURNIERE', 7.9],
                ['OVERRIDE_ONLY', null],
            ],
        );
    });

    test('empty featureKeys → no offers, no repo access', async () => {
        const resolver = new CatalogBundleUpsellResolver(bundleRepo, PROJECT);
        assert.deepEqual(await resolver.resolveOffers([], 't1'), []);
    });
});
