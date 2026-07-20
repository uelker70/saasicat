// ManifestCliFlow — `<app> manifest dump|validate|hash|diff|check`.
//
// Lese-only. Konsument liefert `ManifestAccessPort`-Implementation; Plattform
// orchestriert die 5 Subcommands. `check` führt eine Liste von
// `ManifestCheck`-Implementierungen aus (10 Plattform-Defaults aus
// `DEFAULT_MANIFEST_CHECKS` plus konsumenten-spezifische Erweiterungen).

import { Inject, Injectable } from '@nestjs/common';
import type { AdminManifest, ManifestAccessPort } from '@saasicat/types';
import { type ManifestCheck, type ManifestCheckResult } from './manifest-checks.js';
import { MANIFEST_ACCESS_PORT_TOKEN, MANIFEST_CHECKS_TOKEN } from './tokens.js';

export interface ManifestCheckReport {
    overall: 'ok' | 'warning' | 'error';
    checks: Array<{
        id: string;
        label: string;
        severity: 'ok' | 'warning' | 'error';
        message: string;
        paths?: string[];
    }>;
}

@Injectable()
export class ManifestCliFlow {
    constructor(
        @Inject(MANIFEST_ACCESS_PORT_TOKEN) private readonly access: ManifestAccessPort,
        @Inject(MANIFEST_CHECKS_TOKEN) private readonly checks: ManifestCheck[],
    ) {}

    /** `<app> manifest dump` — JSON-Ausgabe des aktuellen Manifests. */
    dump(): AdminManifest {
        return this.access.getManifest();
    }

    /**
     * `<app> manifest hash` — kanonischer manifestHash-Wert. Liefert
     * den Wert aus `build.manifestHash`. Konsumenten können das CI-seitig
     * pinnen (`expected-hash.txt`) und auf Drift prüfen.
     */
    hash(): string {
        const m = this.access.getManifest();
        const h = m.build?.manifestHash;
        if (!h) throw new Error('manifestHash fehlt im Manifest — Boot-Zeit-Bug?');
        return h;
    }

    /**
     * `<app> manifest validate` — gibt `true` zurück, wenn alle Strukturen
     * vorhanden sind. Tiefere Schema-Validation läuft separat über Ajv mit
     * `@saasicat/spec/schemas/admin-manifest.schema.json`;
     * dieser Helper liefert die Schnell-Diagnose ohne Ajv-Last.
     */
    validate(): { ok: boolean; reason?: string } {
        const m = this.access.getManifest();
        if (m.schemaVersion !== 1) {
            return { ok: false, reason: `Unerwartete schemaVersion ${m.schemaVersion}` };
        }
        if (!m.project?.key) {
            return { ok: false, reason: 'Kein `project.key` im Manifest' };
        }
        if (!m.build?.manifestHash) {
            return { ok: false, reason: 'manifestHash fehlt' };
        }
        return { ok: true };
    }

    /**
     * `<app> manifest diff <expected.json>` — flacher Diff über die zwei
     * Manifest-Hashes plus Listen-Differenzen für Top-Level-Felder. Liefert
     * `null`, wenn die Manifeste identisch sind.
     */
    diff(expected: AdminManifest): ManifestDiff | null {
        const current = this.access.getManifest();
        if (current.build?.manifestHash === expected.build?.manifestHash) return null;
        const currentKeys = collectComponentKeys(current);
        const expectedKeys = collectComponentKeys(expected);
        return {
            currentHash: current.build?.manifestHash ?? null,
            expectedHash: expected.build?.manifestHash ?? null,
            componentKeysAdded: [...currentKeys].filter((k) => !expectedKeys.has(k)).sort(),
            componentKeysRemoved: [...expectedKeys].filter((k) => !currentKeys.has(k)).sort(),
        };
    }

    /**
     * `<app> manifest check` — führt alle registrierten Manifest-Checks
     * durch. Aggregiert Severity (ok/warning/error) zu `overall`. Konsument
     * mappt `error` auf Exit-Code 7 (Drift) gemäß `cli-conventions.md` §6.
     */
    async runChecks(): Promise<ManifestCheckReport> {
        const manifest = this.access.getManifest();
        const checks: ManifestCheckReport['checks'] = [];
        let overall: ManifestCheckResult['severity'] = 'ok';
        for (const check of this.checks) {
            try {
                const r = check.run(manifest);
                checks.push({ id: check.id, label: check.label, ...r });
                overall = aggregate(overall, r.severity);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                checks.push({
                    id: check.id,
                    label: check.label,
                    severity: 'error',
                    message: `Check warf eine Exception: ${message}`,
                });
                overall = 'error';
            }
        }
        return { overall, checks };
    }

    /** Liefert den passenden CLI-Exit-Code: 0 bei `ok`/`warning`, 7 bei `error` (Drift). */
    exitCodeFor(report: ManifestCheckReport): number {
        return report.overall === 'error' ? 7 : 0;
    }

    formatReport(report: ManifestCheckReport): string {
        const lines = [`Manifest-Check (Gesamtstatus: ${report.overall.toUpperCase()})`, ''];
        for (const c of report.checks) {
            const icon = c.severity === 'ok' ? '✓' : c.severity === 'warning' ? '⚠' : '✗';
            lines.push(`  ${icon}  ${c.label}: ${c.message}`);
            if (c.paths && c.paths.length > 0) {
                for (const p of c.paths) lines.push(`         · ${p}`);
            }
        }
        return lines.join('\n');
    }
}

export interface ManifestDiff {
    currentHash: string | null;
    expectedHash: string | null;
    componentKeysAdded: string[];
    componentKeysRemoved: string[];
}

function aggregate(
    a: ManifestCheckResult['severity'],
    b: ManifestCheckResult['severity'],
): ManifestCheckResult['severity'] {
    if (a === 'error' || b === 'error') return 'error';
    if (a === 'warning' || b === 'warning') return 'warning';
    return 'ok';
}

function collectComponentKeys(m: AdminManifest): Set<string> {
    const keys = new Set<string>();
    for (const p of m.navigation?.projectPages ?? []) keys.add(p.componentKey);
    return keys;
}
