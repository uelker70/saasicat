// Pack 3a — strict mode check for PlanVersionsService.
// Pure-function test (validatePlanDraft) + service integration with a
// discovery snapshot stub and both modes (warn-only / blocking).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PlanVersionsService,
    PlansService,
    validatePlanDraft,
    validateBundleDraft,
} from '../dist/catalog/index.js';
import { FakePlanRepository } from '../dist/testing/index.js';

const PROJECT = 'clubapp';

function buildSnapshot(features = [], quotas = []) {
    return {
        schemaVersion: 1,
        scannedAt: '2026-05-14T00:00:00.000Z',
        app: { key: PROJECT, version: '0.1.0' },
        capabilities: [],
        features: features.map((f) => ({ featureKey: f, capabilityKeys: [] })),
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

// ─────────────────────────────────────────────────────────────────
// Pure function: validatePlanDraft
// ─────────────────────────────────────────────────────────────────

describe('validatePlanDraft (pure)', () => {
    test('all present → no warnings', () => {
        const snap = buildSnapshot(['MEMBERS', 'CALENDAR'], ['members', 'storageGb']);
        const warnings = validatePlanDraft(
            { features: ['MEMBERS', 'CALENDAR'], quotas: { members: 100, storageGb: 5 } },
            snap,
        );
        assert.deepEqual(warnings, []);
    });

    test('unknown feature → PLAN_FEATURE_UNKNOWN', () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const warnings = validatePlanDraft(
            { features: ['MEMBERS', 'GHOSTLY_FEATURE'], quotas: {} },
            snap,
        );
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0].code, 'PLAN_FEATURE_UNKNOWN');
        assert.equal(warnings[0].field, 'features[1]');
        assert.equal(warnings[0].value, 'GHOSTLY_FEATURE');
    });

    test('unknown quota key → QUOTA_MISSING', () => {
        const snap = buildSnapshot(['MEMBERS'], ['members']);
        const warnings = validatePlanDraft(
            { features: ['MEMBERS'], quotas: { members: 100, ghostQuota: 5 } },
            snap,
        );
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0].code, 'QUOTA_MISSING');
        assert.equal(warnings[0].value, 'ghostQuota');
    });

    test('multiple violations → multiple warnings, sorted by features[]/quotas{}', () => {
        const snap = buildSnapshot(['A'], ['x']);
        const warnings = validatePlanDraft(
            { features: ['A', 'B', 'C'], quotas: { x: 1, y: 2, z: 3 } },
            snap,
        );
        assert.equal(warnings.length, 4);
        const codes = warnings.map((w) => w.code);
        assert.deepEqual(codes.filter((c) => c === 'PLAN_FEATURE_UNKNOWN').length, 2);
        assert.deepEqual(codes.filter((c) => c === 'QUOTA_MISSING').length, 2);
    });

    test('PLAN_FEATURE_UNKNOWN is disjoint from BUNDLE_FEATURE_UNKNOWN', () => {
        const snap = buildSnapshot([], []);
        const planWarn = validatePlanDraft({ features: ['X'], quotas: {} }, snap);
        const bundleWarn = validateBundleDraft({ features: ['X'], quotas: {} }, snap);
        assert.equal(planWarn[0].code, 'PLAN_FEATURE_UNKNOWN');
        assert.equal(bundleWarn[0].code, 'BUNDLE_FEATURE_UNKNOWN');
    });
});

// ─────────────────────────────────────────────────────────────────
// PlanVersionsService: strict-check integration
// ─────────────────────────────────────────────────────────────────

async function setupService({ snapshot = null, mode = 'warn-only', marketedOnlyFeatures = [] } = {}) {
    const repo = new FakePlanRepository();
    const stem = new PlansService(repo);
    const versions = new PlanVersionsService(repo, snapshot, {
        strictModeCheckMode: mode,
        marketedOnlyFeatures,
    });
    const plan = await stem.createPlan({
        projectKey: PROJECT,
        planKey: 'STARTER',
        label: 'Starter',
    });
    return { repo, stem, versions, plan };
}

