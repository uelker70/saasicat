// Headless discovery scan (#23) — shared runner for the consumer
// scan entrypoints (migrate container/CI, before the seed).
//
// Boots a Nest ApplicationContext WITHOUT an HTTP listener: this runs the
// bootstrap hooks — the DiscoveryScanner writes the snapshot to the path
// configured via `DiscoveryModule.forRoot({ snapshotPath })` and the
// catalog auto-sync (idempotent) mirrors it into the catalog entries.
//
// IMPORTANT: consumers pass their **full AppModule** — only it contains
// all @ImplementsCapability/@DefinesQuota annotations. A partial-module scan
// would wrongly sync missing features as obsolete.
//
// Consumer entry (e.g. `src/discovery-scan.main.ts`) stays a shim:
//
//   import { runHeadlessDiscoveryScan } from '@saasicat/nest';
//   import { AppModule } from './app.module';
//   void runHeadlessDiscoveryScan(AppModule);

import type { INestApplicationContext, LogLevel, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { DiscoveryScanner } from './discovery.scanner.js';
import { DISCOVERY_SNAPSHOT_TOKEN } from './tokens.js';
import type { DiscoverySnapshot } from './types.js';

export interface HeadlessScanOptions {
    /** Log level of the boot context. Default `['error', 'warn', 'log']`. */
    logger?: LogLevel[] | false;
    /**
     * Exit function on errors — default `process.exit(4)` (analogous to
     * Seed-Gate/Preflight). Injectable in tests.
     */
    exit?: (code: number) => never;
}

/**
 * Runs the headless scan and returns the snapshot. On boot/scan
 * errors the error is logged and the process exits with code 4 —
 * the staged rollout (non-fatal) is controlled by the consumer's
 * migrate path (`… || echo WARN`), not by this runner.
 */
export async function runHeadlessDiscoveryScan(
    appModule: Type,
    options: HeadlessScanOptions = {},
): Promise<DiscoverySnapshot> {
    const exit = options.exit ?? ((code: number): never => process.exit(code));
    try {
        const app = await NestFactory.createApplicationContext(appModule, {
            logger: options.logger ?? ['error', 'warn', 'log'],
        });
        try {
            return resolveSnapshotFromContext(app);
        } finally {
            await app.close();
        }
    } catch (err) {
        console.error('[discovery-scan] FEHLER:', err instanceof Error ? err.message : err);
        return exit(4);
    }
}

/**
 * Two-stage resolution (#25 trap): consumers usually import the
 * DiscoveryModule via the `/discovery` subpath entry — the
 * `DiscoveryScanner` class of this root entry is then a different
 * object and unusable as a DI token. `DISCOVERY_SNAPSHOT_TOKEN` is
 * stable across bundles via `Symbol.for` and takes precedence; the class
 * remains as a same-bundle fallback.
 */
function resolveSnapshotFromContext(app: INestApplicationContext): DiscoverySnapshot {
    try {
        return app.get<DiscoverySnapshot>(DISCOVERY_SNAPSHOT_TOKEN, { strict: false });
    } catch {
        return app.get(DiscoveryScanner, { strict: false }).getSnapshot();
    }
}
