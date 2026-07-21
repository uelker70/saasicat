// 10 default manifest checks for `<app> manifest check`.
//
// Consumers may register additional checks via `MANIFEST_CHECKS_TOKEN`
// (e.g. an app-specific `datev:export` capability requirement). The 10
// defined here are platform-wide — every AdminManifest instance
// MUST pass them so the manifest is schema-conformant and semantically
// consistent.
//
// Spec: packages/saas-platform-spec/schemas/admin-manifest.schema.json

import type { AdminManifest } from '@saasicat/types';

export interface ManifestCheckResult {
    severity: 'ok' | 'warning' | 'error';
    message: string;
    /** Optional: affected paths/keys for detailed output. */
    paths?: string[];
}

export interface ManifestCheck {
    readonly id: string;
    readonly label: string;
    run(manifest: AdminManifest): ManifestCheckResult;
}

// Q.3.1 (2026-05-10): Aligned with SPEC §4.2.1 + real consumer convention.
//   - Capabilities + TenantActionKeys: `domain.action` with
//       * at least one dot (`tenants.read`),
//       * camelCase action allowed (`users.resetPassword`),
//       * multi-level allowed (`mosque.zakat.read`).
//     Existing consumers use all three forms productively.
//   - ComponentKeys: BOTH spellings allowed — `lowercase-hyphenated`
//     (`clubapp-sport`) AND `namespace.dot` (`demoapp.datev`).
//   - AuditActionKeys: stay `SCREAMING_SNAKE_CASE` (`MEMBER_CREATE` etc.)
//     — established in consumer apps + platform core, semantically
//     more fitting for audit-log consumers (filter, severity mapping).
const COMPONENT_KEY_PATTERN = /^[a-z][a-z0-9]*([.-][a-z0-9]+)+$/;
const ACTION_KEY_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const TENANT_ACTION_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)+$/;
const CAPABILITY_PATTERN = /^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)+$/;
const ROUTE_PREFIX = '/admin';

function ok(message: string): ManifestCheckResult {
    return { severity: 'ok', message };
}
function err(message: string, paths?: string[]): ManifestCheckResult {
    return { severity: 'error', message, paths };
}

function allProjectPages(m: AdminManifest) {
    return m.navigation?.projectPages ?? [];
}
function allKpiCards(m: AdminManifest) {
    return m.dashboard?.kpiCards ?? [];
}
function allTenantActions(m: AdminManifest) {
    return m.tenants?.actions ?? [];
}
function allTenantColumns(m: AdminManifest) {
    return m.tenants?.columns ?? [];
}
function allAuditActions(m: AdminManifest) {
    return m.audit?.actions ?? [];
}
function allCapabilities(m: AdminManifest): string[] {
    return Object.keys(m.capabilities ?? {});
}

