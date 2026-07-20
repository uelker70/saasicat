// Seed-Gate — pre-persistence validation of seeded plan/bundle feature lists
// against the discovery snapshot (#12 Slice 2).
//
// Counterpart to preflight.ts: `runPreflight` checks the LIVE DB versions AFTER
// persisting; the Seed-Gate checks the RAW seed drafts (from `saas.yaml` /
// seed scripts) BEFORE the first DB write — so that a build/seed breaks before
// an undiscovered feature ("castle in the air") ever reaches the catalog.
//
// Pure functions, no NestJS DI. Uses the same leaf validators as the
// strict-mode check + Preflight (`validatePlanDraft`/`validateBundleDraft`) —
// no logic duplication. Mode-agnostic: the caller decides via
// `seedGateExitCode` whether a violation breaks the seed/build (blocking) or
// is only reported (report-only).

import type {
    ApprovedCatalogKeys,
    DiscoverySnapshot,
    StrictModeWarning,
} from '@saasicat/types';

import {
    ADVISORY_STRICT_MODE_CODES,
    validateBundleDraft,
    validatePlanDraft,
} from './strict-mode-check.js';

export interface SeedPlanDraft {
    planKey: string;
    features: string[];
    quotas?: Record<string, number>;
}

export interface SeedBundleDraft {
    bundleKey: string;
    features: string[];
    quotas?: Record<string, number>;
}

export interface SeedGateInput {
    snapshot: DiscoverySnapshot;
    /** Plan drafts to seed (before persisting). */
    plans?: SeedPlanDraft[];
    /** Bundle drafts to seed (before persisting). */
    bundles?: SeedBundleDraft[];
    /**
     * Approved gate (#20 Slice 5): approved feature/quota keys from the
     * catalog entries (`loadApprovedCatalogKeys`). Omitted/`null` →
     * existence checks only (e.g. first seed, before any catalog entries exist).
     */
    approved?: ApprovedCatalogKeys | null;
}

export interface SeedGateFinding {
    kind: 'plan' | 'bundle';
    /** Human-readable key: `STARTER` or `BANKING`. */
    entityKey: string;
    warning: StrictModeWarning;
}

export interface SeedGateReport {
    /** `'ok'` if no findings; otherwise `'error'`. */
    overall: 'ok' | 'error';
    counts: {
        planFindings: number;
        bundleFindings: number;
        total: number;
    };
    findings: SeedGateFinding[];
}

/**
 * Validates seeded plan/bundle drafts against the DiscoverySnapshot.
 * Collects findings and returns a deterministically sorted report.
 */
export function validateSeedAgainstSnapshot(input: SeedGateInput): SeedGateReport {
    const findings: SeedGateFinding[] = [];

    for (const plan of input.plans ?? []) {
        const warns = validatePlanDraft(
            { features: plan.features, quotas: plan.quotas ?? {} },
            input.snapshot,
            new Set(),
            input.approved ?? null,
        );
        for (const warning of warns) {
            findings.push({ kind: 'plan', entityKey: plan.planKey, warning });
        }
    }

    for (const bundle of input.bundles ?? []) {
        const warns = validateBundleDraft(
            { features: bundle.features, quotas: bundle.quotas ?? {} },
            input.snapshot,
            null,
            new Set(),
            input.approved ?? null,
        );
        for (const warning of warns) {
            findings.push({ kind: 'bundle', entityKey: bundle.bundleKey, warning });
        }
    }

    findings.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        if (a.entityKey !== b.entityKey) return a.entityKey.localeCompare(b.entityKey);
        return a.warning.code.localeCompare(b.warning.code);
    });

    const counts = {
        planFindings: findings.filter((f) => f.kind === 'plan').length,
        bundleFindings: findings.filter((f) => f.kind === 'bundle').length,
        total: findings.length,
    };

    // Advisory findings (#35) do not break the seed — they appear only
    // in the report (the dependency may be covered outside the draft).
    const hasBlockingFinding = findings.some(
        (f) => !ADVISORY_STRICT_MODE_CODES.has(f.warning.code),
    );

    return {
        overall: hasBlockingFinding ? 'error' : 'ok',
        counts,
        findings,
    };
}

/** Formats the report output for CLI/seed stdout. Returns a multi-line string. */
export function formatSeedGateReport(report: SeedGateReport): string {
    const lines: string[] = [];
    lines.push(
        `Seed-Gate (Status: ${report.overall.toUpperCase()})`,
        `  Plans: ${report.counts.planFindings} · Bundles: ${report.counts.bundleFindings} · Gesamt: ${report.counts.total}`,
        '',
    );
    if (report.findings.length === 0) {
        lines.push(
            '  ✓ Alle geseedeten Plan-/Bundle-Features sind discovered (und, sofern geprüft, approved).',
        );
        return lines.join('\n');
    }
    let lastEntity = '';
    for (const f of report.findings) {
        const entityHeader = `${f.kind} ${f.entityKey}`;
        if (entityHeader !== lastEntity) {
            lines.push(`  ✗ ${entityHeader}`);
            lastEntity = entityHeader;
        }
        const fieldHint = f.warning.field ? ` [${f.warning.field}]` : '';
        lines.push(`      ${f.warning.code}${fieldHint}: ${f.warning.message}`);
    }
    return lines.join('\n');
}

/** Exit code for CLI/seed wrapping: 0 on OK, 4 on violations (analogous to Preflight). */
export function seedGateExitCode(report: SeedGateReport): number {
    return report.overall === 'error' ? 4 : 0;
}
