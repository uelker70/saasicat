import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PublicMarketingCatalogService } from '../dist/catalog/index.js';
import { FakeBundleRepository, FakePlanRepository } from '../dist/testing/index.js';

// PublicMarketingCatalogService — bundles path (P11.7.3 + P11.7.4).
// The service returns one `PublicMarketingBundle` entry per live
// BundleVersion with `compatiblePlanKeys`. The filter (which bundles a
// tenant can buy) runs client-side in the tenant self-service UI; the
// backend returns them all.

const PROJECT = 'clubapp';

const NOOP_PROMOTION_REPO = {
    list: async () => [],
};

class FakePromotionRepo {
    constructor(rows = []) {
        this.rows = rows;
    }
    async list() {
        return this.rows;
    }
}

class FakeMarketingProjectionRepo {
    constructor() {
        this.rows = [];
    }
    async findByTarget(targetType, targetVersionId, locale) {
        return (
            this.rows.find(
                (r) =>
                    r.targetType === targetType &&
                    r.targetVersionId === targetVersionId &&
                    r.locale === locale,
            ) ?? null
        );
    }
    set({
        targetType,
        targetVersionId,
        locale,
        displayLabel,
        description,
        visible = true,
        priceTag = null,
    }) {
        this.rows.push({
            targetType,
            targetVersionId,
            locale,
            displayLabel,
            description,
            visible,
            priceTag,
        });
    }
}

let bundleRepo;
let planRepo;
let marketingRepo;
let service;

beforeEach(() => {
    bundleRepo = new FakeBundleRepository();
    planRepo = new FakePlanRepository();
    marketingRepo = new FakeMarketingProjectionRepo();
    service = new PublicMarketingCatalogService(
        planRepo,
        marketingRepo,
        NOOP_PROMOTION_REPO,
        null, // catalogEntryRepo
        bundleRepo,
    );
});

