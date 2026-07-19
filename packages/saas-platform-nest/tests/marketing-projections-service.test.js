import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { MarketingProjectionsService } from '../dist/catalog/index.js';
import { FakeMarketingProjectionRepository } from '../dist/testing/index.js';

const PROJECT = 'vereinsfux';
const TARGET_VERSION = '11111111-1111-1111-1111-111111111111';

let repo;
let service;

beforeEach(() => {
    repo = new FakeMarketingProjectionRepository();
    service = new MarketingProjectionsService(repo);
});

describe('MarketingProjectionsService — Stamm-Operationen', () => {
    test('create legt eine MarketingProjection an (default locale=de)', async () => {
        const row = await service.create({
            projectKey: PROJECT,
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

    test('create setzt Marketing-Defaults (visible, badge, trial)', async () => {
        const row = await service.create({
            projectKey: PROJECT,
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

    test('update ändert Top-Features, Badge und Trial', async () => {
        const created = await service.create({
            projectKey: PROJECT,
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

    test('create wirft 409 bei Doppel-Anlage (gleicher Target+Locale)', async () => {
        await service.create({
            projectKey: PROJECT,
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            displayLabel: 'X',
            description: 'X',
        });
        await assert.rejects(
            () =>
                service.create({
                    projectKey: PROJECT,
                    targetType: 'BUNDLE',
                    targetVersionId: TARGET_VERSION,
                    displayLabel: 'Y',
                    description: 'Y',
                }),
            /existiert bereits/,
        );
    });

    test('create akzeptiert mehrere Locales pro Target', async () => {
        await service.create({
            projectKey: PROJECT,
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            locale: 'de',
            displayLabel: 'Banking-Bundle',
            description: 'X',
        });
        const en = await service.create({
            projectKey: PROJECT,
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            locale: 'en',
            displayLabel: 'Banking Bundle',
            description: 'X',
        });
        assert.equal(en.locale, 'en');
        const list = await service.list({ projectKey: PROJECT, targetVersionId: TARGET_VERSION });
        assert.equal(list.length, 2);
    });

    test('update ändert Pflicht- und Marketing-Felder', async () => {
        const created = await service.create({
            projectKey: PROJECT,
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

    test('delete entfernt die Row', async () => {
        const created = await service.create({
            projectKey: PROJECT,
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            displayLabel: 'X',
            description: 'X',
        });
        await service.delete(created.id);
        const after = await repo.findById(created.id);
        assert.equal(after, null);
    });

    test('list filtert nach targetType + locale', async () => {
        await service.create({
            projectKey: PROJECT,
            targetType: 'BUNDLE',
            targetVersionId: TARGET_VERSION,
            displayLabel: 'X',
            description: 'X',
        });
        await service.create({
            projectKey: PROJECT,
            targetType: 'PLAN',
            targetVersionId: '22222222-2222-2222-2222-222222222222',
            displayLabel: 'Y',
            description: 'Y',
        });
        const bundles = await service.list({ projectKey: PROJECT, targetType: 'BUNDLE' });
        assert.equal(bundles.length, 1);
    });

    test('getById wirft 404 bei fehlender ID', async () => {
        await assert.rejects(
            () => service.getById('99999999-9999-9999-9999-999999999999'),
            /nicht gefunden/,
        );
    });
});
