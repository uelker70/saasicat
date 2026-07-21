// Discovery snapshot loader — a pure helper that reads a JSON file written
// by the DiscoveryScanner and returns it as a typed `DiscoverySnapshot`.
// Used by CI gates and Preflight CLIs that do not want to boot the full
// AppModule stack.

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
 * Reads a snapshot JSON file persisted by the DiscoveryScanner and returns
 * it as a `DiscoverySnapshot`. Throws `DiscoverySnapshotNotFoundError`
 * when the file is missing — that is a hard boot condition for CI gates
 * (a Preflight without a current snapshot would be worthless).
 */
export function loadDiscoverySnapshotFromFile(path: string): DiscoverySnapshot {
    const absolute = resolvePath(path);
    if (!existsSync(absolute)) {
        throw new DiscoverySnapshotNotFoundError(absolute);
    }
    const raw = readFileSync(absolute, 'utf-8');
    return JSON.parse(raw) as DiscoverySnapshot;
}
