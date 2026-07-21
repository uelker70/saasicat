import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

import { Inject, Injectable, Optional } from '@nestjs/common';
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';
import { DISCOVERY_SNAPSHOT_PATH_TOKEN, DiscoveryScanner } from '@saasicat/nest';

// Shared `<app> discovery scan` command (#23): builds the discovery
// snapshot headless — i.e. in the migrate container or in CI, BEFORE the seed —
// and persists it to the path configured via
// `DiscoveryModule.forRoot({ snapshotPath })` (additionally to an explicit
// path via `--out`). This gives the Seed-Gate a snapshot at seed time so it
// can switch from report-only to blocking.
//
// No identity/MFA check as in the admin commands: the scan is a
// build/deploy operation without a user context and only reads code annotations.
//
// Staged rollout (#23): first wire it up with `--non-fatal` (a scan error
// does not break the migrate path), then switch to hard failure (Exit 4).

interface ScanFlags {
    out?: string;
    nonFatal?: boolean;
}

@Injectable()
@SubCommand({
    name: 'scan',
    description: 'Discovery-Snapshot headless erzeugen + persistieren (Seed-Gate, #23)',
})
export class DiscoveryScanCommand extends CommandRunner {
    constructor(
        @Optional()
        @Inject(DiscoveryScanner)
        private readonly scanner: DiscoveryScanner | null = null,
        @Optional()
        @Inject(DISCOVERY_SNAPSHOT_PATH_TOKEN)
        private readonly configuredPath: string | null = null,
    ) {
        super();
    }

    async run(_args: string[], flags: ScanFlags): Promise<void> {
        if (!this.scanner) {
            this.fail(
                'DiscoveryScanner nicht registriert — DiscoveryModule.forRoot() im CLI-Modul importieren.',
                flags,
            );
            return;
        }
        try {
            // rebuildSnapshot persists to the configured snapshotPath.
            const snapshot = this.scanner.rebuildSnapshot();
            if (flags.out) {
                const outPath = resolvePath(flags.out);
                mkdirSync(dirname(outPath), { recursive: true });
                writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
            }
            const target = flags.out ?? this.configuredPath;
            process.stdout.write(
                `Discovery-Scan (${snapshot.app.key} v${snapshot.app.version}): ` +
                    `${snapshot.capabilities.length} Capabilities · ` +
                    `${snapshot.features.length} Features · ` +
                    `${snapshot.quotas.length} Quotas · hash ${snapshot.hash.slice(0, 19)}…\n`,
            );
            if (target) {
                process.stdout.write(`Snapshot persistiert: ${resolvePath(target)}\n`);
            } else {
                process.stderr.write(
                    'WARNUNG: Snapshot wurde nicht persistiert — weder snapshotPath ' +
                        '(DiscoveryModule.forRoot) konfiguriert noch --out angegeben. ' +
                        'Das Seed-Gate findet so keinen Snapshot.\n',
                );
            }
        } catch (err) {
            this.fail(err instanceof Error ? err.message : String(err), flags);
        }
    }

    /** Exit 4 (analogous to Seed-Gate/Preflight) — only a warning with `--non-fatal`. */
    private fail(message: string, flags: ScanFlags): void {
        if (flags.nonFatal) {
            process.stderr.write(`[discovery scan] WARN (non-fatal): ${message}\n`);
            return;
        }
        process.stderr.write(`[discovery scan] FEHLER: ${message}\n`);
        process.exit(4);
    }

    @Option({
        flags: '--out <path>',
        description: 'Snapshot zusätzlich an diesen Pfad schreiben',
    })
    parseOut(v: string): string {
        return v;
    }

    @Option({
        flags: '--non-fatal',
        description: 'Scan-Fehler nur als Warnung melden (Exit 0) — gestufter Rollout',
    })
    parseNonFatal(): boolean {
        return true;
    }
}

@Injectable()
@Command({
    name: 'discovery',
    description: 'Discovery-Operations (scan)',
    subCommands: [DiscoveryScanCommand],
})
export class DiscoveryCommands extends CommandRunner {
    async run(): Promise<void> {
        process.stderr.write('Bitte Sub-Command angeben: scan.\n');
        process.exit(2);
    }
}
