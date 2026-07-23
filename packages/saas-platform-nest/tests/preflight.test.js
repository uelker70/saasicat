// Pack 3b — Preflight pure-function tests (SPEC_V2 §8.3 + §10).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { formatPreflightReport, preflightExitCode, runPreflight } from '../dist/catalog/index.js';

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

const VERSIONED_BASE = {
    publishedAt: '2026-05-14T00:00:00.000Z',
    supersededAt: null,
    publishedChanges: null,
    changeNote: 'init',
    nonRegressive: true,
    createdByUserId: null,
    publishedByUserId: null,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    baseVersionId: null,
};

function makePlanVersion(overrides) {
    return {
        ...VERSIONED_BASE,
        id: 'pv-1',
        planId: 'STARTER',
        version: 1,
        features: [],
        quotas: {},
        monthlyNet: '5.00',
        yearlyNet: '50.00',
        marketed: true,
        ...overrides,
    };
}

function makeBundleVersion(overrides) {
    return {
        ...VERSIONED_BASE,
        id: 'bv-1',
        bundleId: 'b-stem-1',
        bundleKey: 'BANKING',
        label: 'Banking',
        version: 1,
        features: [],
        quotas: {},
        compatibility: {},
        pricingOverrides: [],
        monthlyNet: null,
        yearlyNet: null,
        marketed: true,
        ...overrides,
    };
}

describe('runPreflight', () => {
    test('empty catalog → overall=ok, total=0', () => {
        const r = runPreflight({
            snapshot: buildSnapshot(),
            planVersions: [],
            bundleVersions: [],
        });
        assert.equal(r.overall, 'ok');
        assert.equal(r.counts.total, 0);
        assert.equal(preflightExitCode(r), 0);
    });

    test('everything present → overall=ok', () => {
        const r = runPreflight({
            snapshot: buildSnapshot(['MEMBERS', 'CALENDAR'], ['members']),
            planVersions: [makePlanVersion({ features: ['MEMBERS'], quotas: { members: 100 } })],
            bundleVersions: [makeBundleVersion({ features: ['CALENDAR'], quotas: {} })],
        });
        assert.equal(r.overall, 'ok');
        assert.equal(r.counts.total, 0);
    });

    test('plan with unknown feature → overall=error, kind=plan', () => {
        const r = runPreflight({
            snapshot: buildSnapshot(['MEMBERS'], []),
            planVersions: [makePlanVersion({ features: ['MEMBERS', 'GHOST'], quotas: {} })],
            bundleVersions: [],
        });
        assert.equal(r.overall, 'error');
        assert.equal(r.counts.planFindings, 1);
        assert.equal(r.findings[0].kind, 'plan');
        assert.equal(r.findings[0].entityKey, 'STARTER');
        assert.equal(r.findings[0].warning.code, 'PLAN_FEATURE_UNKNOWN');
        assert.equal(preflightExitCode(r), 4);
    });

    test('bundle with unknown feature → kind=bundle, BUNDLE_FEATURE_UNKNOWN', () => {
        const r = runPreflight({
            snapshot: buildSnapshot([], []),
            planVersions: [],
            bundleVersions: [makeBundleVersion({ features: ['SOMETHING'], quotas: {} })],
        });
        assert.equal(r.overall, 'error');
        assert.equal(r.counts.bundleFindings, 1);
        assert.equal(r.findings[0].warning.code, 'BUNDLE_FEATURE_UNKNOWN');
    });

    test('findings are deterministically sorted (kind, entityKey, version, code)', () => {
        const r = runPreflight({
            snapshot: buildSnapshot([], []),
            planVersions: [
                makePlanVersion({ id: 'pv-z', planId: 'Z_PLAN', features: ['X'] }),
                makePlanVersion({ id: 'pv-a', planId: 'A_PLAN', features: ['X'] }),
            ],
            bundleVersions: [
                makeBundleVersion({ id: 'bv-z', bundleKey: 'Z_BUNDLE', features: ['Y'] }),
                makeBundleVersion({ id: 'bv-a', bundleKey: 'A_BUNDLE', features: ['Y'] }),
            ],
        });
        // bundle before plan (alphabetical); within, a before z
        assert.deepEqual(
            r.findings.map((f) => `${f.kind}:${f.entityKey}`),
            ['bundle:A_BUNDLE', 'bundle:Z_BUNDLE', 'plan:A_PLAN', 'plan:Z_PLAN'],
        );
    });
});

describe('formatPreflightReport', () => {
    test('OK report contains OK checkmark', () => {
        const out = formatPreflightReport({
            overall: 'ok',
            counts: { planFindings: 0, bundleFindings: 0, total: 0 },
            findings: [],
        });
        assert.match(out, /Status: OK/);
        assert.match(out, /Keine Strict-Mode-Verst/);
    });

    test('error report lists findings with codes', () => {
        const out = formatPreflightReport({
            overall: 'error',
            counts: { planFindings: 1, bundleFindings: 0, total: 1 },
            findings: [
                {
                    kind: 'plan',
                    versionId: 'pv-1',
                    entityKey: 'STARTER',
                    version: 1,
                    warning: {
                        code: 'PLAN_FEATURE_UNKNOWN',
                        message: 'Feature X fehlt',
                        field: 'features[0]',
                        value: 'X',
                    },
                },
            ],
        });
        assert.match(out, /Status: ERROR/);
        assert.match(out, /plan STARTER v1/);
        assert.match(out, /PLAN_FEATURE_UNKNOWN/);
    });
});
