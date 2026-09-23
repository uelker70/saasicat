// @requirement SC-ADM-015 — The administration only offers what the application actually has

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_MANIFEST_CHECKS,
    ManifestCliFlow,
    ManifestDumpCommand,
    ManifestHashCommand,
    ManifestValidateCommand,
} from '../dist/index.js';

function buildManifest(overrides = {}) {
    return {
        schemaVersion: 1,
        project: { key: 'demoapp', displayName: 'DemoApp', environment: 'development' },
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
            features: [],
            plans: [],
        },
        capabilities: {
            // Q.3.1 (2026-05-10): SPEC §4.2.1 normative — domain.action.
            'tenants.read': true,
            'datev.export': true,
        },
        navigation: {
            standardPages: { tenants: { enabled: true } },
            projectPages: [
                {
                    id: 'demoapp.datev',
                    label: 'DATEV',
                    route: '/admin/datev',
                    // Both ComponentKey spellings are allowed as of Q.3.1:
                    // 'demoapp-datev' (lowercase-hyphenated) OR 'demoapp.datev'
                    // (namespace.dot). Test fixture uses lowercase-hyphenated.
                    componentKey: 'demoapp-datev',
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
                    id: 'demoapp.datev.runExport',
                    label: 'Export',
                    // Q.3.1: TenantAction.actionKey now uses domain.action
                    // (SPEC §4.2.1) — analogous to Capabilities. AuditAction.key
                    // stays SCREAMING_SNAKE_CASE (see audit block below).
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
    const port = { getManifest: async () => manifest };
    return new ManifestCliFlow(port, DEFAULT_MANIFEST_CHECKS);
}

describe('ManifestCliFlow.dump / hash / validate', () => {
    test('dump returns the manifest 1:1', async () => {
        const m = buildManifest();
        const flow = buildFlow(m);
        assert.equal(await flow.dump(), m);
    });

    test('hash returns manifestHash', async () => {
        const flow = buildFlow(buildManifest());
        assert.equal(await flow.hash(), 'sha256-abc123_def-ghi');
    });

    test('hash throws when hash is missing', async () => {
        const m = buildManifest({
            build: { platformPackageVersion: '0.1.0', appVersion: '1.0.0', manifestHash: '' },
        });
        const flow = buildFlow(m);
        await assert.rejects(() => flow.hash(), /manifestHash is missing/);
    });

    test('validate ok for a clean manifest', async () => {
        const flow = buildFlow(buildManifest());
        assert.deepEqual(await flow.validate(), { ok: true });
    });

    test('validate rejects wrong schemaVersion', async () => {
        const flow = buildFlow(buildManifest({ schemaVersion: 2 }));
        const r = await flow.validate();
        assert.equal(r.ok, false);
        assert.match(r.reason, /schemaVersion/);
    });
});

describe('ManifestCliFlow.diff', () => {
    test('null for identical hash', async () => {
        const m = buildManifest();
        const flow = buildFlow(m);
        const expected = buildManifest();
        assert.equal(await flow.diff(expected), null);
    });

    test('returns added/removed componentKeys', async () => {
        const m = buildManifest();
        const flow = buildFlow(m);
        const expected = buildManifest({
            build: { ...m.build, manifestHash: 'sha256-different' },
            navigation: {
                standardPages: m.navigation.standardPages,
                projectPages: [
                    {
                        id: 'demoapp.legacy',
                        label: 'Legacy',
                        route: '/admin/legacy',
                        componentKey: 'demoapp-legacy',
                    },
                ],
            },
        });
        const d = await flow.diff(expected);
        assert.notEqual(d, null);
        assert.deepEqual(d.componentKeysAdded, ['demoapp-datev']);
        assert.deepEqual(d.componentKeysRemoved, ['demoapp-legacy']);
    });
});

describe('ManifestCliFlow.runChecks — DEFAULT_MANIFEST_CHECKS', () => {
    test('clean manifest → overall=ok, all checks green', async () => {
        const flow = buildFlow(buildManifest());
        const report = await flow.runChecks();
        assert.equal(report.overall, 'ok');
        assert.ok(
            report.checks.length >= 10,
            `at least 10 checks expected, was ${report.checks.length}`,
        );
        assert.equal(flow.exitCodeFor(report), 0);
        for (const c of report.checks) assert.equal(c.severity, 'ok', c.id + ': ' + c.message);
    });

    test('wrong manifestHash pattern → error, exitCode=7', async () => {
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

    test('per-tenant endpoint in TenantColumn → error', async () => {
        const m = buildManifest();
        m.tenants.columns[0].endpoint = '/api/v1/admin/extras/datev-status/{slug}';
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        const c = report.checks.find((c) => c.id === 'manifest.tenant-columns-batchable');
        assert.equal(c.severity, 'error');
    });

    test('non-/admin route → error', async () => {
        const m = buildManifest();
        m.navigation.projectPages[0].route = '/datev';
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        const c = report.checks.find((c) => c.id === 'manifest.route-prefix');
        assert.equal(c.severity, 'error');
    });

    test('unknown requiredCapability ref → error', async () => {
        const m = buildManifest();
        m.navigation.projectPages[0].requiredCapability = 'foo:bar:baz';
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        const c = report.checks.find((c) => c.id === 'manifest.required-capabilities-known');
        assert.equal(c.severity, 'error');
    });

    test('wrong Capability pattern → error', async () => {
        const m = buildManifest();
        m.capabilities['BadCap'] = true;
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        const c = report.checks.find((c) => c.id === 'manifest.capabilities-pattern');
        assert.equal(c.severity, 'error');
    });

    test('SCREAMING_SNAKE_CASE actionKey now violates domain.action → error', async () => {
        const m = buildManifest();
        m.tenants.actions[0].actionKey = 'DATEV_EXPORT_RUN';
        const flow = buildFlow(m);
        const report = await flow.runChecks();
        const c = report.checks.find((c) => c.id === 'manifest.tenant-action-keys');
        assert.equal(c.severity, 'error');
    });

    test('formatReport shows severity icons + paths', () => {
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

// The port answers asynchronously, because the manifest reads the plan
// catalogue on every call. A command that printed without waiting would write
// `{}` for the manifest and exit 0 — nothing else would say so.
describe('the manifest commands print what the port answers', () => {
    const ctx = { resolveIdentity: () => 'root@example.com', ensureSuperAdmin: async () => {} };

    async function printed(command) {
        const chunks = [];
        const write = process.stdout.write;
        process.stdout.write = (chunk) => {
            chunks.push(String(chunk));
            return true;
        };
        try {
            await command.run([], {});
        } finally {
            process.stdout.write = write;
        }
        return chunks.join('');
    }

    test('dump prints the manifest itself', async () => {
        const manifest = buildManifest();
        const out = await printed(new ManifestDumpCommand(ctx, buildFlow(manifest)));
        assert.deepEqual(JSON.parse(out), manifest);
    });

    test('hash prints the hash', async () => {
        const out = await printed(new ManifestHashCommand(ctx, buildFlow(buildManifest())));
        assert.equal(out, 'sha256-abc123_def-ghi\n');
    });

    test('validate reads the manifest before it judges it', async () => {
        const out = await printed(new ManifestValidateCommand(ctx, buildFlow(buildManifest())));
        assert.match(out, /Manifest is valid/);
    });
});
