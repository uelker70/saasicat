// Seed-Gate-Runner (#23) — geteilte I/O-Schale um das pure Seed-Gate
// (`validateSeedAgainstSnapshot` in seed-gate.ts), damit die Konsumenten-
// Seeds (autohauspro `prisma/seed-gate.js`, vereinsfux
// `scripts/seed-plan-versions.mjs`) keine eigene Modus-/Lade-Logik
// duplizieren.
//
// Verhalten je Modus:
//   - 'report-only' (Default): fehlender Snapshot → Warnung + skip;
//     Verstöße → Report + Warnung, der Seed läuft weiter.
//   - 'blocking' (#23-Akzeptanz): fehlender Snapshot ODER Verstöße →
//     Exit 4 (`seedGateExitCode`). Umstellen, sobald der Headless-Scan
//     (`runHeadlessDiscoveryScan`) im Migrate-Container verifiziert ist.

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
    /** Pfad der vom Scanner persistierten Snapshot-Datei. */
    snapshotPath: string;
    plans?: SeedPlanDraft[];
    bundles?: SeedBundleDraft[];
    /** Approved-Gate (#20 Slice 5) — `null`/weggelassen = nur Existenz-Checks. */
    approved?: ApprovedCatalogKeys | null;
    /** Default `'report-only'`; Konsumenten mappen ihre Env-Variable hierauf. */
    mode?: SeedGateMode;
    /** Log-Senken — Default `console.log`/`console.warn`/`console.error`. */
    log?: (line: string) => void;
    warn?: (line: string) => void;
    error?: (line: string) => void;
    /** Exit-Funktion im blocking-Fall — Default `process.exit`. In Tests injizierbar. */
    exit?: (code: number) => never;
}

/**
 * Lädt den Snapshot, validiert die Seed-Drafts und druckt den Report.
 * Liefert den Report — bzw. `null`, wenn der Snapshot fehlt und der Modus
 * report-only ist (Gate übersprungen). Im blocking-Modus kehrt die Funktion
 * bei Verstößen oder fehlendem Snapshot nicht zurück (Exit 4).
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
