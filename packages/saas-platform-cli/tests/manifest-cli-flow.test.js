import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MANIFEST_CHECKS, ManifestCliFlow } from '../dist/index.js';

function buildManifest(overrides = {}) {
    return {
        schemaVersion: 1,
        project: { key: 'autohauspro', displayName: 'AutohausPro', environment: 'development' },
        build: {
            platformPackageVersion: '0.1.0',
            appVersion: '1.0.0',
            manifestHash: 'sha256-abc123_def-ghi',
        },
        planCatalogSnapshot: {
            source: 'config/plans.yaml',
            hash: 'h1',
            currency: 'EUR',
            vatRate: 19,
            quotaKeys: ['users', 'vehicles', 'storageGb'],
            features: [],
            plans: [],
        },
        capabilities: {
            // Q.3.1 (2026-05-10): SPEC §4.2.1 normativ — domain.action.
            'tenants.read': true,
            'datev.export': true,
        },
        navigation: {
            standardPages: { tenants: { enabled: true } },
            projectPages: [
                {
                    id: 'autohauspro.datev',
                    label: 'DATEV',
                    route: '/admin/datev',
                    // Beide ComponentKey-Schreibweisen sind ab Q.3.1 erlaubt:
                    // 'autohauspro-datev' (lowercase-hyphenated) ODER 'autohauspro.datev'
                    // (namespace.dot). Test-Fixture nutzt lowercase-hyphenated.
                    componentKey: 'autohauspro-datev',
                    requiredCapability: 'datev.export',
                },
            ],
        },
        dashboard: {
            kpiCards: [
                {
                    id: 'kpi-tenants',
                    label: 'Aktive Tenants',
                    endpoint: '/api/v1/admin/dashboard/tenants',
                    displayHint: { type: 'value' },
                    slotPriority: 50,
                },
            ],
        },
        tenants: {
            columns: [
                {
                    key: 'datev_status',
                    label: 'DATEV',
                    endpoint: '/api/v1/admin/extras/datev-status',
                },
            ],
            actions: [
                {
                    id: 'autohauspro.datev.runExport',
                    label: 'Export',
                    // Q.3.1: TenantAction.actionKey nutzt ab jetzt domain.action
                    // (SPEC §4.2.1) — analog zu Capabilities. AuditAction.key
                    // bleibt SCREAMING_SNAKE_CASE (siehe audit-Block unten).
                    actionKey: 'datev.export',
                    requiredCapability: 'datev.export',
                },
            ],
        },
        audit: {
            actions: [{ key: 'DATEV_EXPORT_RUN', label: 'DATEV-Export gestartet' }],
        },
        ...overrides,
    };
}

function buildFlow(manifest) {
    const port = { getManifest: () => manifest };
    return new ManifestCliFlow(port, DEFAULT_MANIFEST_CHECKS);
}

describe('ManifestCliFlow.dump / hash / validate', () => {
    test('dump liefert das Manifest 1:1', () => {
        const m = buildManifest();
        const flow = buildFlow(m);
        assert.equal(flow.dump(), m);
    });

    test('hash liefert manifestHash', () => {
        const flow = buildFlow(buildManifest());
        assert.equal(flow.hash(), 'sha256-abc123_def-ghi');
    });

    test('hash wirft, wenn Hash fehlt', () => {
        const m = buildManifest({
            build: { platformPackageVersion: '0.1.0', appVersion: '1.0.0', manifestHash: '' },
        });
        const flow = buildFlow(m);
        assert.throws(() => flow.hash(), /manifestHash fehlt/);
    });

    test('validate ok bei sauberem Manifest', () => {
        const flow = buildFlow(buildManifest());
        assert.deepEqual(flow.validate(), { ok: true });
    });

    test('validate lehnt falsche schemaVersion ab', () => {
        const flow = buildFlow(buildManifest({ schemaVersion: 2 }));
        const r = flow.validate();
        assert.equal(r.ok, false);
        assert.match(r.reason, /schemaVersion/);
    });
});

