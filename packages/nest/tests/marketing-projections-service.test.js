import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { MarketingProjectionsService } from '../dist/catalog/index.js';
import { FakeMarketingProjectionRepository } from '../dist/testing/index.js';

const TARGET_VERSION = '11111111-1111-1111-1111-111111111111';

let repo;
let service;

beforeEach(() => {
    repo = new FakeMarketingProjectionRepository();
    service = new MarketingProjectionsService(repo);
});

// @requirement SC-MKT-004 — Marketing text belongs to one version and one language
// @requirement SC-MKT-006 — Marketing edits take effect at once and are not versioned
// @requirement SC-MKT-008 — An installation has exactly one set of marketing settings
describe('MarketingProjectionsService — master data operations', () => {
    test('create creates a MarketingProjection (default locale=de)', async () => {
        const row = await service.create({
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            displayLabel: 'Banking-Bundle',
            description: 'Vollständiges SEPA + Kontoabgleich',
        });
        assert.equal(row.locale, 'de');
        assert.equal(row.targetType, 'BUNDLE');
        assert.equal(row.priority, 0);
        assert.equal(row.highlight, false);
        assert.deepEqual(row.topFeatures, []);
    });

    test('create sets marketing defaults (visible, badge, trial)', async () => {
        const row = await service.create({
            targetType: 'PLAN',
            targetVersionId: TARGET_VERSION,
            displayLabel: 'Starter',
            description: 'Einstieg',
        });
        assert.equal(row.visible, true);
        assert.equal(row.badge, '');
        assert.equal(row.trialEnabled, false);
        assert.equal(row.trialDays, 30);
    });

    test('update changes top features, badge and trial', async () => {
        const created = await service.create({
            targetType: 'PLAN',
            targetVersionId: TARGET_VERSION,
            displayLabel: 'Starter',
            description: 'Einstieg',
        });
        const updated = await service.update(created.id, {
            badge: 'Beliebt',
            visible: false,
            trialEnabled: true,
            trialDays: 14,
            topFeatures: [{ label: 'Mitgliederverwaltung', strong: 'bis 25' }],
        });
        assert.equal(updated.badge, 'Beliebt');
        assert.equal(updated.visible, false);
        assert.equal(updated.trialEnabled, true);
        assert.equal(updated.trialDays, 14);
        assert.deepEqual(updated.topFeatures, [
            { label: 'Mitgliederverwaltung', strong: 'bis 25' },
        ]);
    });

    test('create throws 409 on duplicate creation (same Target+Locale)', async () => {
        await service.create({
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            displayLabel: 'X',
            description: 'X',
        });
        await assert.rejects(
            () =>
                service.create({
                    targetType: 'BUNDLE',
                    targetVersionId: TARGET_VERSION,
                    displayLabel: 'Y',
                    description: 'Y',
                }),
            /already exists/,
        );
    });

    test('create accepts multiple locales per target', async () => {
        await service.create({
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            locale: 'de',
            displayLabel: 'Banking-Bundle',
            description: 'X',
        });
        const en = await service.create({
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            locale: 'en',
            displayLabel: 'Banking Bundle',
            description: 'X',
        });
        assert.equal(en.locale, 'en');
        const list = await service.list({ targetVersionId: TARGET_VERSION });
        assert.equal(list.length, 2);
    });

    test('update changes required and marketing fields', async () => {
        const created = await service.create({
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            displayLabel: 'Alt',
            description: 'Alt',
        });
        const updated = await service.update(created.id, {
            displayLabel: 'Neu',
            highlight: true,
            priority: 100,
            priceTag: '€ 9,90 / Monat',
        });
        assert.equal(updated.displayLabel, 'Neu');
        assert.equal(updated.highlight, true);
        assert.equal(updated.priority, 100);
        assert.equal(updated.priceTag, '€ 9,90 / Monat');
    });

    test('delete removes the row', async () => {
        const created = await service.create({
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            displayLabel: 'X',
            description: 'X',
        });
        await service.delete(created.id);
        const after = await repo.findById(created.id);
        assert.equal(after, null);
    });

    test('list filters by targetType + locale', async () => {
        await service.create({
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            displayLabel: 'X',
            description: 'X',
        });
        await service.create({
            targetType: 'PLAN',
            targetVersionId: '22222222-2222-2222-2222-222222222222',
            displayLabel: 'Y',
            description: 'Y',
        });
        const bundles = await service.list({ targetType: 'BUNDLE' });
        assert.equal(bundles.length, 1);
    });

    test('getById throws 404 for missing ID', async () => {
        await assert.rejects(
            () => service.getById('99999999-9999-9999-9999-999999999999'),
            /not found/,
        );
    });
});
