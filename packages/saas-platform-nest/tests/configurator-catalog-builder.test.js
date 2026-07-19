import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ConfiguratorCatalogBuilder } from '../dist/billing/index.js';

// ConfiguratorCatalogBuilder — baut den Onboarding-Catalog aus live
// PlanVersions + App-Plan-Marketing. Seit #49 ohne Addon-Quellen:
// verkauft werden nur PlanVersionen (+ Bundles über den Public-Catalog).

const SOURCES = {
    listLivePlans: async () => [
        {
            planId: 'STARTER',
            version: 3,
            monthlyNet: 19,
            yearlyNet: 190,
            features: ['CORE_IDENTITY'],
            quotas: { members: 250, storageGb: -1 },
            marketed: true,
        },
        {
            planId: 'INTERNAL',
            version: 1,
            monthlyNet: 0,
            yearlyNet: 0,
            features: [],
            quotas: { members: 1 },
            marketed: false,
        },
    ],
};

const MARKETING = {
    getCycleDiscount: () => 10,
    getCurrency: () => 'EUR',
    getVatRate: () => 19,
    listPlanMarketing: () => [
        {
            planId: 'STARTER',
            code: 'S',
            name: 'Starter',
            glyph: 'S',
            tagline: 'Klein',
            tags: [],
            popular: true,
        },
    ],
};

describe('ConfiguratorCatalogBuilder', () => {
    test('mappt marketed live PlanVersions auf Modelle (inkl. Quota-Normalisierung)', async () => {
        const catalog = await new ConfiguratorCatalogBuilder().build({
            sources: SOURCES,
            marketing: MARKETING,
        });

        assert.equal(catalog.cycleDiscount, 10);
        assert.equal(catalog.currency, 'EUR');
        assert.equal(catalog.vatRate, 19);
        assert.equal(catalog.models.length, 1, 'nicht-marketed Pläne fallen raus');

        const starter = catalog.models[0];
        assert.equal(starter.planId, 'STARTER');
        assert.equal(starter.popular, true);
        assert.deepEqual(starter.includedFeatureKeys, ['CORE_IDENTITY']);
        assert.equal(starter.quotaBase.members, 250);
        assert.equal(starter.quotaBase.storageGb, Number.MAX_SAFE_INTEGER, '-1 → MAX_SAFE_INTEGER');
    });

    test('Plan ohne Marketing-Eintrag wird versteckt', async () => {
        const catalog = await new ConfiguratorCatalogBuilder().build({
            sources: SOURCES,
            marketing: { ...MARKETING, listPlanMarketing: () => [] },
        });
        assert.equal(catalog.models.length, 0);
    });
});
