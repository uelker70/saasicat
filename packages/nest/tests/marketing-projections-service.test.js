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

const OTHER_VERSION = '22222222-2222-2222-2222-222222222222';

// @requirement SC-MKT-009 — At most one plan is marked as the recommended one
describe('MarketingProjectionsService — the recommended one', () => {
    const plan = (targetVersionId, extra = {}) => ({
        targetType: 'PLAN',
        targetVersionId,
        displayLabel: 'Plan',
        description: 'A plan',
        ...extra,
    });

    test('the first highlight is accepted', async () => {
        const row = await service.create(plan(TARGET_VERSION, { highlight: true }));
        assert.equal(row.highlight, true);
    });

    test('a second one is refused, and the refusal names the one holding it', async () => {
        const first = await service.create(plan(TARGET_VERSION, { highlight: true }));
        await assert.rejects(
            () => service.create(plan(OTHER_VERSION, { highlight: true })),
            (err) => {
                assert.equal(err.status, 409);
                assert.equal(err.response?.code, 'MARKETING_HIGHLIGHT_TAKEN');
                assert.equal(err.response?.params?.holderId, first.id);
                assert.equal(err.response?.params?.targetType, 'PLAN');
                assert.equal(err.response?.params?.locale, 'de');
                return true;
            },
        );
    });

    test('highlighting a second one by edit is refused the same way', async () => {
        await service.create(plan(TARGET_VERSION, { highlight: true }));
        const second = await service.create(plan(OTHER_VERSION));
        await assert.rejects(
            () => service.update(second.id, { highlight: true }),
            (err) => {
                assert.equal(err.response?.code, 'MARKETING_HIGHLIGHT_TAKEN');
                return true;
            },
        );
    });

    test('the one that already holds it may be edited without losing it', async () => {
        const first = await service.create(plan(TARGET_VERSION, { highlight: true }));
        const updated = await service.update(first.id, { highlight: true, badge: 'Popular' });
        assert.equal(updated.highlight, true);
        assert.equal(updated.badge, 'Popular');
    });

    test('clearing the first one frees it for the second', async () => {
        const first = await service.create(plan(TARGET_VERSION, { highlight: true }));
        const second = await service.create(plan(OTHER_VERSION));
        await service.update(first.id, { highlight: false });
        const updated = await service.update(second.id, { highlight: true });
        assert.equal(updated.highlight, true);
    });

    test('an add-on may be recommended while a plan already is', async () => {
        await service.create(plan(TARGET_VERSION, { highlight: true }));
        const bundle = await service.create({
            targetType: 'BUNDLE',
            targetVersionId: OTHER_VERSION,
            displayLabel: 'Bundle',
            description: 'An add-on',
            highlight: true,
        });
        assert.equal(bundle.highlight, true);
    });

    test('another language may recommend a different plan', async () => {
        await service.create(plan(TARGET_VERSION, { highlight: true }));
        const english = await service.create(
            plan(OTHER_VERSION, { highlight: true, locale: 'en' }),
        );
        assert.equal(english.highlight, true);
    });

    test('creating without a highlight is never refused', async () => {
        await service.create(plan(TARGET_VERSION, { highlight: true }));
        const second = await service.create(plan(OTHER_VERSION));
        assert.equal(second.highlight, false);
    });
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
