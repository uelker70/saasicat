// Discovery snapshot loader — a pure helper that reads a JSON file written
// by the DiscoveryScanner and returns it as a typed `DiscoverySnapshot`.
// Used by CI gates and Preflight CLIs that do not want to boot the full
// AppModule stack.

import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import type { DiscoverySnapshot } from './discovery.types.js';

export class DiscoverySnapshotNotFoundError extends Error {
    constructor(public readonly path: string) {
        super(
            `Discovery snapshot file not found: ${path}. ` +
                `Boot the app first with DISCOVERY_SNAPSHOT_PATH or ` +
                `DiscoveryModule.forRoot({ snapshotPath: '…' }) so that the ` +
                `scanner writes the file on the OnApplicationBootstrap hook.`,
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
