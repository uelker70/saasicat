// Preflight — platform-side pure function for `yada app preflight`
// (SPEC_V2 §8.3 + §10).
//
// Compares the **entire DB catalog** (all live plans, bundles,
// bundles) against the discovery snapshot of the running backend.
// Returns a `PreflightReport` with all strict-mode violations plus an
// aggregated `overall` status.
//
// **Always blocking** in the sense of §8.3: the caller evaluates `overall ===
// 'error'` and exit-codes accordingly (CI gate). Unlike the service path in
// the UI, there is no `warn-only` here — every violation is a deploy
// blocker.
//
// Pure function without NestJS DI: testable in isolation; apps call it from
// their CLI command with the rows loaded via Prisma.

import type {
    ApprovedCatalogKeys,
    BundleVersionRow,
    DiscoverySnapshot,
    PlanVersionRow,
    StrictModeWarning,
} from '@saasicat/types';

import {
    ADVISORY_STRICT_MODE_CODES,
    validateBundleDraft,
    validatePlanDraft,
} from './strict-mode-check.js';

export interface PreflightInput {
    snapshot: DiscoverySnapshot;
    /** All live PlanVersions (publishedAt != null AND supersededAt = null). */
    planVersions: PlanVersionRow[];
    /** All live BundleVersions. */
    bundleVersions: BundleVersionRow[];
    /**
     * Approved gate (#20 Slice 5): approved feature/quota keys from the
     * catalog entries (`loadApprovedCatalogKeys`). Omitted/`null` →
     * existence checks only.
     */
    approved?: ApprovedCatalogKeys | null;
}

export interface PreflightFinding {
    /** `plan` / `bundle`. */
    kind: 'plan' | 'bundle';
    /** ID of the specific version the violation is attached to. */
    versionId: string;
    /** Human-readable key for the UI: `STARTER` or `BANKING` or `SPORT_VEREIN`. */
    entityKey: string;
    /** Version number. */
    version: number;
    warning: StrictModeWarning;
}

export interface PreflightReport {
    /** `'ok'` if no findings; otherwise `'error'`. */
    overall: 'ok' | 'error';
    /** Aggregated statistics: how many violations per kind. */
    counts: {
        planFindings: number;
        bundleFindings: number;
        total: number;
    };
    findings: PreflightFinding[];
}

/**
 * Runs the plan and bundle strict checks against the discovery snapshot.
 * Collects findings by entity type and returns a sorted report
 * (deterministic for test stability).
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

    findings.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        if (a.entityKey !== b.entityKey) return a.entityKey.localeCompare(b.entityKey);
        if (a.version !== b.version) return a.version - b.version;
        return a.warning.code.localeCompare(b.warning.code);
    });

    const counts = {
        planFindings: findings.filter((f) => f.kind === 'plan').length,
        bundleFindings: findings.filter((f) => f.kind === 'bundle').length,
        total: findings.length,
    };

    // Advisory findings (#35) do not turn the CI gate red — they appear
    // only in the report (the dependency may be covered outside the draft).
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
 * Formats the report output for CLI stdout. Returns a multi-line string.
 */
export function formatPreflightReport(report: PreflightReport): string {
    const lines: string[] = [];
    lines.push(
        `Preflight (Status: ${report.overall.toUpperCase()})`,
        `  Plans: ${report.counts.planFindings} · Bundles: ${report.counts.bundleFindings} · Gesamt: ${report.counts.total}`,
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

/** Exit code for the CLI wrapping: 0 on OK, 4 on violations. */
export function preflightExitCode(report: PreflightReport): number {
    return report.overall === 'error' ? 4 : 0;
}
