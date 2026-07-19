// Preflight — Plattform-seitige Pure-Function für `yada app preflight`
// (SPEC_V2 §8.3 + §10).
//
// Vergleicht den **gesamten DB-Catalog** (alle live Plans, Bundles,
// BusinessTypes) gegen den DiscoverySnapshot des laufenden Backends.
// Liefert einen `PreflightReport` mit allen Strict-Mode-Verstößen plus
// einem aggregierten `overall`-Status.
//
// **Immer blocking** im Sinne von §8.3: der Caller wertet `overall ===
// 'error'` und exit-codet entsprechend (CI-Gate). Im Gegensatz zum
// Service-Path im UI gibt es hier keinen `warn-only` — jeder Verstoß ist
// ein Deploy-Blocker.
//
// Pure-Function ohne NestJS-DI: testbar in Isolation; Apps rufen sie aus
// ihrem CLI-Command mit den per Prisma geladenen Rows.

import type {
    ApprovedCatalogKeys,
    BundleVersionRow,
    BusinessTypeVersionRow,
    DiscoverySnapshot,
    PlanVersionRow,
    StrictModeWarning,
} from '@saasicat/types';

import {
    ADVISORY_STRICT_MODE_CODES,
    validateBundleDraft,
    validateBusinessTypeDraft,
    validatePlanDraft,
} from './strict-mode-check.js';

export interface PreflightInput {
    snapshot: DiscoverySnapshot;
    /** Alle live PlanVersions (publishedAt != null AND supersededAt = null). */
    planVersions: PlanVersionRow[];
    /** Alle live BundleVersions. */
    bundleVersions: BundleVersionRow[];
    /** Alle live BusinessTypeVersions. */
    businessTypeVersions: BusinessTypeVersionRow[];
    /**
     * Approved-Gate (#20 Slice 5): freigegebene Feature-/Quota-Keys aus den
     * Catalog-Entries (`loadApprovedCatalogKeys`). Weggelassen/`null` →
     * nur Existenz-Checks.
     */
    approved?: ApprovedCatalogKeys | null;
}

export interface PreflightFinding {
    /** `plan` / `bundle` / `business-type`. */
    kind: 'plan' | 'bundle' | 'business-type';
    /** ID der konkreten Version, an der der Verstoß hängt. */
    versionId: string;
    /** Sprechender Key für die UI: `STARTER` oder `BANKING` oder `SPORT_VEREIN`. */
    entityKey: string;
    /** Version-Nummer. */
    version: number;
    warning: StrictModeWarning;
}

export interface PreflightReport {
    /** `'ok'` wenn keine Findings; sonst `'error'`. */
    overall: 'ok' | 'error';
    /** Aggregierte Statistik: Wie viele Verstöße pro Kind. */
    counts: {
        planFindings: number;
        bundleFindings: number;
        businessTypeFindings: number;
        total: number;
    };
    findings: PreflightFinding[];
}

/**
 * Führt alle drei Strict-Checks gegen den DiscoverySnapshot aus.
 * Sammelt Findings nach Entity-Typ und liefert einen
 * sortierten Report (deterministisch für Test-Stabilität).
 */
export function runPreflight(input: PreflightInput): PreflightReport {
    const findings: PreflightFinding[] = [];

    const approved = input.approved ?? null;

    for (const pv of input.planVersions) {
        const warns = validatePlanDraft(
            { features: pv.features, quotas: pv.quotas ?? {} },
            input.snapshot,
            new Set(),
            approved,
        );
        for (const w of warns) {
            findings.push({
                kind: 'plan',
                versionId: pv.id,
                entityKey: pv.planId,
                version: pv.version,
                warning: w,
            });
        }
    }

    for (const bv of input.bundleVersions) {
        const warns = validateBundleDraft(
            { features: bv.features, quotas: bv.quotas ?? {} },
            input.snapshot,
            null,
            new Set(),
            approved,
        );
        for (const w of warns) {
            findings.push({
                kind: 'bundle',
                versionId: bv.id,
                entityKey: bv.bundleKey,
                version: bv.version,
                warning: w,
            });
        }
    }

    // BusinessType-Check braucht zusätzlich die referenzierten Bundles
    // (für Disjointness/Compatibility). Wir indizieren einmalig.
    const bundleVersionById = new Map(input.bundleVersions.map((bv) => [bv.id, bv]));
    for (const btv of input.businessTypeVersions) {
        const referencedBundles = btv.bundles
            .map((b) => bundleVersionById.get(b.bundleVersionId))
            .filter((b): b is BundleVersionRow => b !== undefined);
        const warns = validateBusinessTypeDraft(
            {
                businessTypeKey: btv.businessTypeKey,
                quotaOverrides: (btv.quotaOverrides ?? {}) as Record<string, number>,
            },
            referencedBundles,
            input.snapshot,
            approved,
        );
        for (const w of warns) {
            findings.push({
                kind: 'business-type',
                versionId: btv.id,
                entityKey: btv.businessTypeKey,
                version: btv.version,
                warning: w,
            });
        }
    }

    findings.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        if (a.entityKey !== b.entityKey) return a.entityKey.localeCompare(b.entityKey);
        if (a.version !== b.version) return a.version - b.version;
        return a.warning.code.localeCompare(b.warning.code);
    });

    const counts = {
        planFindings: findings.filter((f) => f.kind === 'plan').length,
        bundleFindings: findings.filter((f) => f.kind === 'bundle').length,
        businessTypeFindings: findings.filter((f) => f.kind === 'business-type').length,
        total: findings.length,
    };

    // Advisory-Findings (#35) machen das CI-Gate nicht rot — sie erscheinen
    // nur im Report (die Abhängigkeit kann außerhalb des Drafts gedeckt sein).
    const hasBlockingFinding = findings.some(
        (f) => !ADVISORY_STRICT_MODE_CODES.has(f.warning.code),
    );

    return {
        overall: hasBlockingFinding ? 'error' : 'ok',
        counts,
        findings,
    };
}

/**
 * Format der Report-Ausgabe für CLI-stdout. Liefert mehrzeiligen String.
 */
export function formatPreflightReport(report: PreflightReport): string {
    const lines: string[] = [];
    lines.push(
        `Preflight (Status: ${report.overall.toUpperCase()})`,
        `  Plans: ${report.counts.planFindings} · Bundles: ${report.counts.bundleFindings} · BusinessTypes: ${report.counts.businessTypeFindings} · Gesamt: ${report.counts.total}`,
        '',
    );
    if (report.findings.length === 0) {
        lines.push('  ✓ Keine Strict-Mode-Verstöße gefunden.');
        return lines.join('\n');
    }
    let lastEntity = '';
    for (const f of report.findings) {
        const entityHeader = `${f.kind} ${f.entityKey} v${f.version}`;
        if (entityHeader !== lastEntity) {
            lines.push(`  ✗ ${entityHeader} (${f.versionId})`);
            lastEntity = entityHeader;
        }
        const fieldHint = f.warning.field ? ` [${f.warning.field}]` : '';
        lines.push(`      ${f.warning.code}${fieldHint}: ${f.warning.message}`);
    }
    return lines.join('\n');
}

/** Exit-Code für das CLI-Wrapping: 0 bei OK, 4 bei Verstößen. */
export function preflightExitCode(report: PreflightReport): number {
    return report.overall === 'error' ? 4 : 0;
}
