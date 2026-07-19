import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    validateSeedAgainstSnapshot,
    formatSeedGateReport,
    seedGateExitCode,
} from '../dist/catalog/index.js';

// Seed-Gate — Pre-Persistence-Validierung geseedeter Plan-/Bundle-Drafts gegen
// den Discovery-Snapshot (#12 Slice 2). Pure Functions, kein DI.

function snapshot({ features = [], quotas = [] } = {}) {
    return {
        schemaVersion: 1,
        scannedAt: '2026-06-08T00:00:00.000Z',
        app: { key: 'vereinsfux', version: '0.1.0' },
        capabilities: [],
        features: features.map((f) => ({ featureKey: f, capabilityKeys: [] })),
        quotas: quotas.map((q) => ({
            quotaKey: q,
            label: q,
            unit: '/month',
            policy: 'hardCap',
            feature: null,
            declaredAt: '',
            enforcedBy: [],
        })),
        hash: 'sha256-test',
    };
}

describe('validateSeedAgainstSnapshot', () => {
    test('alle geseedeten Features discovered → overall ok', () => {
        const report = validateSeedAgainstSnapshot({
            snapshot: snapshot({ features: ['MEMBERS', 'SEPA'], quotas: ['apiCalls'] }),
            plans: [{ planKey: 'STARTER', features: ['MEMBERS'], quotas: { apiCalls: 1000 } }],
            bundles: [{ bundleKey: 'BANKING', features: ['SEPA'] }],
        });
        assert.equal(report.overall, 'ok');
        assert.equal(report.counts.total, 0);
        assert.equal(seedGateExitCode(report), 0);
    });

    test('Plan mit nicht-discovertem Feature → PLAN_FEATURE_UNKNOWN + error', () => {
        const report = validateSeedAgainstSnapshot({
            snapshot: snapshot({ features: ['MEMBERS'] }),
            plans: [{ planKey: 'PRO', features: ['MEMBERS', 'LUFTSCHLOSS'] }],
        });
        assert.equal(report.overall, 'error');
        assert.equal(report.counts.planFindings, 1);
        const [finding] = report.findings;
        assert.equal(finding.kind, 'plan');
        assert.equal(finding.entityKey, 'PRO');
        assert.equal(finding.warning.code, 'PLAN_FEATURE_UNKNOWN');
        assert.equal(finding.warning.value, 'LUFTSCHLOSS');
        assert.equal(seedGateExitCode(report), 4);
    });

    test('Bundle mit nicht-discovertem Feature → BUNDLE_FEATURE_UNKNOWN', () => {
        const report = validateSeedAgainstSnapshot({
            snapshot: snapshot({ features: ['SEPA'] }),
            bundles: [{ bundleKey: 'SPORT', features: ['SEPA', 'GHOST'] }],
        });
        assert.equal(report.overall, 'error');
        assert.equal(report.counts.bundleFindings, 1);
        assert.equal(report.findings[0].warning.code, 'BUNDLE_FEATURE_UNKNOWN');
    });

    test('nicht-discoverte Quota → QUOTA_MISSING', () => {
        const report = validateSeedAgainstSnapshot({
            snapshot: snapshot({ features: ['MEMBERS'] }),
            plans: [{ planKey: 'STARTER', features: ['MEMBERS'], quotas: { ghostQuota: 5 } }],
        });
        assert.equal(report.overall, 'error');
        assert.equal(report.findings[0].warning.code, 'QUOTA_MISSING');
    });

    test('leere Eingabe → ok', () => {
        const report = validateSeedAgainstSnapshot({ snapshot: snapshot() });
        assert.equal(report.overall, 'ok');
        assert.equal(report.counts.total, 0);
    });

    test('formatSeedGateReport zeigt Entity + Code', () => {
        const report = validateSeedAgainstSnapshot({
            snapshot: snapshot({ features: [] }),
            plans: [{ planKey: 'PRO', features: ['LUFTSCHLOSS'] }],
        });
        const out = formatSeedGateReport(report);
        assert.match(out, /Status: ERROR/);
        assert.match(out, /plan PRO/);
        assert.match(out, /PLAN_FEATURE_UNKNOWN/);
    });
});
