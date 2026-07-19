// Pack 3a — Strict-Mode-Check für PlanVersionsService.
// Pure-Function-Test (validatePlanDraft) + Service-Integration mit
// Discovery-Snapshot-Stub und beide Modi (warn-only / blocking).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PlanVersionsService,
    PlansService,
    validatePlanDraft,
    validateBundleDraft,
} from '../dist/catalog/index.js';
import { FakePlanRepository } from '../dist/testing/index.js';

const PROJECT = 'vereinsfux';

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
// Pure-Function: validatePlanDraft
// ─────────────────────────────────────────────────────────────────

describe('validatePlanDraft (pure)', () => {
    test('alles vorhanden → keine Warnings', () => {
        const snap = buildSnapshot(['MEMBERS', 'CALENDAR'], ['members', 'storageGb']);
        const warnings = validatePlanDraft(
            { features: ['MEMBERS', 'CALENDAR'], quotas: { members: 100, storageGb: 5 } },
            snap,
        );
        assert.deepEqual(warnings, []);
    });

    test('unbekanntes Feature → PLAN_FEATURE_UNKNOWN', () => {
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

    test('unbekannter Quota-Key → QUOTA_MISSING', () => {
        const snap = buildSnapshot(['MEMBERS'], ['members']);
        const warnings = validatePlanDraft(
            { features: ['MEMBERS'], quotas: { members: 100, ghostQuota: 5 } },
            snap,
        );
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0].code, 'QUOTA_MISSING');
        assert.equal(warnings[0].value, 'ghostQuota');
    });

    test('mehrere Verstöße → mehrere Warnings, sortiert nach features[]/quotas{}', () => {
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

    test('PLAN_FEATURE_UNKNOWN ist disjunkt zu BUNDLE_FEATURE_UNKNOWN', () => {
        const snap = buildSnapshot([], []);
        const planWarn = validatePlanDraft({ features: ['X'], quotas: {} }, snap);
        const bundleWarn = validateBundleDraft({ features: ['X'], quotas: {} }, snap);
        assert.equal(planWarn[0].code, 'PLAN_FEATURE_UNKNOWN');
        assert.equal(bundleWarn[0].code, 'BUNDLE_FEATURE_UNKNOWN');
    });
});

// ─────────────────────────────────────────────────────────────────
// PlanVersionsService: Strict-Check-Integration
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

describe('PlanVersionsService — Strict-Mode-Integration', () => {
    test('warn-only: createDraft mit unbekanntem Feature → 201 + warnings[]', async () => {
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

    test('blocking: createDraft mit unbekanntem Feature → 422', async () => {
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

    test('blocking: createDraft mit unbekannter Quota → 422 mit QUOTA_MISSING', async () => {
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

    test('blocking: alles vorhanden → 201 + warnings=[]', async () => {
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

    test('blocking ohne Snapshot-Quelle → degradiert auf warn-only statt Crash (#25)', async () => {
        // Früher warf der Guard hier (→ Boot-Crash-Outage). Jetzt: kein Throw,
        // Degradierung auf warn-only — eine Mutation läuft durch (kein 422).
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

    test('blocking: marketed-only-Feature → KEIN 422 (Allowlist)', async () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const { versions, plan } = await setupService({
            snapshot: snap,
            mode: 'blocking',
            marketedOnlyFeatures: ['PRIORITY_SUPPORT'],
        });
        // PRIORITY_SUPPORT ist NICHT im Snapshot, aber allowlisted → kein Verstoß.
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

    test('blocking: NICHT-allowlisted unbekanntes Feature → weiterhin 422', async () => {
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

    test('Scanner-Fallback (#25): blocking ohne Token, aber mit DiscoveryScanner erzwingt korrekt', async () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const repo = new FakePlanRepository();
        const stem = new PlansService(repo);
        // Konstruktor-Args: repo, snapshot(=null), config, subscriptions(=null), scanner
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

    test('warn-only ohne Snapshot → kein Check, warnings=[]', async () => {
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

    test('blocking: publishPlanVersion läuft Strict-Check auch beim Publish', async () => {
        const snap = buildSnapshot(['MEMBERS'], []);
        const { versions, plan } = await setupService({ snapshot: snap, mode: 'warn-only' });
        // v1 mit unbekanntem Feature in warn-only durchgewunken
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['MEMBERS', 'GHOST'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        // Wir testen: publishPlanVersion wirft im blocking-Modus, wenn der
        // Draft schon Drift hat. Dafür legen wir den Draft direkt in einen
        // separaten blocking-Repo und publishen darüber.
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

    test('updatePlanDraft im blocking: drift wird abgewiesen', async () => {
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
