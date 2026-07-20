import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { BundlesService, BusinessTypesService } from '../dist/catalog/index.js';
import { FakeBundleRepository, FakeBusinessTypeRepository } from '../dist/testing/index.js';

// BusinessTypesService — CRUD + Komposition aus published BundleVersions +
// Strict-Check (Disjointness, Compatibility, Bundle-Existence) + Diff.

const PROJECT = 'clubapp';

function buildSnapshot(features = [], quotas = []) {
    return {
        schemaVersion: 1,
        scannedAt: '2026-05-14T00:00:00.000Z',
        app: { key: PROJECT, version: '0.1.0' },
        capabilities: [],
        features: features.map((f) => ({ featureKey: f, capabilityKeys: [] })),
        bundles: [],
        quotas: quotas.map((q) => ({
            quotaKey: q,
            label: q,
            unit: '',
            policy: 'continuous',
            feature: null,
            declaredAt: '',
            enforcedBy: [],
        })),
        hash: 'sha256-test',
    };
}

let bundleRepo;
let btRepo;
let bundlesService;
let btService;

beforeEach(() => {
    bundleRepo = new FakeBundleRepository();
    btRepo = new FakeBusinessTypeRepository();
    bundlesService = new BundlesService(bundleRepo, null, { strictModeCheckMode: 'warn-only' });
    btService = new BusinessTypesService(btRepo, bundleRepo, null, { strictModeCheckMode: 'warn-only' });
});

async function createPublishedBundle(bundleKey, features, opts = {}) {
    const bundle = await bundlesService.createBundle({
        projectKey: PROJECT,
        bundleKey,
        label: bundleKey,
    });
    const draft = await bundlesService.createBundleDraft({
        bundleId: bundle.id,
        features,
        quotas: opts.quotas ?? {},
        compatibility: opts.compatibility ?? {},
        monthlyNet: opts.monthlyNet ?? '9.90',
    });
    const published = await bundlesService.publishBundleVersion(draft.bundleVersion.id, {
        publishedByUserId: null,
        validFrom: opts.validFrom ?? '2026-01-01',
    });
    return published.bundleVersion;
}

// ─────────────────────────────────────────────────────────────────
// Stamm-Operationen
// ─────────────────────────────────────────────────────────────────

describe('BusinessTypesService — Stamm-Operationen', () => {
    test('createBusinessType + Doppelt-Anlage wirft 422', async () => {
        await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'SPORT_VEREIN',
            label: 'Sport-Verein',
        });
        await assert.rejects(
            () =>
                btService.createBusinessType({
                    projectKey: PROJECT,
                    businessTypeKey: 'SPORT_VEREIN',
                    label: 'X',
                }),
            /existiert bereits/,
        );
    });

    test('softDelete ist idempotent', async () => {
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'X',
            label: 'X',
        });
        await btService.softDeleteBusinessType(bt.id);
        await btService.softDeleteBusinessType(bt.id);
    });

    test('list filtert soft-deleted', async () => {
        const a = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'A',
            label: 'A',
        });
        await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'B',
            label: 'B',
        });
        await btService.softDeleteBusinessType(a.id);
        const list = await btService.listBusinessTypes(PROJECT);
        assert.equal(list.length, 1);
        assert.equal(list[0].businessTypeKey, 'B');
    });
});

// ─────────────────────────────────────────────────────────────────
// Version-Lifecycle + Bundle-Komposition
// ─────────────────────────────────────────────────────────────────

describe('BusinessTypesService — Version-Lifecycle', () => {
    test('createDraft mit einem published Bundle: v1, baseVersionId=null, keine Warnings', async () => {
        const bundle = await createPublishedBundle('CONTRIBUTIONS_BUNDLE', ['CONTRIBUTIONS']);
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'SPORT_VEREIN',
            label: 'Sport-Verein',
        });
        const result = await btService.createBusinessTypeDraft({
            businessTypeId: bt.id,
            bundles: [{ bundleVersionId: bundle.id, sortOrder: 0 }],
        });
        assert.equal(result.businessTypeVersion.version, 1);
        assert.equal(result.businessTypeVersion.baseVersionId, null);
        assert.equal(result.businessTypeVersion.bundles.length, 1);
        assert.deepEqual(result.warnings, []);
    });

    test('createDraft ohne Bundles wirft 422', async () => {
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'X',
            label: 'X',
        });
        await assert.rejects(
            () => btService.createBusinessTypeDraft({ businessTypeId: bt.id, bundles: [] }),
            /mindestens einen Bundle/,
        );
    });

    test('createDraft mit nicht-published Bundle wirft 422', async () => {
        const bundle = await bundlesService.createBundle({
            projectKey: PROJECT,
            bundleKey: 'X',
            label: 'X',
        });
        const draft = await bundlesService.createBundleDraft({
            bundleId: bundle.id,
            features: ['F'],
        });
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'BT',
            label: 'BT',
        });
        await assert.rejects(
            () =>
                btService.createBusinessTypeDraft({
                    businessTypeId: bt.id,
                    bundles: [{ bundleVersionId: draft.bundleVersion.id }],
                }),
            /Draft .* BusinessType/,
        );
    });

    test('publish klassifiziert Diff (Bundle hinzugefügt = IMPROVEMENT)', async () => {
        const b1 = await createPublishedBundle('B1', ['F1']);
        const b2 = await createPublishedBundle('B2', ['F2']);
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'BT',
            label: 'BT',
        });
        const v1 = await btService.createBusinessTypeDraft({
            businessTypeId: bt.id,
            bundles: [{ bundleVersionId: b1.id }],
        });
        await btService.publishBusinessTypeVersion(v1.businessTypeVersion.id, {
            publishedByUserId: null,
        });

        const v2 = await btService.createBusinessTypeDraft({
            businessTypeId: bt.id,
            bundles: [{ bundleVersionId: b1.id }, { bundleVersionId: b2.id }],
        });
        const published = await btService.publishBusinessTypeVersion(v2.businessTypeVersion.id, {
            publishedByUserId: null,
        });
        assert.equal(published.businessTypeVersion.nonRegressive, true);
        assert.ok(
            published.businessTypeVersion.publishedChanges?.some(
                (c) => c.field === 'bundles.added' && c.direction === 'IMPROVEMENT',
            ),
        );
    });

    test('publish blockt regressive (Bundle entfernt) ohne forceRegressive', async () => {
        const b1 = await createPublishedBundle('B1', ['F1']);
        const b2 = await createPublishedBundle('B2', ['F2']);
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'BT',
            label: 'BT',
        });
        const v1 = await btService.createBusinessTypeDraft({
            businessTypeId: bt.id,
            bundles: [{ bundleVersionId: b1.id }, { bundleVersionId: b2.id }],
        });
        await btService.publishBusinessTypeVersion(v1.businessTypeVersion.id, {
            publishedByUserId: null,
        });

        const v2 = await btService.createBusinessTypeDraft({
            businessTypeId: bt.id,
            bundles: [{ bundleVersionId: b1.id }], // b2 entfernt
        });
        await assert.rejects(
            () =>
                btService.publishBusinessTypeVersion(v2.businessTypeVersion.id, {
                    publishedByUserId: null,
                }),
            /BUSINESS_TYPE_VERSION_REGRESSION|regressiv/,
        );
    });
});