describe('PlanVersionsService — strict mode integration', () => {
    test('warn-only: createDraft with unknown feature → 201 + warnings[]', async () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const { versions, plan } = await setupService({ snapshot: snap, mode: 'warn-only' });
        const result = await versions.createPlanDraft({
            planId: plan.id,
            features: ['MEMBERS', 'GHOST'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        assert.equal(result.planVersion.version, 1);
        assert.equal(result.warnings.length, 1);
        assert.equal(result.warnings[0].code, 'PLAN_FEATURE_UNKNOWN');
    });

    test('blocking: createDraft with unknown feature → 422', async () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const { versions, plan } = await setupService({ snapshot: snap, mode: 'blocking' });
        await assert.rejects(
            () =>
                versions.createPlanDraft({
                    planId: plan.id,
                    features: ['GHOST'],
                    quotas: {},
                    monthlyNet: '5.00',
                    yearlyNet: '50.00',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'STRICT_MODE_VIOLATIONS');
                assert.ok(err.response?.warnings?.length > 0);
                return true;
            },
        );
    });

    test('blocking: createDraft with unknown quota → 422 with QUOTA_MISSING', async () => {
        const snap = buildSnapshot(['MEMBERS'], ['members']);
        const { versions, plan } = await setupService({ snapshot: snap, mode: 'blocking' });
        await assert.rejects(
            () =>
                versions.createPlanDraft({
                    planId: plan.id,
                    features: ['MEMBERS'],
                    quotas: { ghostQuota: 5 },
                    monthlyNet: '5.00',
                    yearlyNet: '50.00',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.warnings[0].code, 'QUOTA_MISSING');
                return true;
            },
        );
    });

    test('blocking: all present → 201 + warnings=[]', async () => {
        const snap = buildSnapshot(['MEMBERS'], ['members']);
        const { versions, plan } = await setupService({ snapshot: snap, mode: 'blocking' });
        const result = await versions.createPlanDraft({
            planId: plan.id,
            features: ['MEMBERS'],
            quotas: { members: 100 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        assert.equal(result.warnings.length, 0);
    });

    test('blocking without snapshot source → degrades to warn-only instead of crashing (#25)', async () => {
        // Previously the guard threw here (→ boot-crash outage). Now: no throw,
        // degradation to warn-only — a mutation goes through (no 422).
        const { versions, plan } = await setupService({ snapshot: null, mode: 'blocking' });
        const result = await versions.createPlanDraft({
            planId: plan.id,
            features: ['ANY_FEATURE'],
            quotas: { anyQuota: 5 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        assert.equal(result.warnings.length, 0);
    });

    test('blocking: marketed-only feature → NO 422 (allowlist)', async () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const { versions, plan } = await setupService({
            snapshot: snap,
            mode: 'blocking',
            marketedOnlyFeatures: ['PRIORITY_SUPPORT'],
        });
        // PRIORITY_SUPPORT is NOT in the snapshot, but allowlisted → no violation.
        const result = await versions.createPlanDraft({
            planId: plan.id,
            features: ['MEMBERS', 'PRIORITY_SUPPORT'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        assert.equal(result.warnings.length, 0);
        assert.equal(result.planVersion.version, 1);
    });

    test('blocking: NON-allowlisted unknown feature → still 422', async () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const { versions, plan } = await setupService({
            snapshot: snap,
            mode: 'blocking',
            marketedOnlyFeatures: ['PRIORITY_SUPPORT'],
        });
        await assert.rejects(
            () =>
                versions.createPlanDraft({
                    planId: plan.id,
                    features: ['MEMBERS', 'GHOST'],
                    quotas: {},
                    monthlyNet: '5.00',
                    yearlyNet: '50.00',
                }),
            (err) => {
                assert.equal(err.status, 422);
                return true;
            },
        );
    });

    test('scanner fallback (#25): blocking without token but with DiscoveryScanner enforces correctly', async () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const repo = new FakePlanRepository();
        const stem = new PlansService(repo);
        // Constructor args: repo, snapshot(=null), config, subscriptions(=null), scanner
        const versions = new PlanVersionsService(repo, null, { strictModeCheckMode: 'blocking' }, null, {
            getSnapshot: () => snap,
        });
        const plan = await stem.createPlan({ projectKey: PROJECT, planKey: 'STARTER', label: 'Starter' });
        await assert.rejects(
            () =>
                versions.createPlanDraft({
                    planId: plan.id,
                    features: ['GHOST'],
                    quotas: {},
                    monthlyNet: '5.00',
                    yearlyNet: '50.00',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'STRICT_MODE_VIOLATIONS');
                return true;
            },
        );
    });

    test('warn-only without snapshot → no check, warnings=[]', async () => {
        const { versions, plan } = await setupService({ snapshot: null, mode: 'warn-only' });
        const result = await versions.createPlanDraft({
            planId: plan.id,
            features: ['ANY_FEATURE'],
            quotas: { anyQuota: 5 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        assert.equal(result.warnings.length, 0);
    });

    test('blocking: publishPlanVersion runs the strict check on publish too', async () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const { versions, plan } = await setupService({ snapshot: snap, mode: 'warn-only' });
        // v1 with unknown feature waved through in warn-only
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['MEMBERS', 'GHOST'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        // We test: publishPlanVersion throws in blocking mode when the
        // draft already has drift. For that we place the draft directly into a
        // separate blocking repo and publish through it.
        const blockingRepo = new FakePlanRepository();
        await blockingRepo.create({ projectKey: PROJECT, planKey: 'STARTER', label: 'X' });
        blockingRepo.seedVersion({
            ...draft.planVersion,
            planId: 'STARTER', // matches FakePlanRepository convention
        });
        const realBlocking = new PlanVersionsService(blockingRepo, snap, {
            strictModeCheckMode: 'blocking',
        });
        await assert.rejects(
            () =>
                realBlocking.publishPlanVersion(draft.planVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-01-01',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'STRICT_MODE_VIOLATIONS');
                return true;
            },
        );
    });

    test('updatePlanDraft in blocking: drift is rejected', async () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const { versions, plan } = await setupService({ snapshot: snap, mode: 'blocking' });
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['MEMBERS'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await assert.rejects(
            () =>
                versions.updatePlanDraft(draft.planVersion.id, {
                    features: ['MEMBERS', 'GHOST_FROM_FUTURE'],
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'STRICT_MODE_VIOLATIONS');
                return true;
            },
        );
    });
});
