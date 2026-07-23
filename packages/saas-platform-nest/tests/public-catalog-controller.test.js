// Smoke tests for PublicCatalogController. Direct instantiation instead of
// a full NestJS bootstrap — the controller is a pure mapping layer over
// PlanCatalog + FeatureUiRegistry, no side effects, no request lifecycle
// needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PublicCatalogController } from '../dist/billing/index.js';
import { FakeBundleRepository } from '../dist/testing/index.js';

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'demo',
    currency: 'EUR',
    vatRate: 19,
    features: [
        { key: 'CORE_IDENTITY', label: 'Mitglieder', tier: 'CORE' },
        { key: 'WHATSAPP', label: 'WhatsApp', tier: 'ADVANCED' },
        { key: 'BUNDLE_FEATURE_A', label: 'A', tier: 'PRO' },
        { key: 'BUNDLE_FEATURE_B', label: 'B', tier: 'PRO' },
        { key: 'PLANNED', label: 'Spaeter', plannedOnly: true },
    ],
    plans: [
        {
            id: 'STARTER',
            name: 'Starter',
            tagline: 'Klein',
            marketed: true,
            monthlyNet: 19,
            yearlyNet: 190,
            quotas: { users: 3, members: 250, storageGb: 2 },
            features: ['CORE_IDENTITY'],
        },
        {
            id: 'STANDARD',
            name: 'Standard',
            tagline: 'Mittel',
            marketed: true,
            popular: true,
            monthlyNet: 49,
            yearlyNet: 490,
            quotas: { users: 8, members: 1000, storageGb: 10 },
            features: ['CORE_IDENTITY', 'WHATSAPP'],
        },
        {
            id: 'ENTERPRISE',
            name: 'Enterprise',
            tagline: 'Sondervertrag',
            marketed: false,
            monthlyNet: null,
            yearlyNet: null,
            quotas: { users: -1, members: -1, storageGb: 500 },
            features: ['CORE_IDENTITY', 'WHATSAPP'],
        },
    ],
};

const REGISTRY = {
    CORE_IDENTITY: { label: 'Mitglieder', description: 'Stammdaten', icon: 'groups' },
    WHATSAPP: { label: 'WhatsApp', description: 'Messenger', icon: 'chat' },
    BUNDLE_FEATURE_A: { label: 'A', description: 'Bundle-A', icon: 'star' },
    BUNDLE_FEATURE_B: { label: 'B', description: 'Bundle-B', icon: 'star' },
    PLANNED: { label: 'Spaeter', description: 'Geplant', icon: 'schedule' },
};

test('listPlans returns only marketed plans in the generic format', async () => {
    const ctrl = new PublicCatalogController(CATALOG, REGISTRY);
    const plans = await ctrl.listPlans();

    assert.equal(plans.length, 2, 'ENTERPRISE must not be in the self-service list');
    const starter = plans.find((p) => p.id === 'STARTER');
    assert.deepEqual(starter.quotas, { users: 3, members: 250, storageGb: 2 });
    assert.equal(starter.popular, false);
    const standard = plans.find((p) => p.id === 'STANDARD');
    assert.equal(standard.popular, true);
    assert.equal(standard.monthlyNet, 49);
    assert.deepEqual(standard.features, ['CORE_IDENTITY', 'WHATSAPP']);
});

test('listFeatureRegistry returns the injected registry 1:1 without a CatalogEntry repo', async () => {
    const ctrl = new PublicCatalogController(CATALOG, REGISTRY);
    const reg = await ctrl.listFeatureRegistry();
    assert.equal(reg, REGISTRY);
});