// ─────────────────────────────────────────────────────────────────
// Strict-Mode-Check: Disjointness + Compatibility + QuotaOverride
// ─────────────────────────────────────────────────────────────────

describe('BusinessTypesService — Strict-Mode-Check', () => {
    test('Disjointness: zwei Bundles mit gleichem Feature → BUNDLE_DISJOINTNESS-Warnung', async () => {
        const b1 = await createPublishedBundle('B1', ['SHARED', 'A']);
        const b2 = await createPublishedBundle('B2', ['SHARED', 'B']);
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'BT',
            label: 'BT',
        });
        const result = await btService.createBusinessTypeDraft({
            businessTypeId: bt.id,
            bundles: [{ bundleVersionId: b1.id }, { bundleVersionId: b2.id }],
        });
        const codes = result.warnings.map((w) => w.code);
        assert.ok(codes.includes('BUNDLE_DISJOINTNESS'));
    });

    test('Compatibility: Bundle-Whitelist ohne BusinessType-Key → BUNDLE_COMPATIBILITY-Warnung', async () => {
        const b1 = await createPublishedBundle('B1', ['F'], {
            compatibility: { businessTypeKeys: ['OTHER'] },
        });
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'BT',
            label: 'BT',
        });
        const result = await btService.createBusinessTypeDraft({
            businessTypeId: bt.id,
            bundles: [{ bundleVersionId: b1.id }],
        });
        const codes = result.warnings.map((w) => w.code);
        assert.ok(codes.includes('BUNDLE_COMPATIBILITY'));
    });

    test('warn-only ohne Snapshot: Disjointness wird trotzdem gefunden, QuotaOverrides übersprungen', async () => {
        const b1 = await createPublishedBundle('B1', ['SHARED']);
        const b2 = await createPublishedBundle('B2', ['SHARED']);
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'BT',
            label: 'BT',
        });
        const result = await btService.createBusinessTypeDraft({
            businessTypeId: bt.id,
            bundles: [{ bundleVersionId: b1.id }, { bundleVersionId: b2.id }],
            quotaOverrides: { unknownQuota: 100 },
        });
        // Disjointness wird gefunden, QuotaOverrides nicht (kein Snapshot)
        const codes = result.warnings.map((w) => w.code);
        assert.ok(codes.includes('BUNDLE_DISJOINTNESS'));
        assert.ok(!codes.includes('QUOTA_MISSING'));
    });

    test('mit Snapshot: QuotaOverride-Drift erkannt', async () => {
        const snapshot = buildSnapshot([], ['storageGb']);
        const svc = new BusinessTypesService(btRepo, bundleRepo, snapshot, { strictModeCheckMode: 'warn-only' });
        const b1 = await createPublishedBundle('B1', ['F']);
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'BT',
            label: 'BT',
        });
        const result = await svc.createBusinessTypeDraft({
            businessTypeId: bt.id,
            bundles: [{ bundleVersionId: b1.id }],
            quotaOverrides: { storageGb: 50, unknownQuota: 100 },
        });
        const codes = result.warnings.map((w) => w.code);
        assert.deepEqual(codes, ['QUOTA_MISSING']);
        assert.equal(result.warnings[0].value, 'unknownQuota');
    });

    test('blocking-Modus: BUNDLE_DISJOINTNESS wirft 422', async () => {
        const svc = new BusinessTypesService(btRepo, bundleRepo, null, {
            strictModeCheckMode: 'blocking',
        });
        const b1 = await createPublishedBundle('B1', ['SHARED']);
        const b2 = await createPublishedBundle('B2', ['SHARED']);
        const bt = await btService.createBusinessType({
            projectKey: PROJECT,
            businessTypeKey: 'BT',
            label: 'BT',
        });
        await assert.rejects(
            () =>
                svc.createBusinessTypeDraft({
                    businessTypeId: bt.id,
                    bundles: [{ bundleVersionId: b1.id }, { bundleVersionId: b2.id }],
                }),
            /STRICT_MODE_VIOLATIONS|Strict-Mode/,
        );
    });
});
