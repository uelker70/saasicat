// DoctorFlow — `<app> doctor`.
//
// Ausführbarer Health-Check-Lauf: lädt eine Liste von `DoctorCheck`-
// Implementierungen und führt sie nacheinander aus. Konsumenten registrieren
// projektspezifische Checks (z. B. Sidecar-Reachability,
// Stammdaten-Vollständigkeit) zusätzlich zu den Plattform-
// Default-Checks.

import { Inject, Injectable } from '@nestjs/common';
import { DOCTOR_CHECKS_TOKEN } from './tokens.js';

export type CheckSeverity = 'ok' | 'warning' | 'error';

export interface DoctorCheck {
    /** Eindeutiger Slug (z. B. "platform.user-port", "demoapp.kosit-sidecar"). */
    readonly id: string;
    /** Anzeigetext im Output. */
    readonly label: string;
    run(): Promise<DoctorCheckResult>;
}

export interface DoctorCheckResult {
    severity: CheckSeverity;
    message: string;
    /** Optional: Detail-Daten für den JSON-Output. */
    details?: Record<string, unknown>;
}

export interface DoctorReport {
    /** Gesamtstatus = max(severity) über alle Checks. */
    overall: CheckSeverity;
    checks: Array<{
        id: string;
        label: string;
        severity: CheckSeverity;
        message: string;
        details?: Record<string, unknown>;
    }>;
}

@Injectable()
export class DoctorFlow {
    constructor(@Inject(DOCTOR_CHECKS_TOKEN) private readonly checks: DoctorCheck[]) {}

    async run(): Promise<DoctorReport> {
        const results: DoctorReport['checks'] = [];
        let overall: CheckSeverity = 'ok';

        for (const check of this.checks) {
            try {
                const r = await check.run();
                results.push({ id: check.id, label: check.label, ...r });
                overall = aggregateSeverity(overall, r.severity);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                results.push({
                    id: check.id,
                    label: check.label,
                    severity: 'error',
                    message: `Check warf eine Exception: ${message}`,
                });
                overall = 'error';
            }
        }

        return { overall, checks: results };
    }

    /** Liefert den passenden CLI-Exit-Code: 0 bei `ok`/`warning`, 4 bei `error`. */
    exitCodeFor(report: DoctorReport): number {
        return report.overall === 'error' ? 4 : 0;
    }

    formatReport(report: DoctorReport): string {
        const lines = [`Doctor-Check (Gesamtstatus: ${report.overall.toUpperCase()})`, ''];
        for (const c of report.checks) {
            const icon = c.severity === 'ok' ? '✓' : c.severity === 'warning' ? '⚠' : '✗';
            lines.push(`  ${icon}  ${c.label}: ${c.message}`);
        }
        return lines.join('\n');
    }
}

function aggregateSeverity(a: CheckSeverity, b: CheckSeverity): CheckSeverity {
    if (a === 'error' || b === 'error') return 'error';
    if (a === 'warning' || b === 'warning') return 'warning';
    return 'ok';
}
