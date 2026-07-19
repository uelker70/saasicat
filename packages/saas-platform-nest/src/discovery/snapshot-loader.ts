// Discovery-Snapshot-Loader — pure Helper, der eine vom DiscoveryScanner
// beschriebene JSON-Datei einliest und als typed `DiscoverySnapshot`
// zurückliefert. Wird von CI-Gates und Preflight-CLIs benutzt, die nicht
// den vollen App-Module-Stack booten wollen.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §3.2

import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type { DiscoverySnapshot } from './types.js';

export class DiscoverySnapshotNotFoundError extends Error {
    constructor(public readonly path: string) {
        super(
            `Discovery-Snapshot-Datei nicht gefunden: ${path}. ` +
                `Booten Sie zuerst die App mit DISCOVERY_SNAPSHOT_PATH oder ` +
                `DiscoveryModule.forRoot({ snapshotPath: '…' }), damit der ` +
                `Scanner die Datei beim OnApplicationBootstrap-Hook schreibt.`,
        );
        this.name = 'DiscoverySnapshotNotFoundError';
    }
}

/**
 * Liest eine vom DiscoveryScanner persistierte Snapshot-JSON-Datei und
 * liefert sie als `DiscoverySnapshot`. Wirft `DiscoverySnapshotNotFoundError`,
 * wenn die Datei fehlt — das ist eine harte Boot-Bedingung für CI-Gates
 * (Preflight ohne aktuellen Snapshot wäre wertlos).
 */
export function loadDiscoverySnapshotFromFile(path: string): DiscoverySnapshot {
    const absolute = resolvePath(path);
    if (!existsSync(absolute)) {
        throw new DiscoverySnapshotNotFoundError(absolute);
    }
    const raw = readFileSync(absolute, 'utf-8');
    return JSON.parse(raw) as DiscoverySnapshot;
}
