// Records, at boot, the configuration the installation is running on.
//
// Three states, and almost every boot is the middle one:
//
//   no record      — first start. Apply and record; there is nothing to
//                    compare against.
//   same fingerprint — nothing happened. Silent, and the record is left alone:
//                    `appliedAt` keeps saying when these values took effect.
//   different      — the configuration changed since the last boot. The new
//                    values apply (they already do — the file is what runs),
//                    the record is replaced, and the difference is written
//                    down where an operator will find it.
//
// What this does NOT do is decide anything. The file is the one place a
// setting lives; this mirrors it. And a failure here does not take the boot
// down: an installation that cannot write its record is still an installation
// running the right configuration, and the log says what could not be written.

import { Inject, Injectable, Logger, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import {
    type AppliedSettingsPort,
    type AppliedSettingsRecord,
    diffSettings,
    type PlanCatalog,
    type SettingsChangeRecord,
    settingsSubtreeOf,
} from '@saasicat/core';

import { PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { fingerprintOf } from './settings-fingerprint.js';
import { APPLIED_SETTINGS_PORT_TOKEN, SETTINGS_SOURCE_TOKEN } from './settings.tokens.js';

/** What one boot did about the record. */
export type BootOutcome =
    | { kind: 'not-recorded' }
    | { kind: 'first-record'; record: AppliedSettingsRecord }
    | { kind: 'unchanged'; record: AppliedSettingsRecord }
    | { kind: 'changed'; record: AppliedSettingsRecord; change: SettingsChangeRecord };

@Injectable()
export class AppliedSettingsRecorder implements OnApplicationBootstrap {
    private readonly logger = new Logger(AppliedSettingsRecorder.name);

    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
        @Inject(SETTINGS_SOURCE_TOKEN) private readonly source: string,
        @Optional()
        @Inject(APPLIED_SETTINGS_PORT_TOKEN)
        private readonly port: AppliedSettingsPort | null = null,
    ) {}

    /** Whether this installation keeps a record at all. */
    get recording(): boolean {
        return this.port !== null;
    }

    async onApplicationBootstrap(): Promise<void> {
        if (!this.port) {
            // Once, at boot, and only here: a capability that vanishes without
            // a word is indistinguishable from a bug in the integrator's code.
            this.logger.warn(
                'The applied settings are not recorded: the persistence adapter provides no ' +
                    '`core.appliedSettings` port, so the platform cannot say when its ' +
                    'configuration was applied or notice that it changed.',
            );
            return;
        }
        try {
            const outcome = await this.record(this.port, new Date());
            this.report(outcome);
        } catch (error) {
            this.logger.error(
                'The applied settings could not be recorded — the configuration in ' +
                    `${this.source} is running, but the record of it is stale.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    /** Compares the running settings with the record and writes what follows. */
    async record(port: AppliedSettingsPort, now: Date): Promise<BootOutcome> {
        const settings = settingsSubtreeOf(this.catalog);
        const fingerprint = fingerprintOf(settings);
        const previous = await port.readApplied();

        if (previous?.fingerprint === fingerprint) {
            return { kind: 'unchanged', record: previous };
        }
        const record: AppliedSettingsRecord = {
            fingerprint,
            settings,
            source: this.source,
            appliedAt: now,
        };
        if (!previous) {
            await port.writeApplied(record);
            return { kind: 'first-record', record };
        }

        // The change first, then the record it supersedes. The two writes are
        // not one transaction, so either can be the last thing that happens —
        // and the order decides which failure is left behind. A change written
        // and a record not replaced means the next start notices again and
        // writes a second, duplicate change: visible, and dismissible. A record
        // replaced and a change not written means the next start finds the
        // fingerprints agree and says nothing, ever — the one event this exists
        // for, lost.
        const change = await port.recordChange({
            noticedAt: now,
            source: this.source,
            previous: previous.settings,
            current: settings,
        });
        await port.writeApplied(record);
        return { kind: 'changed', record, change };
    }

    private report(outcome: BootOutcome): void {
        switch (outcome.kind) {
            case 'first-record':
                this.logger.log(
                    `Applied settings recorded for the first time, from ${this.source}.`,
                );
                return;
            case 'changed': {
                const lines = diffSettings(outcome.change.previous, outcome.change.current).map(
                    (d) => `${d.path}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`,
                );
                this.logger.warn(
                    `The settings changed since the last start (${this.source}):\n  ` +
                        lines.join('\n  '),
                );
                return;
            }
            default:
                // Unchanged: what almost every boot is, and worth no line.
                return;
        }
    }
}