export const DEFAULT_MANIFEST_CHECKS: ManifestCheck[] = [
    {
        id: 'manifest.schema-version',
        label: 'schemaVersion ist 1',
        run: (m) =>
            m.schemaVersion === 1
                ? ok('schemaVersion=1')
                : err(`Unerwartete schemaVersion ${m.schemaVersion}`),
    },
    {
        id: 'manifest.hash-format',
        label: 'manifestHash folgt sha256-<base64url>-Pattern',
        run: (m) => {
            const hash = m.build?.manifestHash;
            if (!hash) return err('manifestHash fehlt');
            return /^sha256-[A-Za-z0-9_-]+$/.test(hash)
                ? ok(hash)
                : err(`manifestHash hat falsches Format: ${hash}`);
        },
    },
    {
        id: 'manifest.project-page-component-keys',
        label: 'ProjectPage.componentKey-Format (lowercase-hyphenated ODER namespace.dot)',
        run: (m) => {
            const bad: string[] = [];
            for (const p of allProjectPages(m)) {
                if (!COMPONENT_KEY_PATTERN.test(p.componentKey)) bad.push(p.componentKey);
            }
            return bad.length === 0
                ? ok(`${allProjectPages(m).length} ProjectPage(s) ok`)
                : err(`${bad.length} componentKey(s) verletzen das Pattern`, bad);
        },
    },
    {
        id: 'manifest.tenant-action-keys',
        label: 'TenantAction.actionKey-Format (domain.action — SPEC §4.2.1)',
        run: (m) => {
            const bad: string[] = [];
            for (const a of allTenantActions(m)) {
                if (!TENANT_ACTION_KEY_PATTERN.test(a.actionKey)) bad.push(a.actionKey);
            }
            return bad.length === 0
                ? ok('alle actionKeys folgen domain.action')
                : err(`${bad.length} actionKey(s) verletzen das Pattern`, bad);
        },
    },
    {
        id: 'manifest.audit-action-keys',
        label: 'AuditAction.key-Format (SCREAMING_SNAKE_CASE)',
        run: (m) => {
            const bad: string[] = [];
            for (const a of allAuditActions(m)) {
                if (!ACTION_KEY_PATTERN.test(a.key)) bad.push(a.key);
            }
            return bad.length === 0
                ? ok('alle AuditAction.keys SCREAMING_SNAKE_CASE')
                : err(`${bad.length} AuditAction.key(s) verletzen das Pattern`, bad);
        },
    },
    {
        id: 'manifest.capabilities-pattern',
        label: 'Capability-Pattern <domain>.<action> (SPEC §4.2.1)',
        run: (m) => {
            const bad = allCapabilities(m).filter((c) => !CAPABILITY_PATTERN.test(c));
            return bad.length === 0
                ? ok(`${allCapabilities(m).length} Capabilities ok`)
                : err(`${bad.length} Capability/-ies verletzen das Pattern`, bad);
        },
    },
    {
        id: 'manifest.required-capabilities-known',
        label: 'requiredCapability-Referenzen existieren in capabilities-Map',
        run: (m) => {
            const known = new Set(allCapabilities(m));
            const bad: string[] = [];
            const visit = (cap?: string | null, ctx?: string) => {
                if (cap && !known.has(cap)) bad.push(`${ctx ?? '?'}: ${cap}`);
            };
            for (const p of allProjectPages(m)) visit(p.requiredCapability, p.id);
            for (const k of allKpiCards(m)) visit(k.requiredCapability, k.id);
            for (const a of allTenantActions(m)) visit(a.requiredCapability, a.id);
            for (const c of allTenantColumns(m)) visit(c.requiredCapability, c.key);
            return bad.length === 0
                ? ok('alle requiredCapability-Refs aufgelöst')
                : err(`${bad.length} unbekannte Capability-Ref(s)`, bad);
        },
    },
    {
        id: 'manifest.route-prefix',
        label: 'ProjectPage.route beginnt mit /admin',
        run: (m) => {
            const bad: string[] = [];
            for (const p of allProjectPages(m)) {
                if (!p.route.startsWith(ROUTE_PREFIX)) bad.push(p.route);
            }
            return bad.length === 0
                ? ok('alle ProjectPage-Routes unter /admin')
                : err(`${bad.length} Route(s) ohne /admin-Prefix`, bad);
        },
    },
    {
        id: 'manifest.kpi-slot-priority',
        label: 'KpiCard.slotPriority (falls gesetzt) ist endliche Zahl',
        run: (m) => {
            const bad: string[] = [];
            for (const k of allKpiCards(m)) {
                if (k.slotPriority !== undefined && !Number.isFinite(k.slotPriority)) {
                    bad.push(k.id);
                }
            }
            return bad.length === 0
                ? ok('alle slotPriority-Werte endlich')
                : err(`${bad.length} KpiCard(s) mit ungültiger slotPriority`, bad);
        },
    },
    {
        id: 'manifest.unique-project-page-ids',
        label: 'ProjectPage.id ist unique',
        run: (m) => {
            const seen = new Map<string, number>();
            for (const p of allProjectPages(m)) {
                seen.set(p.id, (seen.get(p.id) ?? 0) + 1);
            }
            const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
            return dups.length === 0
                ? ok('alle ProjectPage.id eindeutig')
                : err(`${dups.length} doppelte ProjectPage.id`, dups);
        },
    },
    {
        id: 'manifest.unique-action-keys',
        label: 'actionKeys sind je Namespace (TenantAction / AuditAction) eindeutig',
        run: (m) => {
            const dups: string[] = [];
            const tenantSeen = new Map<string, number>();
            for (const a of allTenantActions(m)) {
                tenantSeen.set(a.actionKey, (tenantSeen.get(a.actionKey) ?? 0) + 1);
            }
            for (const [k, n] of tenantSeen) {
                if (n > 1) dups.push(`TenantAction:${k}`);
            }
            const auditSeen = new Map<string, number>();
            for (const a of allAuditActions(m)) {
                auditSeen.set(a.key, (auditSeen.get(a.key) ?? 0) + 1);
            }
            for (const [k, n] of auditSeen) {
                if (n > 1) dups.push(`AuditAction:${k}`);
            }
            return dups.length === 0
                ? ok('alle actionKeys je Namespace eindeutig')
                : err(`${dups.length} doppelte actionKey(s)`, dups);
        },
    },
    {
        id: 'manifest.tenant-columns-batchable',
        label: 'TenantColumns haben endpoint-Pfad für Batch-Fetch',
        run: (m) => {
            const bad: string[] = [];
            for (const c of allTenantColumns(m)) {
                if (!c.endpoint || c.endpoint.trim().length === 0) bad.push(c.key);
                else if (c.endpoint.includes('{slug}') || c.endpoint.includes('{tenantId}')) {
                    bad.push(`${c.key} (per-Tenant statt batch)`);
                }
            }
            return bad.length === 0
                ? ok('alle TenantColumns batch-fähig')
                : err(`${bad.length} TenantColumn(s) verletzen Batch-Pflicht`, bad);
        },
    },
];