describe('ManifestCliFlow.diff', () => {
    test('null bei identischem Hash', () => {
        const m = buildManifest();
        const flow = buildFlow(m);
        const expected = buildManifest();
        assert.equal(flow.diff(expected), null);
    });

    test('liefert added/removed componentKeys', () => {
        const m = buildManifest();
        const flow = buildFlow(m);
        const expected = buildManifest({
            build: { ...m.build, manifestHash: 'sha256-different' },
            navigation: {
                standardPages: m.navigation.standardPages,
                projectPages: [
                    {
                        id: 'autohauspro.legacy',
                        label: 'Legacy',
                        route: '/admin/legacy',
                        componentKey: 'autohauspro-legacy',
                    },
                ],
            },
        });
        const d = flow.diff(expected);
        assert.notEqual(d, null);
        assert.deepEqual(d.componentKeysAdded, ['autohauspro-datev']);
        assert.deepEqual(d.componentKeysRemoved, ['autohauspro-legacy']);
    });
});

describe('ManifestCliFlow.runChecks — DEFAULT_MANIFEST_CHECKS', () => {
    test('sauberes Manifest → overall=ok, alle Checks grün', async () => {
        const flow = buildFlow(buildManifest());
        const report = await flow.runChecks();
        assert.equal(report.overall, 'ok');
        assert.ok(
            report.checks.length >= 10,
            `mindestens 10 Checks erwartet, war ${report.checks.length}`,
        );
        assert.equal(flow.exitCodeFor(report), 0);
        for (const c of report.checks) assert.equal(c.severity, 'ok', c.id + ': ' + c.message);
    });

    test('falscher manifestHash-Pattern → error, exitCode=7', async () => {
        const m = buildManifest({
            build: {
                platformPackageVersion: '0.1.0',
                appVersion: '1.0.0',
                manifestHash: 'not-a-hash',
            },
        });
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        assert.equal(report.overall, 'error');
        assert.equal(flow.exitCodeFor(report), 7);
        const failed = report.checks.find((c) => c.id === 'manifest.hash-format');
        assert.equal(failed.severity, 'error');
    });

    test('per-Tenant-endpoint in TenantColumn → error', async () => {
        const m = buildManifest();
        m.tenants.columns[0].endpoint = '/api/v1/admin/extras/datev-status/{slug}';
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        const c = report.checks.find((c) => c.id === 'manifest.tenant-columns-batchable');
        assert.equal(c.severity, 'error');
    });

    test('non-/admin-Route → error', async () => {
        const m = buildManifest();
        m.navigation.projectPages[0].route = '/datev';
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        const c = report.checks.find((c) => c.id === 'manifest.route-prefix');
        assert.equal(c.severity, 'error');
    });

    test('unbekannte requiredCapability-Ref → error', async () => {
        const m = buildManifest();
        m.navigation.projectPages[0].requiredCapability = 'foo:bar:baz';
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        const c = report.checks.find((c) => c.id === 'manifest.required-capabilities-known');
        assert.equal(c.severity, 'error');
    });

    test('falsches Capability-Pattern → error', async () => {
        const m = buildManifest();
        m.capabilities['BadCap'] = true;
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        const c = report.checks.find((c) => c.id === 'manifest.capabilities-pattern');
        assert.equal(c.severity, 'error');
    });

    test('SCREAMING_SNAKE_CASE actionKey verletzt jetzt domain.action → error', async () => {
        const m = buildManifest();
        m.tenants.actions[0].actionKey = 'DATEV_EXPORT_RUN';
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        const c = report.checks.find((c) => c.id === 'manifest.tenant-action-keys');
        assert.equal(c.severity, 'error');
    });

    test('formatReport zeigt Severity-Icons + Pfade', () => {
        const flow = buildFlow(buildManifest());
        const report = {
            overall: 'error',
            checks: [
                { id: 'a', label: 'A', severity: 'ok', message: 'fine' },
                { id: 'b', label: 'B', severity: 'error', message: 'broken', paths: ['x', 'y'] },
            ],
        };
        const out = flow.formatReport(report);
        assert.match(out, /ERROR/);
        assert.match(out, /✓ {2}A/);
        assert.match(out, /✗ {2}B/);
        assert.match(out, /· x/);
        assert.match(out, /· y/);
    });
});
