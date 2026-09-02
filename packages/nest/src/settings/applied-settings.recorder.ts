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
import { SettingsChangeNotifier } from './settings-change-notifier.js';
import { fingerprintOf } from './settings-fingerprint.js';
import { APPLIED_SETTINGS_PORT_TOKEN, SETTINGS_SOURCE_TOKEN } from './settings.tokens.js';

/** How long a boot waits for the mail to be handed over before it goes on. */
const MAIL_BOOT_BUDGET_MS = 2_000;

/** Resolves after `ms`; the timer is unreferenced, so it holds nothing open. */
function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

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
        // Last, and optional, so that `new AppliedSettingsRecorder(catalog,
        // source, port)` — the shape this class was published with — still
        // records. Without a notifier nobody is mailed; the record is kept.
        @Optional()
        @Inject(SettingsChangeNotifier)
        private readonly notifier: SettingsChangeNotifier | null = null,
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
        this.notifier?.reportModeAtBoot();
        try {
            const outcome = await this.record(this.port, new Date());
            this.report(outcome);
            if (outcome.kind === 'changed' && this.notifier) {
                await this.tellSomebody(this.notifier, outcome.change);
            }
        } catch (error) {
            this.logger.error(
                'The applied settings could not be recorded — the configuration in ' +
                    `${this.source} is running, but the record of it is stale.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    /**
     * Mails the change without holding the boot for it.
     *
     * Nest resolves `app.listen()` only once every bootstrap hook has settled,
     * and an SMTP host that does not answer would otherwise turn a changed
     * setting into an installation that does not start. So the boot waits a
     * moment — long enough for a working adapter to hand the mail over, so
     * the log reads in order — and then goes on; a slow adapter finishes on
     * its own, and `notify()` bounds each send and logs what timed out.
     */
    private async tellSomebody(
        notifier: SettingsChangeNotifier,
        change: SettingsChangeRecord,
    ): Promise<void> {
        await Promise.race([notifier.notify(change), pause(MAIL_BOOT_BUDGET_MS)]);
    }

    /** Compares the running settings with the record and writes what follows. */
    async record(port: AppliedSettingsPort, now: Date): Promise<BootOutcome> {
        const settings = settingsSubtreeOf(this.catalog);
        const fingerprint = fingerprintOf(settings);
        const previous = await port.readApplied();

        if (previous?.fingerprint === fingerprint) {
            // The fingerprint covers the values, not where they came from. A
            // file moved with its content intact — a Dockerfile that relocates
            // `config/saas.yaml` — is not a change to report, but the record
            // must not keep naming a path that no longer exists.
            if (previous.source !== this.source) {
                const relocated = { ...previous, source: this.source };
                await port.writeApplied(relocated);
                return { kind: 'unchanged', record: relocated };
            }
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