async function createLiveBundle({
    bundleKey,
    features = ['F'],
    monthlyNet = '9.90',
    marketed = true,
    compatibility = {},
} = {}) {
    const bundle = await bundleRepo.create({
        projectKey: PROJECT,
        bundleKey,
        label: bundleKey,
    });
    const draft = await bundleRepo.createDraft({
        bundleId: bundle.id,
        features,
        monthlyNet,
        compatibility,
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

describe('PublicMarketingCatalogService — Bundles', () => {
    test('getCatalog returns empty bundles[] without a BundleRepository', async () => {
        const svc = new PublicMarketingCatalogService(
            planRepo,
            marketingRepo,
            NOOP_PROMOTION_REPO,
            null,
            null, // no BundleRepository
        );
        const cat = await svc.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.deepEqual(cat.bundles, []);
    });

    test('getCatalog returns published live bundles with compatiblePlanKeys', async () => {
        await createLiveBundle({
            bundleKey: 'COMMUNICATION_PRO',
            features: ['CAMPAIGNS', 'WHATSAPP'],
            monthlyNet: '15.00',
            compatibility: { planIds: ['PRO'] },
        });
        await createLiveBundle({
            bundleKey: 'FINANCE_PLUS',
            features: ['RECEIVABLES'],
            monthlyNet: '12.00',
            compatibility: { planIds: ['STANDARD', 'PRO'] },
        });

        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.equal(cat.bundles.length, 2);
        const comm = cat.bundles.find((b) => b.bundleKey === 'COMMUNICATION_PRO');
        assert.ok(comm);
        assert.equal(comm.monthlyNet, 15);
        assert.deepEqual(comm.features, ['CAMPAIGNS', 'WHATSAPP']);
        assert.deepEqual(comm.compatiblePlanKeys, ['PRO']);

        const fin = cat.bundles.find((b) => b.bundleKey === 'FINANCE_PLUS');
        assert.deepEqual(fin.compatiblePlanKeys, ['STANDARD', 'PRO']);
    });

    test('requiresFeatures (#35): uncovered requires of the bundle features from the FeatureCatalogEntries', async () => {
        await createLiveBundle({ bundleKey: 'TURNIERE', features: ['TOURNAMENT_MANAGEMENT'] });
        await createLiveBundle({
            bundleKey: 'SPORTPLATZ',
            features: ['TOURNAMENT_MANAGEMENT', 'RESOURCE_MANAGEMENT'],
        });
        const catalogEntryRepo = {
            listFeatures: async () => [
                {
                    featureKey: 'TOURNAMENT_MANAGEMENT',
                    requires: ['RESOURCE_MANAGEMENT'],
                    label: 'Turniere',
                    sortOrder: 0,
                    i18n: {},
                },
            ],
            listQuotas: async () => [],
        };
        const svc = new PublicMarketingCatalogService(
            planRepo,
            marketingRepo,
            NOOP_PROMOTION_REPO,
            catalogEntryRepo,
            bundleRepo,
        );

        const cat = await svc.getCatalog(PROJECT, 'de', 'EUR', 19);
        const turniere = cat.bundles.find((b) => b.bundleKey === 'TURNIERE');
        assert.deepEqual(turniere.requiresFeatures, ['RESOURCE_MANAGEMENT']);
        const sportplatz = cat.bundles.find((b) => b.bundleKey === 'SPORTPLATZ');
        assert.deepEqual(sportplatz.requiresFeatures, [], 'combo bundle is self-contained');
    });

    test('requiresFeatures without a CatalogEntryRepository: empty (graceful)', async () => {
        await createLiveBundle({ bundleKey: 'TURNIERE', features: ['TOURNAMENT_MANAGEMENT'] });
        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.deepEqual(cat.bundles[0].requiresFeatures, []);
    });

    test('getCatalog filters out non-marketed bundles', async () => {
        await createLiveBundle({ bundleKey: 'INTERN_ONLY', marketed: false });
        await createLiveBundle({ bundleKey: 'PUBLIC', marketed: true });

        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.equal(cat.bundles.length, 1);
        assert.equal(cat.bundles[0].bundleKey, 'PUBLIC');
    });

    test('getCatalog filters out bundles with MarketingProjection visible=false', async () => {
        const hidden = await createLiveBundle({ bundleKey: 'HIDDEN_BUNDLE' });
        await createLiveBundle({ bundleKey: 'PUBLIC_BUNDLE' });
        marketingRepo.set({
            targetType: 'BUNDLE',
            targetVersionId: hidden.id,
            locale: 'de',
            displayLabel: 'Hidden',
            description: 'Nicht sichtbar',
            visible: false,
        });

        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.deepEqual(
            cat.bundles.map((b) => b.bundleKey),
            ['PUBLIC_BUNDLE'],
        );
    });

    test('getCatalog ignores drafts (only live = published+not-superseded)', async () => {
        const bundle = await bundleRepo.create({
            projectKey: PROJECT,
            bundleKey: 'DRAFT_ONLY',
            label: 'D',
        });
        await bundleRepo.createDraft({ bundleId: bundle.id, features: ['X'] });

        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.deepEqual(cat.bundles, []);
    });

    test('i18n: MarketingProjection overrides label + fills description (matching locale)', async () => {
        const bv = await createLiveBundle({ bundleKey: 'COMMUNICATION_PRO' });
        marketingRepo.set({
            targetType: 'BUNDLE',
            targetVersionId: bv.id,
            locale: 'en',
            displayLabel: 'Communication Pro',
            description: 'Campaigns, WhatsApp, correspondence for active communities.',
        });
        marketingRepo.set({
            targetType: 'BUNDLE',
            targetVersionId: bv.id,
            locale: 'de',
            displayLabel: 'Communication Pro DE',
            description: 'Kampagnen, WhatsApp und Korrespondenz für aktive Vereine.',
        });

        const en = await service.getCatalog(PROJECT, 'en', 'EUR', 19);
        assert.equal(en.bundles[0].label, 'Communication Pro');
        assert.equal(
            en.bundles[0].description,
            'Campaigns, WhatsApp, correspondence for active communities.',
        );

        const de = await service.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.equal(de.bundles[0].label, 'Communication Pro DE');
    });

    test('i18n: falls back to DE projection when locale is missing', async () => {
        const bv = await createLiveBundle({ bundleKey: 'FINANCE_PLUS', monthlyNet: '12.00' });
        marketingRepo.set({
            targetType: 'BUNDLE',
            targetVersionId: bv.id,
            locale: 'de',
            displayLabel: 'Finance Plus DE',
            description: 'Erweiterte Finanzfunktionen.',
        });
        // No `tr` projection — should fall back to DE.
        const tr = await service.getCatalog(PROJECT, 'tr', 'EUR', 19);
        assert.equal(tr.bundles[0].label, 'Finance Plus DE');
        assert.equal(tr.bundles[0].description, 'Erweiterte Finanzfunktionen.');
    });

    test('i18n: without a projection the bundle root label applies (description stays empty)', async () => {
        await createLiveBundle({ bundleKey: 'EVENTS_PRO' });
        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.equal(cat.bundles[0].label, 'EVENTS_PRO');
        assert.equal(cat.bundles[0].description, '');
    });

    test('bundle promotions are resolved with targetType=BUNDLE', async () => {
        await createLiveBundle({ bundleKey: 'FINANCE_PLUS', monthlyNet: '12.00' });
        const promoRepo = new FakePromotionRepo([
            {
                id: 'promo-bundle',
                projectKey: PROJECT,
                internalLabel: 'Bundle Promo',
                type: 'percent',
                value: 50,
                appliesTo: ['FINANCE_PLUS'],
                targetType: 'BUNDLE',
                billingCycle: 'both',
                validFrom: '2026-01-01',
                validTo: '2026-12-31',
                priority: 10,
                onlyLocales: null,
                requiresCoupon: false,
                codes: [],
                color: '#118866',
                i18n: { de: { badge: 'Bundle Deal', fineprint: 'Nur kurze Zeit' } },
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
            },
        ]);
        const svc = new PublicMarketingCatalogService(
            planRepo,
            marketingRepo,
            promoRepo,
            null,
            bundleRepo,
        );

        const cat = await svc.getCatalog(PROJECT, 'de', 'EUR', 19, new Date('2026-06-01'));
        assert.equal(cat.bundles[0].promo.badge, 'Bundle Deal');
        assert.equal(cat.bundles[0].promo.discountedMonthlyNet, 6);
    });
});

// PlanVersion path: validFrom NULL tolerance (legacy data without a start date, published
// before the §4.2 publish requirement). Such live versions must not drop out of the
// public catalog. `validFrom IS NULL` = "valid since forever", but sorts
// behind dated versions (fallback, not an override).
const ASOF = new Date('2026-06-03T12:00:00Z');

function seedPlanVersion(
    repo,
    {
        id,
        planKey,
        version = 1,
        validFrom,
        validUntil = null,
        publishedAt = '2026-05-29T08:00:00Z',
    },
) {
    repo.seedVersion({
        id,
        planId: planKey,
        version,
        features: ['F'],
        quotas: {},
        monthlyNet: '49.90',
        yearlyNet: '499.00',
        marketed: true,
        publishedAt,
        supersededAt: null,
        validFrom,
        validUntil,
        endsAt: null,
        changeNote: '',
        nonRegressive: true,
    });
}

describe('PublicMarketingCatalogService — Plans (validFrom tolerance)', () => {
    test('live plan version with validFrom=NULL appears in the catalog', async () => {
        planRepo.seed({
            id: 'plan-pro',
            projectKey: PROJECT,
            planKey: 'PROFESSIONAL',
            label: 'Professional',
            deletedAt: null,
        });
        seedPlanVersion(planRepo, { id: 'pv-pro', planKey: 'PROFESSIONAL', validFrom: null });
        marketingRepo.set({
            targetType: 'PLAN',
            targetVersionId: 'pv-pro',
            locale: 'de',
            displayLabel: 'Professional',
            description: 'Aktive Händler',
            visible: true,
        });

        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19, ASOF);
        assert.deepEqual(
            cat.plans.map((p) => p.planKey),
            ['PROFESSIONAL'],
        );
        assert.equal(cat.plans[0].planVersionId, 'pv-pro');
    });

    test('findActivePlanVersion returns the NULL-validFrom version when it is the only live one', async () => {
        seedPlanVersion(planRepo, { id: 'pv-only', planKey: 'BASIC', validFrom: null });
        const active = await planRepo.findActivePlanVersion('BASIC', ASOF);
        assert.equal(active?.id, 'pv-only');
    });

    test('dated version wins over NULL-validFrom (fallback, not an override)', async () => {
        seedPlanVersion(planRepo, {
            id: 'pv-null',
            planKey: 'STANDARD',
            version: 1,
            validFrom: null,
        });
        seedPlanVersion(planRepo, {
            id: 'pv-dated',
            planKey: 'STANDARD',
            version: 2,
            validFrom: '2026-05-29T00:00:00Z',
        });
        const active = await planRepo.findActivePlanVersion('STANDARD', ASOF);
        assert.equal(active?.id, 'pv-dated');
    });
});

// validUntil day semantics: a version is still active on its own last day
// (validUntil = today) — otherwise a "dead day" would gape open at the succession
// cutoff (predecessor validUntil=today already dark, successor only from tomorrow).
// ASOF = 2026-06-03T12:00:00Z.
describe('PublicMarketingCatalogService — Plans (validUntil day-inclusive)', () => {
    test('single-day version (validFrom=validUntil=today) is active today', async () => {
        seedPlanVersion(planRepo, {
            id: 'pv-today',
            planKey: 'BASIC',
            validFrom: '2026-06-03T00:00:00Z',
            validUntil: '2026-06-03T00:00:00Z',
        });
        const active = await planRepo.findActivePlanVersion('BASIC', ASOF);
        assert.equal(active?.id, 'pv-today');
    });

    test('validUntil = yesterday → dark today', async () => {
        seedPlanVersion(planRepo, {
            id: 'pv-yesterday',
            planKey: 'BASIC',
            validFrom: '2026-06-01T00:00:00Z',
            validUntil: '2026-06-02T00:00:00Z',
        });
        const active = await planRepo.findActivePlanVersion('BASIC', ASOF);
        assert.equal(active, null);
    });

    test('succession without a dead day: v1 (…–today) active today, v2 (tomorrow–) not yet', async () => {
        planRepo.seed({
            id: 'plan-basic',
            projectKey: PROJECT,
            planKey: 'BASIC',
            label: 'Basic',
            deletedAt: null,
        });
        seedPlanVersion(planRepo, {
            id: 'pv1',
            planKey: 'BASIC',
            version: 1,
            validFrom: '2026-06-03T00:00:00Z',
            validUntil: '2026-06-03T00:00:00Z',
        });
        seedPlanVersion(planRepo, {
            id: 'pv2',
            planKey: 'BASIC',
            version: 2,
            validFrom: '2026-06-04T00:00:00Z',
        });
        marketingRepo.set({
            targetType: 'PLAN',
            targetVersionId: 'pv1',
            locale: 'de',
            displayLabel: 'Basic',
            description: '',
            visible: true,
        });

        const active = await planRepo.findActivePlanVersion('BASIC', ASOF);
        assert.equal(active?.id, 'pv1');

        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19, ASOF);
        assert.deepEqual(
            cat.plans.map((p) => p.planVersionId),
            ['pv1'],
        );
    });
});

// Staircase sorting of the comparison matrix: frontends render the rows in
// payload order — so the staircase (widest coverage on top, then leading
// columns, then label) has to be produced here in the service.
describe('PublicMarketingCatalogService — comparison matrix (staircase sorting)', () => {
    test('feature rows: widest coverage first, on a tie the leading plan column', async () => {
        planRepo.seed({
            id: 'plan-basis',
            projectKey: PROJECT,
            planKey: 'BASIS',
            label: 'Basis',
            deletedAt: null,
        });
        planRepo.seed({
            id: 'plan-pro',
            projectKey: PROJECT,
            planKey: 'PRO',
            label: 'Pro',
            deletedAt: null,
        });
        planRepo.seedVersion({
            id: 'pv-basis',
            planId: 'BASIS',
            version: 1,
            features: ['CORE', 'NUR_BASIS'],
            quotas: {},
            monthlyNet: '9.90',
            yearlyNet: '99.00',
            marketed: true,
            publishedAt: '2026-05-29T08:00:00Z',
            validFrom: '2026-05-01T00:00:00Z',
            validUntil: null,
        });
        planRepo.seedVersion({
            id: 'pv-pro',
            planId: 'PRO',
            version: 1,
            features: ['CORE', 'NUR_PRO'],
            quotas: {},
            monthlyNet: '19.90',
            yearlyNet: '199.00',
            marketed: true,
            publishedAt: '2026-05-29T08:00:00Z',
            validFrom: '2026-05-01T00:00:00Z',
            validUntil: null,
        });
        for (const [versionId, label] of [
            ['pv-basis', 'Basis'],
            ['pv-pro', 'Pro'],
        ]) {
            marketingRepo.set({
                targetType: 'PLAN',
                targetVersionId: versionId,
                locale: 'de',
                displayLabel: label,
                description: label,
                visible: true,
            });
        }

        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19, ASOF);
        assert.equal(cat.plans.length, 2);

        // Derive the expected staircase from the actual column order
        // (plan sorting is not the subject of this test).
        const firstOnly = cat.plans[0].planKey === 'BASIS' ? 'NUR_BASIS' : 'NUR_PRO';
        const secondOnly = firstOnly === 'NUR_BASIS' ? 'NUR_PRO' : 'NUR_BASIS';
        assert.deepEqual(
            cat.comparison.features.map((r) => r.key),
            ['CORE', firstOnly, secondOnly],
        );
    });
});

