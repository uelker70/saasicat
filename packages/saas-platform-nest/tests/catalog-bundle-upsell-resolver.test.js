import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CatalogBundleUpsellResolver } from '../dist/billing/index.js';
import { FakeBundleRepository } from '../dist/testing/index.js';

// CatalogBundleUpsellResolver (#36) — Default-Implementierung des
// UpsellOfferResolver-Ports gegen published+marketed Catalog-Bundles.
// Ranking: Deckung (Feature + ungedeckte requires, #35) vor Preis.

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
    test('liefert published+marketed Bundles, die das fehlende Feature enthalten', async () => {
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

    test('nicht-marketed und Draft-Bundles sind keine Angebote', async () => {
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

    test('ohne requires-Daten gewinnt der günstigere Preis', async () => {
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

    test('requires bekannt (#35): Kombi-Bundle mit Abhängigkeit rankt vor günstigerem Einzel-Bundle', async () => {
        // TOURNAMENT_MANAGEMENT requires RESOURCE_MANAGEMENT. SPORTPLATZ deckt
        // beides (14.90), TURNIERE nur das Feature (7.90) — SPORTPLATZ ist
        // trotz höherem Preis das bessere Angebot.
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

    test('Bundle, das nur die Abhängigkeit (nicht das Feature) enthält, ist kein Angebot', async () => {
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

    test('Währung kommt aus dem optionalen Currency-Token, Default EUR', async () => {
        await createLiveBundle({
            bundleKey: 'TURNIERE',
            features: ['TOURNAMENT_MANAGEMENT'],
            monthlyNet: '7.90',
        });
        const resolver = new CatalogBundleUpsellResolver(bundleRepo, PROJECT, null, 'CHF');
        const offers = await resolver.resolveOffers(['TOURNAMENT_MANAGEMENT'], 't1');
        assert.equal(offers[0].currency, 'CHF');
    });

    test('preisloses Bundle (nur Pricing-Override) liefert priceMonthlyNet null und rankt hinten', async () => {
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

    test('leere featureKeys → keine Offers, kein Repo-Zugriff', async () => {
        const resolver = new CatalogBundleUpsellResolver(bundleRepo, PROJECT);
        assert.deepEqual(await resolver.resolveOffers([], 't1'), []);
    });
});
