import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PublicMarketingCatalogService } from '../dist/catalog/index.js';
import { FakePlanRepository } from '../dist/testing/index.js';

// PublicMarketingCatalogService — Plan-Pfad: priceTag der MarketingProjection
// landet im PublicMarketingPlan-Payload (#47). Abwärtskompatibel: ohne
// gepflegtes priceTag bleibt das Feld null und Frontends formatieren aus
// monthlyNet/yearlyNet.

const PROJECT = 'autohauspro';
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
    await planRepo.create({ projectKey: PROJECT, planKey, label: planKey });
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
    test('priceTag der Plan-MarketingProjection landet im Payload', async () => {
        await seedLivePlan({ planKey: 'ENTERPRISE', planVersionId: 'pv-ent-1' });
        marketingRepo.set({
            targetType: 'PLAN',
            targetVersionId: 'pv-ent-1',
            locale: 'de',
            displayLabel: 'Enterprise',
            description: 'Für große Häuser.',
            priceTag: 'auf Anfrage',
        });

        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19, ASOF);
        assert.equal(cat.plans.length, 1);
        assert.equal(cat.plans[0].priceTag, 'auf Anfrage');
    });

    test('priceTag ist null, wenn die Projection keins pflegt (abwärtskompatibel)', async () => {
        await seedLivePlan({ planKey: 'STANDARD', planVersionId: 'pv-std-1' });
        marketingRepo.set({
            targetType: 'PLAN',
            targetVersionId: 'pv-std-1',
            locale: 'de',
            displayLabel: 'Standard',
            description: '',
        });

        const cat = await service.getCatalog(PROJECT, 'de', 'EUR', 19, ASOF);
        assert.equal(cat.plans[0].priceTag, null);
    });
});