describe('PublicMarketingCatalogService — priceTag (#47) + featureLabels (#48)', () => {
    test('priceTag of the bundle MarketingProjection lands in the payload', async () => {
        const bv = await createLiveBundle({ bundleKey: 'FINANCE_PLUS', monthlyNet: '12.00' });
        marketingRepo.set({
            targetType: 'BUNDLE',
            targetVersionId: bv.id,
            locale: 'de',
            displayLabel: 'Finance Plus',
            description: 'Erweiterte Finanzfunktionen.',
            priceTag: 'ab 12 € / Monat',
        });

        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.equal(cat.bundles[0].priceTag, 'ab 12 € / Monat');
    });

    test('priceTag is null without a MarketingProjection (backward compatible)', async () => {
        await createLiveBundle({ bundleKey: 'FINANCE_PLUS' });
        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.equal(cat.bundles[0].priceTag, null);
    });

    test('featureLabels (#48): labels for bundle features ∪ requiresFeatures from the FeatureCatalogEntries (incl. i18n)', async () => {
        await createLiveBundle({ bundleKey: 'TURNIERE', features: ['TOURNAMENT_MANAGEMENT'] });
        const catalogEntryRepo = {
            listFeatures: async () => [
                {
                    featureKey: 'TOURNAMENT_MANAGEMENT',
                    requires: ['RESOURCE_MANAGEMENT'],
                    label: 'Turniere',
                    sortOrder: 0,
                    i18n: { en: { label: 'Tournaments' } },
                },
                {
                    featureKey: 'RESOURCE_MANAGEMENT',
                    requires: [],
                    label: 'Ressourcen-Modul',
                    sortOrder: 0,
                    i18n: { en: { label: 'Resource management' } },
                },
            ],
            listQuotas: async () => [],
        };
        const svc = new PublicMarketingCatalogService(
            planRepo,
            marketingRepo,
            NOOP_PROMOTION_REPO,
            catalogEntryRepo,
            bundleRepo,
        );

        const de = await svc.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.deepEqual(de.bundles[0].featureLabels, {
            TOURNAMENT_MANAGEMENT: 'Turniere',
            RESOURCE_MANAGEMENT: 'Ressourcen-Modul',
        });

        const en = await svc.getCatalog(PROJECT, 'en', 'EUR', 19);
        assert.deepEqual(en.bundles[0].featureLabels, {
            TOURNAMENT_MANAGEMENT: 'Tournaments',
            RESOURCE_MANAGEMENT: 'Resource management',
        });
    });

    test('featureLabels: non-curated keys are missing, empty without a CatalogEntryRepository (graceful)', async () => {
        await createLiveBundle({ bundleKey: 'TURNIERE', features: ['TOURNAMENT_MANAGEMENT'] });
        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19);
        assert.deepEqual(cat.bundles[0].featureLabels, {});
    });
});

