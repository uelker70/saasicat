import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { BundlesService } from '../dist/catalog/index.js';
import {
    FakeBundleRepository,
    FakePlanRepository,
    FakeSubscriptionRepository,
} from '../dist/testing/index.js';

// BundlesService — CRUD + Versions-Lifecycle + Strict-Mode-Check + Diff-
// Klassifikation. Tests laufen direkt gegen die Service-Klasse mit dem
// FakeBundleRepository und einem optionalen Discovery-Snapshot-Stub.

const PROJECT = 'vereinsfux';

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

let repo;
let service;

beforeEach(() => {
    repo = new FakeBundleRepository();
});

// ─────────────────────────────────────────────────────────────────
// Stamm-Operationen
// ─────────────────────────────────────────────────────────────────

describe('BundlesService — Stamm-Operationen', () => {
    test('createBundle legt einen neuen Bundle-Stamm an', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const row = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'Banking-Bundle',
        });
        assert.equal(row.projectKey, PROJECT);
        assert.equal(row.bundleKey, 'BANKING');
        assert.equal(row.deletedAt, null);
        assert.equal(row.sortOrder, 0);
    });

    test('createBundle wirft 422 bei doppeltem (projectKey, bundleKey)', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        await service.createBundle({ projectKey: PROJECT, bundleKey: 'BANKING', label: 'X' });
        await assert.rejects(
            () => service.createBundle({ projectKey: PROJECT, bundleKey: 'BANKING', label: 'Y' }),
            /existiert bereits/,
        );
    });

    test('updateBundle ändert label, lässt projectKey/bundleKey unangetastet', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const created = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'Alt',
        });
        const updated = await service.updateBundle(created.id, { label: 'Neu' });
        assert.equal(updated.label, 'Neu');
        assert.equal(updated.projectKey, PROJECT);
        assert.equal(updated.bundleKey, 'BANKING');
    });

    test('softDeleteBundle ist idempotent', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const created = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        await service.softDeleteBundle(created.id);
        await service.softDeleteBundle(created.id); // kein Fehler
        const after = await repo.findById(created.id);
        assert.notEqual(after?.deletedAt, null);
    });

    test('listBundles filtert soft-deleted heraus', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const a = await service.createBundle({ projectKey: PROJECT, bundleKey: 'A', label: 'A' });
        await service.createBundle({ projectKey: PROJECT, bundleKey: 'B', label: 'B' });
        await service.softDeleteBundle(a.id);
        const list = await service.listBundles(PROJECT);
        assert.equal(list.length, 1);
        assert.equal(list[0].bundleKey, 'B');
    });
});

// ─────────────────────────────────────────────────────────────────
// Version-Lifecycle: createDraft / updateDraft / publish
// ─────────────────────────────────────────────────────────────────

