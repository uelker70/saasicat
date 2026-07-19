// Seed-Gate — Pre-Persistence-Validierung geseedeter Plan-/Bundle-Feature-Listen
// gegen den Discovery-Snapshot (#12 Slice 2).
//
// Pendant zu preflight.ts: `runPreflight` prüft die LIVE-DB-Versions NACH dem
// Persistieren; das Seed-Gate prüft die ROHEN Seed-Drafts (aus `saas.yaml` /
// Seed-Skripten) VOR dem ersten DB-Write — damit ein Build/Seed bricht, bevor
// ein nicht-discovertes Feature ("Luftschloss") überhaupt in den Katalog
// gelangt.
//
// Pure Functions, keine NestJS-DI. Nutzt dieselben Leaf-Validatoren wie
// Strict-Mode-Check + Preflight (`validatePlanDraft`/`validateBundleDraft`) —
// keine Logik-Duplikation. Mode-agnostisch: der Caller entscheidet via
// `seedGateExitCode`, ob ein Verstoß den Seed/Build bricht (blocking) oder
// nur gemeldet wird (report-only).

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
    /** Zu seedende Plan-Drafts (vor dem Persistieren). */
    plans?: SeedPlanDraft[];
    /** Zu seedende Bundle-Drafts (vor dem Persistieren). */
    bundles?: SeedBundleDraft[];
    /**
     * Approved-Gate (#20 Slice 5): freigegebene Feature-/Quota-Keys aus den
     * Catalog-Entries (`loadApprovedCatalogKeys`). Weggelassen/`null` →
     * nur Existenz-Checks (z. B. Erst-Seed, bevor es Catalog-Entries gibt).
     */
    approved?: ApprovedCatalogKeys | null;
}

export interface SeedGateFinding {
    kind: 'plan' | 'bundle';
    /** Sprechender Key: `STARTER` oder `BANKING`. */
    entityKey: string;
    warning: StrictModeWarning;
}

export interface SeedGateReport {
    /** `'ok'` wenn keine Findings; sonst `'error'`. */
    overall: 'ok' | 'error';
    counts: {
        planFindings: number;
        bundleFindings: number;
        total: number;
    };
    findings: SeedGateFinding[];
}

/**
 * Validiert geseedete Plan-/Bundle-Drafts gegen den DiscoverySnapshot.
 * Sammelt Findings und liefert einen deterministisch sortierten Report.
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

    // Advisory-Findings (#35) brechen den Seed nicht — sie erscheinen nur
    // im Report (die Abhängigkeit kann außerhalb des Drafts gedeckt sein).
    const hasBlockingFinding = findings.some(
        (f) => !ADVISORY_STRICT_MODE_CODES.has(f.warning.code),
    );

    return {
        overall: hasBlockingFinding ? 'error' : 'ok',
        counts,
        findings,
    };
}

/** Format der Report-Ausgabe für CLI-/Seed-stdout. Liefert mehrzeiligen String. */
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

/** Exit-Code fürs CLI-/Seed-Wrapping: 0 bei OK, 4 bei Verstößen (analog Preflight). */
export function seedGateExitCode(report: SeedGateReport): number {
    return report.overall === 'error' ? 4 : 0;
}
