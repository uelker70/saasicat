// Headless Discovery-Scan (#23) — geteilter Runner für die Konsumenten-
// Scan-Entrypoints (Migrate-Container/CI, vor dem Seed).
//
// Bootet einen Nest-ApplicationContext OHNE HTTP-Listener: dabei laufen die
// Bootstrap-Hooks — der DiscoveryScanner schreibt den Snapshot an den via
// `DiscoveryModule.forRoot({ snapshotPath })` konfigurierten Pfad und der
// Catalog-Auto-Sync (idempotent) spiegelt ihn in die Catalog-Entries.
//
// WICHTIG: Konsumenten übergeben ihren **vollen AppModule** — nur er enthält
// alle @ImplementsCapability-/@DefinesQuota-Annotationen. Ein Teil-Modul-Scan
// würde fehlende Features fälschlich als obsolete syncen.
//
// Konsumenten-Entry (z. B. `src/discovery-scan.main.ts`) bleibt ein Shim:
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
    /** Log-Level des Boot-Kontexts. Default `['error', 'warn', 'log']`. */
    logger?: LogLevel[] | false;
    /**
     * Exit-Funktion bei Fehlern — Default `process.exit(4)` (analog
     * Seed-Gate/Preflight). In Tests injizierbar.
     */
    exit?: (code: number) => never;
}

/**
 * Führt den Headless-Scan aus und liefert den Snapshot. Bei Boot-/Scan-
 * Fehlern wird der Fehler geloggt und der Prozess mit Exit 4 beendet —
 * den gestuften Rollout (non-fatal) steuert der Migrate-Pfad des
 * Konsumenten (`… || echo WARN`), nicht dieser Runner.
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
 * Zweistufige Auflösung (#25-Falle): Konsumenten importieren das
 * DiscoveryModule üblicherweise über den `/discovery`-Subpath-Entry — die
 * `DiscoveryScanner`-Klasse dieses Root-Entries ist dann ein anderes
 * Objekt und als DI-Token unbrauchbar. `DISCOVERY_SNAPSHOT_TOKEN` ist via
 * `Symbol.for` bundle-übergreifend stabil und greift zuerst; die Klasse
 * bleibt als Same-Bundle-Fallback.
 */
function resolveSnapshotFromContext(app: INestApplicationContext): DiscoverySnapshot {
    try {
        return app.get<DiscoverySnapshot>(DISCOVERY_SNAPSHOT_TOKEN, { strict: false });
    } catch {
        return app.get(DiscoveryScanner, { strict: false }).getSnapshot();
    }
}