describe('BundlesService — Version-Lifecycle', () => {
    test('createBundleDraft legt v1 an mit baseVersionId=null', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const result = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT', 'RECEIVABLES'],
            monthlyNet: '9.90',
        });
        assert.equal(result.bundleVersion.version, 1);
        assert.equal(result.bundleVersion.baseVersionId, null);
        assert.equal(result.bundleVersion.publishedAt, null);
        assert.deepEqual(result.warnings, []);
    });

    test('createBundleDraft wirft 422, wenn bereits Draft existiert', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        await service.createBundleDraft({ bundleId: bundle.id, features: ['SEPA_DIRECT_DEBIT'] });
        await assert.rejects(
            () =>
                service.createBundleDraft({
                    bundleId: bundle.id,
                    features: ['RECEIVABLES'],
                }),
            /Draft-Version/,
        );
    });

    test('updateBundleDraft wirft 422 bei published Version', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const draft = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT'],
        });
        await service.publishBundleVersion(draft.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        // Pack 2c: published-Versions sind nur dann editierbar, wenn sie
        // latest-in-chain sind, keine Subscription binden UND validFrom in
        // der Zukunft liegt. Solange die BundleVersion-Publish-Pipeline
        // kein validFrom kennt (siehe OPEN_ISSUES §11.x), bleibt jede
        // published Bundle-Version eingefroren — fail-closed.
        await assert.rejects(
            () =>
                service.updateBundleDraft(draft.bundleVersion.id, {
                    features: ['NEW'],
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_NOT_EDITABLE');
                return true;
            },
        );
    });

    test('publishBundleVersion klassifiziert Diff (Feature added = IMPROVEMENT)', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const v1 = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT'],
            monthlyNet: '9.90',
        });
        await service.publishBundleVersion(v1.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });

        const v2 = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT', 'RECEIVABLES'],
            monthlyNet: '9.90',
        });
        const published = await service.publishBundleVersion(v2.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        assert.equal(published.bundleVersion.nonRegressive, true);
        assert.ok(
            published.bundleVersion.publishedChanges?.some(
                (c) => c.field === 'features.added' && c.direction === 'IMPROVEMENT',
            ),
        );
        // v1 ist superseded
        const v1After = await repo.findVersionById(v1.bundleVersion.id);
        assert.notEqual(v1After.supersededAt, null);
    });

    test('publishBundleVersion blockt regressive Version ohne forceRegressive', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const v1 = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT', 'RECEIVABLES'],
            monthlyNet: '9.90',
        });
        await service.publishBundleVersion(v1.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });

        const v2 = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT'], // RECEIVABLES entfernt → REGRESSION
            monthlyNet: '9.90',
        });
        await assert.rejects(
            () =>
                service.publishBundleVersion(v2.bundleVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-06-01',
                }),
            /BUNDLE_VERSION_REGRESSION|regressiv/,
        );
    });

    test('publishBundleVersion lässt regressive Version mit forceRegressive durch', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const v1 = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT', 'RECEIVABLES'],
            monthlyNet: '9.90',
        });
        await service.publishBundleVersion(v1.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });

        const v2 = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT'],
            monthlyNet: '9.90',
        });
        const result = await service.publishBundleVersion(v2.bundleVersion.id, {
            publishedByUserId: null,
            forceRegressive: true,
            validFrom: '2026-06-01',
        });
        assert.equal(result.bundleVersion.nonRegressive, false);
    });
});

// ─────────────────────────────────────────────────────────────────
// Strict-Mode-Check (warn-only Default)
// ─────────────────────────────────────────────────────────────────

describe('BundlesService — Strict-Mode-Check', () => {
    test('warn-only: Drift-Features kommen als warnings zurück, persistiert wird trotzdem', async () => {
        const snapshot = buildSnapshot(['SEPA_DIRECT_DEBIT'], []); // RECEIVABLES fehlt
        service = new BundlesService(repo, snapshot, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const result = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT', 'RECEIVABLES'],
        });
        assert.equal(result.warnings.length, 1);
        assert.equal(result.warnings[0].code, 'BUNDLE_FEATURE_UNKNOWN');
        assert.equal(result.warnings[0].value, 'RECEIVABLES');
        // Trotzdem persistiert
        const stored = await repo.findVersionById(result.bundleVersion.id);
        assert.deepEqual(stored.features, ['SEPA_DIRECT_DEBIT', 'RECEIVABLES']);
    });

    test('blocking: Drift-Features werfen 422', async () => {
        const snapshot = buildSnapshot(['SEPA_DIRECT_DEBIT'], []);
        service = new BundlesService(repo, snapshot, { strictModeCheckMode: 'blocking' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        await assert.rejects(
            () =>
                service.createBundleDraft({
                    bundleId: bundle.id,
                    features: ['SEPA_DIRECT_DEBIT', 'RECEIVABLES'],
                }),
            /STRICT_MODE_VIOLATIONS|Strict-Mode/,
        );
    });

    test('ohne Snapshot: kein Strict-Check, leere Warnings', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' }); // kein Snapshot
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const result = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['ANY_UNKNOWN_FEATURE'],
        });
        assert.deepEqual(result.warnings, []);
    });

    test('compatibility.planIds-Drift blockiert auch im warn-only-Modus', async () => {
        // PlanRepository mit nur einem existierenden Plan "STARTER".
        const planRepo = new FakePlanRepository();
        await planRepo.create({ projectKey: PROJECT, planKey: 'STARTER', label: 'Starter' });
        const snapshot = buildSnapshot(['SEPA_DIRECT_DEBIT'], []);
        service = new BundlesService(repo, snapshot, { strictModeCheckMode: 'warn-only' }, null, planRepo);
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        await assert.rejects(
            () =>
                service.createBundleDraft({
                    bundleId: bundle.id,
                    features: ['SEPA_DIRECT_DEBIT'],
                    compatibility: { planIds: ['STARTER', 'NON_EXISTENT_PLAN'] },
                }),
            (err) => {
                assert.equal(err.response?.code, 'STRICT_MODE_VIOLATIONS');
                const driftWarnings = err.response?.warnings.filter(
                    (w) => w.code === 'BUNDLE_PLAN_KEY_UNKNOWN',
                );
                assert.equal(driftWarnings.length, 1);
                assert.equal(driftWarnings[0].value, 'NON_EXISTENT_PLAN');
                return true;
            },
        );
        assert.equal((await repo.listVersions(bundle.id)).length, 0);
    });

    test('compatibility.planIds ohne PlanRepository → kein BUNDLE_PLAN_KEY_UNKNOWN', async () => {
        // Kein planRepo injiziert → Check wird übersprungen (graceful).
        const snapshot = buildSnapshot(['SEPA_DIRECT_DEBIT'], []);
        service = new BundlesService(repo, snapshot, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const result = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT'],
            compatibility: { planIds: ['UNKNOWN_PLAN'] },
        });
        assert.deepEqual(
            result.warnings.filter((w) => w.code === 'BUNDLE_PLAN_KEY_UNKNOWN'),
            [],
        );
    });

    test('Quota-Drift wird als QUOTA_MISSING gemeldet', async () => {
        const snapshot = buildSnapshot(['SEPA_DIRECT_DEBIT'], ['storageGb']);
        service = new BundlesService(repo, snapshot, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const result = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['SEPA_DIRECT_DEBIT'],
            quotas: { storageGb: 50, unknownQuota: 100 },
        });
        const codes = result.warnings.map((w) => w.code);
        assert.deepEqual(codes, ['QUOTA_MISSING']);
        assert.equal(result.warnings[0].value, 'unknownQuota');
    });
});