test('listFeatureRegistry overlays the DB icon over the static registry icon (#13)', async () => {
    const fakeRepo = {
        async listFeatures() {
            return [
                // edited icon wins
                {
                    featureKey: 'MEMBERS',
                    icon: 'mdi-account-group',
                    label: 'MEMBERS',
                    description: null,
                    plannedOnly: false,
                },
                // icon=null → registry icon stays
                {
                    featureKey: 'SEPA',
                    icon: null,
                    label: 'SEPA',
                    description: null,
                    plannedOnly: false,
                },
                // discovered-only key (not in the static registry)
                {
                    featureKey: 'EXTRA',
                    icon: 'mdi-star',
                    label: 'Extra',
                    description: 'x',
                    plannedOnly: false,
                },
            ];
        },
    };
    const baseReg = {
        MEMBERS: { label: 'Mitglieder', description: 'd', icon: 'groups' },
        SEPA: { label: 'SEPA', description: 'd', icon: 'account_balance' },
    };
    // Constructor args: catalog, registry, projectKey, marketingRepo, bundleRepo, catalogEntryRepo
    const ctrl = new PublicCatalogController(CATALOG, baseReg, 'clubapp', null, null, fakeRepo);
    const reg = await ctrl.listFeatureRegistry();
    assert.equal(reg.MEMBERS.icon, 'mdi-account-group'); // DB icon wins
    assert.equal(reg.MEMBERS.label, 'Mitglieder'); // label stays from registry
    assert.equal(reg.SEPA.icon, 'account_balance'); // icon=null → registry icon
    assert.equal(reg.EXTRA.icon, 'mdi-star'); // discovered-only key added
});

// requiresFeatures (#35): listBundles returns per bundle the uncovered
// dependencies (union of the requires of the contained features minus the
// bundle's own features) from the FeatureCatalogEntries.
async function createLiveBundle(bundleRepo, { bundleKey, features }) {
    const bundle = await bundleRepo.create({
        projectKey: 'clubapp',
        bundleKey,
        label: bundleKey,
    });
    const draft = await bundleRepo.createDraft({
        bundleId: bundle.id,
        features,
        monthlyNet: '9.90',
        compatibility: {},
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

test('listBundles returns requiresFeatures from the FeatureCatalogEntries (#35)', async () => {
    const bundleRepo = new FakeBundleRepository();
    // TURNIERE needs RESOURCE_MANAGEMENT from outside; SPORTPLATZ covers the
    // dependency itself (combo bundle) → no uncovered requires.
    await createLiveBundle(bundleRepo, {
        bundleKey: 'TURNIERE',
        features: ['TOURNAMENT_MANAGEMENT'],
    });
    await createLiveBundle(bundleRepo, {
        bundleKey: 'SPORTPLATZ',
        features: ['TOURNAMENT_MANAGEMENT', 'RESOURCE_MANAGEMENT'],
    });
    const catalogEntryRepo = {
        async listFeatures() {
            return [
                { featureKey: 'TOURNAMENT_MANAGEMENT', requires: ['RESOURCE_MANAGEMENT'] },
                { featureKey: 'RESOURCE_MANAGEMENT', requires: [] },
            ];
        },
    };
    const ctrl = new PublicCatalogController(
        CATALOG,
        REGISTRY,
        'clubapp',
        null,
        bundleRepo,
        catalogEntryRepo,
    );

    const bundles = await ctrl.listBundles();
    const turniere = bundles.find((b) => b.bundleKey === 'TURNIERE');
    assert.deepEqual(turniere.requiresFeatures, ['RESOURCE_MANAGEMENT']);
    const sportplatz = bundles.find((b) => b.bundleKey === 'SPORTPLATZ');
    assert.deepEqual(sportplatz.requiresFeatures, [], 'combo bundle is self-contained');
});

test('listBundles without a CatalogEntry repo: requiresFeatures stays empty (graceful)', async () => {
    const bundleRepo = new FakeBundleRepository();
    await createLiveBundle(bundleRepo, {
        bundleKey: 'TURNIERE',
        features: ['TOURNAMENT_MANAGEMENT'],
    });
    const ctrl = new PublicCatalogController(CATALOG, REGISTRY, 'clubapp', null, bundleRepo);

    const bundles = await ctrl.listBundles();
    assert.deepEqual(bundles[0].requiresFeatures, []);
});
