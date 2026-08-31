import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PublicMarketingCatalogService } from '../dist/catalog/index.js';
import { FakePlanRepository } from '../dist/testing/index.js';

// PublicMarketingCatalogService — plan path: the MarketingProjection's priceTag
// lands in the PublicMarketingPlan payload (#47). Backwards compatible: without a
// maintained priceTag the field stays null and frontends format from
// monthlyNet/yearlyNet.

const ASOF = new Date('2026-06-01T00:00:00Z');

const NOOP_PROMOTION_REPO = {
    list: async () => [],
};

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
    set(row) {
        this.rows.push({ visible: true, priceTag: null, ...row });
    }
}

let planRepo;
let marketingRepo;
let service;

beforeEach(() => {
    planRepo = new FakePlanRepository();
    marketingRepo = new FakeMarketingProjectionRepo();
    service = new PublicMarketingCatalogService(
        planRepo,
        marketingRepo,
        NOOP_PROMOTION_REPO,
        null, // catalogEntryRepo
        null, // bundleRepo
    );
});

async function seedLivePlan({ planKey, planVersionId }) {
    await planRepo.create({ planKey, label: planKey });
    planRepo.seedVersion({
        id: planVersionId,
        planId: planKey,
        version: 1,
        baseVersionId: null,
        publishedAt: '2026-01-01T00:00:00Z',
        supersededAt: null,
        publishedChanges: [],
        changeNote: 'init',
        nonRegressive: true,
        validFrom: '2026-01-01',
        validUntil: null,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        features: ['CORE'],
        quotas: { users: 5 },
        monthlyNet: '49.00',
        yearlyNet: '490.00',
        marketed: true,
    });
}

describe('PublicMarketingCatalogService — Plan priceTag (#47)', () => {
    test('the plan MarketingProjection priceTag lands in the payload', async () => {
        await seedLivePlan({ planKey: 'ENTERPRISE', planVersionId: 'pv-ent-1' });
        marketingRepo.set({
            targetType: 'PLAN',
            targetVersionId: 'pv-ent-1',
            locale: 'de',
            displayLabel: 'Enterprise',
            description: 'Für große Häuser.',
            priceTag: 'auf Anfrage',
        });

        const cat = await service.getCatalog('de', 'EUR', 19, ASOF);
        assert.equal(cat.plans.length, 1);
        assert.equal(cat.plans[0].priceTag, 'auf Anfrage');
    });

    test('priceTag is null when the projection maintains none (backwards compatible)', async () => {
        await seedLivePlan({ planKey: 'STANDARD', planVersionId: 'pv-std-1' });
        marketingRepo.set({
            targetType: 'PLAN',
            targetVersionId: 'pv-std-1',
            locale: 'de',
            displayLabel: 'Standard',
            description: '',
        });

        const cat = await service.getCatalog('de', 'EUR', 19, ASOF);
        assert.equal(cat.plans[0].priceTag, null);
    });
});

// @requirement SC-MKT-022 — A catalogue offers at most one recommended plan, and the language decides which
describe('PublicMarketingCatalogService — the recommended plan', () => {
    const projection = (targetVersionId, locale, extra = {}) => ({
        targetType: 'PLAN',
        targetVersionId,
        locale,
        displayLabel: 'A plan',
        description: '',
        highlight: false,
        priority: 0,
        ...extra,
    });

    const recommended = (catalog) => catalog.plans.filter((plan) => plan.highlight);

    test('one is one', async () => {
        await seedLivePlan({ planKey: 'A', planVersionId: 'pv-a' });
        await seedLivePlan({ planKey: 'B', planVersionId: 'pv-b' });
        marketingRepo.set(projection('pv-a', 'de', { highlight: true }));
        marketingRepo.set(projection('pv-b', 'de'));

        const cat = await service.getCatalog('de', 'EUR', 19, ASOF);
        assert.deepEqual(
            recommended(cat).map((p) => p.planKey),
            ['A'],
        );
    });

    test('a plan reaching the page through the fallback loses to one written for the language', async () => {
        // A is recommended in the default language and has no English row, so
        // it reaches the English catalogue through the fallback. B is
        // recommended in English. Each row is correct on its own.
        await seedLivePlan({ planKey: 'A', planVersionId: 'pv-a' });
        await seedLivePlan({ planKey: 'B', planVersionId: 'pv-b' });
        marketingRepo.set(projection('pv-a', 'de', { highlight: true }));
        marketingRepo.set(projection('pv-b', 'de'));
        marketingRepo.set(projection('pv-b', 'en', { highlight: true }));

        const english = await service.getCatalog('en', 'EUR', 19, ASOF);
        assert.deepEqual(
            recommended(english).map((p) => p.planKey),
            ['B'],
        );
        // And the default language is unaffected: there A is the only one.
        const german = await service.getCatalog('de', 'EUR', 19, ASOF);
        assert.deepEqual(
            recommended(german).map((p) => p.planKey),
            ['A'],
        );
    });

    test('two rows in the same language leave the one the catalogue offers first', async () => {
        await seedLivePlan({ planKey: 'A', planVersionId: 'pv-a' });
        await seedLivePlan({ planKey: 'B', planVersionId: 'pv-b' });
        marketingRepo.set(projection('pv-a', 'de', { highlight: true, priority: 1 }));
        marketingRepo.set(projection('pv-b', 'de', { highlight: true, priority: 9 }));

        const cat = await service.getCatalog('de', 'EUR', 19, ASOF);
        assert.deepEqual(
            recommended(cat).map((p) => p.planKey),
            ['B'],
        );
    });

    test('the one that loses the mark keeps its card', async () => {
        await seedLivePlan({ planKey: 'A', planVersionId: 'pv-a' });
        await seedLivePlan({ planKey: 'B', planVersionId: 'pv-b' });
        marketingRepo.set(projection('pv-a', 'de', { highlight: true }));
        marketingRepo.set(projection('pv-b', 'de', { highlight: true }));

        const cat = await service.getCatalog('de', 'EUR', 19, ASOF);
        assert.deepEqual(cat.plans.map((p) => p.planKey).sort(), ['A', 'B']);
    });

    test('a catalogue that recommends nothing recommends nothing', async () => {
        await seedLivePlan({ planKey: 'A', planVersionId: 'pv-a' });
        marketingRepo.set(projection('pv-a', 'de'));

        const cat = await service.getCatalog('de', 'EUR', 19, ASOF);
        assert.deepEqual(recommended(cat), []);
    });

    test('a single fallback row still recommends its plan', async () => {
        // Nothing to outrank it: the rule takes a mark away, it does not
        // require one to have been written in the language asked for.
        await seedLivePlan({ planKey: 'A', planVersionId: 'pv-a' });
        marketingRepo.set(projection('pv-a', 'de', { highlight: true }));

        const cat = await service.getCatalog('en', 'EUR', 19, ASOF);
        assert.deepEqual(
            recommended(cat).map((p) => p.planKey),
            ['A'],
        );
    });
});