describe('BundlesService — Editierbarkeits-Annotation (Pack 2c)', () => {
    const FUTURE = '2099-01-01';
    const FUTURE_NEXT = '2099-06-01';

    test('listBundleVersions setzt isLatestInChain auf der höchsten Version', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const v1 = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['A'],
        });
        await service.publishBundleVersion(v1.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const v2 = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['A', 'B'],
        });

        const list = await service.listBundleVersions(bundle.id);
        const v1Row = list.find((v) => v.id === v1.bundleVersion.id);
        const v2Row = list.find((v) => v.id === v2.bundleVersion.id);
        assert.equal(v1Row.isLatestInChain, false);
        assert.equal(v2Row.isLatestInChain, true);
    });

    test('publishBundleVersion: ohne validFrom → 422 BUNDLE_VERSION_VALID_FROM_REQUIRED', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const draft = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['A'],
        });
        await assert.rejects(
            () => service.publishBundleVersion(draft.bundleVersion.id, { publishedByUserId: null }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_VALID_FROM_REQUIRED');
                return true;
            },
        );
    });

    test('publishBundleVersion: zweite Version setzt vorherige auf supersededAt + Auto-Sukzession validUntil', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const v1 = await service.createBundleDraft({ bundleId: bundle.id, features: ['A'] });
        await service.publishBundleVersion(v1.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const v2 = await service.createBundleDraft({ bundleId: bundle.id, features: ['A', 'B'] });
        await service.publishBundleVersion(v2.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        const v1After = await repo.findVersionById(v1.bundleVersion.id);
        assert.notEqual(v1After.supersededAt, null, 'v1 muss superseded sein');
        // Auto-Sukzession: validUntil(v1) = validFrom(v2) - 1 Tag
        assert.equal(v1After.validUntil?.slice(0, 10), '2026-05-31');
    });

    test('publishBundleVersion: validFrom muss strikt nach Vorgänger liegen → 422', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const v1 = await service.createBundleDraft({ bundleId: bundle.id, features: ['A'] });
        await service.publishBundleVersion(v1.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        const v2 = await service.createBundleDraft({ bundleId: bundle.id, features: ['A', 'B'] });
        await assert.rejects(
            () =>
                service.publishBundleVersion(v2.bundleVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-06-01', // == Vorgänger, nicht strikt nach
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS');
                return true;
            },
        );
    });

    test('updateBundleDraft erlaubt published-but-future BundleVersion (latest, 0 Subs)', async () => {
        const subs = new FakeSubscriptionRepository();
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' }, subs);
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const draft = await service.createBundleDraft({ bundleId: bundle.id, features: ['A'] });
        const published = await service.publishBundleVersion(draft.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        // 0 Subs → editierbar trotz publishedAt != null
        const updated = await service.updateBundleDraft(published.bundleVersion.id, {
            monthlyNet: '12.00',
        });
        assert.equal(updated.bundleVersion.monthlyNet, '12.00');
        assert.notEqual(updated.bundleVersion.publishedAt, null, 'published-Status bleibt');
    });

    test('updateBundleDraft blockt published-but-future validFrom in der Vergangenheit', async () => {
        const subs = new FakeSubscriptionRepository();
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' }, subs);
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const draft = await service.createBundleDraft({ bundleId: bundle.id, features: ['A'] });
        const published = await service.publishBundleVersion(draft.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });

        await assert.rejects(
            () =>
                service.updateBundleDraft(published.bundleVersion.id, {
                    validFrom: '2026-01-01',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_VALID_FROM_NOT_FUTURE');
                return true;
            },
        );
    });

    test('updateBundleDraft blockt validFrom vor der Vorgänger-Version', async () => {
        const subs = new FakeSubscriptionRepository();
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' }, subs);
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const v1 = await service.createBundleDraft({ bundleId: bundle.id, features: ['A'] });
        await service.publishBundleVersion(v1.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2098-01-01',
        });
        const v2 = await service.createBundleDraft({ bundleId: bundle.id, features: ['A', 'B'] });
        const published = await service.publishBundleVersion(v2.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2099-01-01',
        });

        await assert.rejects(
            () =>
                service.updateBundleDraft(published.bundleVersion.id, {
                    validFrom: '2097-01-01',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS');
                return true;
            },
        );
    });

    test('updateBundleDraft blockt validUntil vor validFrom', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const draft = await service.createBundleDraft({
            bundleId: bundle.id,
            features: ['A'],
            validFrom: '2099-01-01',
        });

        await assert.rejects(
            () =>
                service.updateBundleDraft(draft.bundleVersion.id, {
                    validUntil: '2098-12-31',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM');
                return true;
            },
        );
    });

    test('updateBundleDraft blockt published-but-future BundleVersion mit Subscription', async () => {
        const subs = new FakeSubscriptionRepository();
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' }, subs);
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const draft = await service.createBundleDraft({ bundleId: bundle.id, features: ['A'] });
        const published = await service.publishBundleVersion(draft.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        subs.setBundleVersionCount(published.bundleVersion.id, 1);
        await assert.rejects(
            () =>
                service.updateBundleDraft(published.bundleVersion.id, {
                    monthlyNet: '14.00',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_NOT_EDITABLE');
                return true;
            },
        );
    });

    test('discardBundleDraft entfernt Draft + wirft bei published', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const draft = await service.createBundleDraft({ bundleId: bundle.id, features: ['A'] });
        await service.discardBundleDraft(draft.bundleVersion.id);
        const after = await service.listBundleVersions(bundle.id);
        assert.equal(after.length, 0);

        // Discard auf published → 422
        const draft2 = await service.createBundleDraft({ bundleId: bundle.id, features: ['A'] });
        await service.publishBundleVersion(draft2.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        await assert.rejects(
            () => service.discardBundleDraft(draft2.bundleVersion.id),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_ALREADY_PUBLISHED');
                return true;
            },
        );
    });

    test('updateBundleDraft blockt published Version, die nicht latest-in-chain ist', async () => {
        const subs = new FakeSubscriptionRepository();
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' }, subs);
        const bundle = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        const v1 = await service.createBundleDraft({ bundleId: bundle.id, features: ['A'] });
        const v1Published = await service.publishBundleVersion(v1.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        const v2 = await service.createBundleDraft({ bundleId: bundle.id, features: ['A', 'B'] });
        await service.publishBundleVersion(v2.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE_NEXT,
        });
        // v1 published-future-active, aber NICHT latest-in-chain → eingefroren
        await assert.rejects(
            () =>
                service.updateBundleDraft(v1Published.bundleVersion.id, {
                    monthlyNet: '20.00',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_NOT_EDITABLE');
                return true;
            },
        );
    });
});
