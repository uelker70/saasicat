// DoctorFlow — `<app> doctor`.
//
// Executable health-check run: loads a list of `DoctorCheck`
// implementations and runs them one after another. Consumers register
// project-specific checks (e.g. sidecar reachability,
// master-data completeness) in addition to the platform
// default checks.

import { Inject, Injectable } from '@nestjs/common';
import { DOCTOR_CHECKS_TOKEN } from './tokens.js';

export type CheckSeverity = 'ok' | 'warning' | 'error';

export interface DoctorCheck {
    /** Unique slug (e.g. "platform.user-port", "demoapp.kosit-sidecar"). */
    readonly id: string;
    /** Display text in the output. */
    readonly label: string;
    run(): Promise<DoctorCheckResult>;
}

export interface DoctorCheckResult {
    severity: CheckSeverity;
    message: string;
    /** Optional: detail data for the JSON output. */
    details?: Record<string, unknown>;
}

export interface DoctorReport {
    /** Overall status = max(severity) across all checks. */
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
                    message: `Check threw an exception: ${message}`,
                });
                overall = 'error';
            }
        }

        return { overall, checks: results };
    }

    /** Returns the appropriate CLI exit code: 0 for `ok`/`warning`, 4 for `error`. */
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
