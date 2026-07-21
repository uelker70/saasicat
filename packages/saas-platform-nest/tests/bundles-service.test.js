import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { BundlesService } from '../dist/catalog/index.js';
import {
    FakeBundleRepository,
    FakePlanRepository,
    FakeSubscriptionRepository,
} from '../dist/testing/index.js';

// BundlesService — CRUD + version lifecycle + strict mode check + diff
// classification. Tests run directly against the service class with the
// FakeBundleRepository and an optional discovery snapshot stub.

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

let repo;
let service;

beforeEach(() => {
    repo = new FakeBundleRepository();
});

// ─────────────────────────────────────────────────────────────────
// Master operations
// ─────────────────────────────────────────────────────────────────

describe('BundlesService — Master operations', () => {
    test('createBundle creates a new bundle master record', async () => {
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

    test('createBundle throws 422 on duplicate (projectKey, bundleKey)', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        await service.createBundle({ projectKey: PROJECT, bundleKey: 'BANKING', label: 'X' });
        await assert.rejects(
            () => service.createBundle({ projectKey: PROJECT, bundleKey: 'BANKING', label: 'Y' }),
            /existiert bereits/,
        );
    });

    test('updateBundle changes label, leaves projectKey/bundleKey untouched', async () => {
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

    test('softDeleteBundle is idempotent', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const created = await service.createBundle({
            projectKey: PROJECT,
            bundleKey: 'BANKING',
            label: 'X',
        });
        await service.softDeleteBundle(created.id);
        await service.softDeleteBundle(created.id); // no error
        const after = await repo.findById(created.id);
        assert.notEqual(after?.deletedAt, null);
    });

    test('listBundles filters out soft-deleted', async () => {
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
// Version lifecycle: createDraft / updateDraft / publish
// ─────────────────────────────────────────────────────────────────

describe('BundlesService — Version lifecycle', () => {
    test('createBundleDraft creates v1 with baseVersionId=null', async () => {
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

    test('createBundleDraft throws 422 if a draft already exists', async () => {
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

    test('updateBundleDraft throws 422 on published version', async () => {
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
        // Pack 2c: published versions are only editable if they are
        // latest-in-chain, bind no subscription AND validFrom lies in
        // the future. As long as the BundleVersion publish pipeline
        // does not know a validFrom (see OPEN_ISSUES §11.x), every
        // published bundle version stays frozen — fail-closed.
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

    test('publishBundleVersion classifies diff (feature added = IMPROVEMENT)', async () => {
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
        // v1 is superseded
        const v1After = await repo.findVersionById(v1.bundleVersion.id);
        assert.notEqual(v1After.supersededAt, null);
    });

    test('publishBundleVersion blocks regressive version without forceRegressive', async () => {
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
            features: ['SEPA_DIRECT_DEBIT'], // RECEIVABLES removed → REGRESSION
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

    test('publishBundleVersion lets regressive version through with forceRegressive', async () => {
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
// Strict mode check (warn-only default)
// ─────────────────────────────────────────────────────────────────

describe('BundlesService — Strict mode check', () => {
    test('warn-only: drift features come back as warnings, persisted anyway', async () => {
        const snapshot = buildSnapshot(['SEPA_DIRECT_DEBIT'], []); // RECEIVABLES missing
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
        // Persisted anyway
        const stored = await repo.findVersionById(result.bundleVersion.id);
        assert.deepEqual(stored.features, ['SEPA_DIRECT_DEBIT', 'RECEIVABLES']);
    });

    test('blocking: drift features throw 422', async () => {
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

    test('without snapshot: no strict check, empty warnings', async () => {
        service = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' }); // no snapshot
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

    test('compatibility.planIds drift blocks even in warn-only mode', async () => {
        // PlanRepository with only one existing plan "STARTER".
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

    test('compatibility.planIds without PlanRepository → no BUNDLE_PLAN_KEY_UNKNOWN', async () => {
        // No planRepo injected → check is skipped (graceful).
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

    test('quota drift is reported as QUOTA_MISSING', async () => {
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

describe('BundlesService — Editability annotation (Pack 2c)', () => {
    const FUTURE = '2099-01-01';
    const FUTURE_NEXT = '2099-06-01';

    test('listBundleVersions sets isLatestInChain on the highest version', async () => {
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

    test('publishBundleVersion: without validFrom → 422 BUNDLE_VERSION_VALID_FROM_REQUIRED', async () => {
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

    test('publishBundleVersion: second version sets previous to supersededAt + auto-succession validUntil', async () => {
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
        assert.notEqual(v1After.supersededAt, null, 'v1 must be superseded');
        // Auto-succession: validUntil(v1) = validFrom(v2) - 1 day
        assert.equal(v1After.validUntil?.slice(0, 10), '2026-05-31');
    });

    test('publishBundleVersion: validFrom must be strictly after predecessor → 422', async () => {
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
                    validFrom: '2026-06-01', // == predecessor, not strictly after
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS');
                return true;
            },
        );
    });

    test('updateBundleDraft allows published-but-future BundleVersion (latest, 0 subs)', async () => {
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
        // 0 subs → editable despite publishedAt != null
        const updated = await service.updateBundleDraft(published.bundleVersion.id, {
            monthlyNet: '12.00',
        });
        assert.equal(updated.bundleVersion.monthlyNet, '12.00');
        assert.notEqual(updated.bundleVersion.publishedAt, null, 'published status remains');
    });

    test('updateBundleDraft blocks published-but-future validFrom in the past', async () => {
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

    test('updateBundleDraft blocks validFrom before the predecessor version', async () => {
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

    test('updateBundleDraft blocks validUntil before validFrom', async () => {
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

    test('updateBundleDraft blocks published-but-future BundleVersion with subscription', async () => {
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

    test('discardBundleDraft removes draft + throws on published', async () => {
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

        // Discard on published → 422
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

    test('updateBundleDraft blocks published version that is not latest-in-chain', async () => {
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
        // v1 published-future-active, but NOT latest-in-chain → frozen
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
