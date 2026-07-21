// Seed-Gate-Runner (#23) — shared I/O shell around the pure Seed-Gate
// (`validateSeedAgainstSnapshot` in seed-gate.ts), so that the consumer
// seeds (e.g. `prisma/seed-gate.js` or `scripts/seed-plan-versions.mjs`)
// don't duplicate their own mode/loading logic.
//
// Behavior per mode:
//   - 'report-only' (default): missing snapshot → warning + skip;
//     violations → report + warning, the seed keeps running.
//   - 'blocking' (#23 acceptance): missing snapshot OR violations →
//     exit 4 (`seedGateExitCode`). Switch over once the headless scan
//     (`runHeadlessDiscoveryScan`) is verified in the migrate container.

import {
    DiscoverySnapshotNotFoundError,
    loadDiscoverySnapshotFromFile,
} from '../discovery/snapshot-loader.js';
import type { ApprovedCatalogKeys } from '@saasicat/types';
import {
    formatSeedGateReport,
    seedGateExitCode,
    validateSeedAgainstSnapshot,
    type SeedBundleDraft,
    type SeedGateReport,
    type SeedPlanDraft,
} from './seed-gate.js';

export type SeedGateMode = 'report-only' | 'blocking';

export interface SeedGateRunOptions {
    /** Path of the snapshot file persisted by the scanner. */
    snapshotPath: string;
    plans?: SeedPlanDraft[];
    bundles?: SeedBundleDraft[];
    /** Approved gate (#20 Slice 5) — `null`/omitted = existence checks only. */
    approved?: ApprovedCatalogKeys | null;
    /** Default `'report-only'`; consumers map their env variable onto this. */
    mode?: SeedGateMode;
    /** Log sinks — default `console.log`/`console.warn`/`console.error`. */
    log?: (line: string) => void;
    warn?: (line: string) => void;
    error?: (line: string) => void;
    /** Exit function in the blocking case — default `process.exit`. Injectable in tests. */
    exit?: (code: number) => never;
}

/**
 * Loads the snapshot, validates the seed drafts and prints the report.
 * Returns the report — or `null` if the snapshot is missing and the mode
 * is report-only (gate skipped). In blocking mode the function does not
 * return on violations or a missing snapshot (exit 4).
 */
export function runSeedGateFromFile(options: SeedGateRunOptions): SeedGateReport | null {
    const mode = options.mode ?? 'report-only';
    const log = options.log ?? ((line: string) => console.log(line));
    const warn = options.warn ?? ((line: string) => console.warn(line));
    const error = options.error ?? ((line: string) => console.error(line));
    const exit = options.exit ?? ((code: number): never => process.exit(code));

    let snapshot;
    try {
        snapshot = loadDiscoverySnapshotFromFile(options.snapshotPath);
    } catch (err) {
        if (err instanceof DiscoverySnapshotNotFoundError) {
            if (mode === 'blocking') {
                error(
                    `[seed-gate] FEHLER: Kein Discovery-Snapshot unter ${options.snapshotPath} — ` +
                        'im blocking-Modus Pflicht (Headless-Scan vor dem Seed ausführen, #23).',
                );
                return exit(4);
            }
            warn(
                `[seed-gate] Kein Discovery-Snapshot unter ${options.snapshotPath} — übersprungen (report-only).`,
            );
            return null;
        }
        throw err;
    }

    const report = validateSeedAgainstSnapshot({
        snapshot,
        plans: options.plans,
        bundles: options.bundles,
        approved: options.approved ?? null,
    });
    log(formatSeedGateReport(report));
    if (report.overall === 'error') {
        if (mode === 'blocking') {
            error('[seed-gate] blocking: Verstöße gefunden — Seed wird abgebrochen (#23).');
            return exit(seedGateExitCode(report));
        }
        warn('[seed-gate] report-only: Verstöße gefunden, Seed läuft trotzdem weiter.');
    }
    return report;
}
