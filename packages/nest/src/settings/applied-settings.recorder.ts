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
// Several replicas of one installation start together after one edit, and
// each of them compares the same record with the same values. Every write to
// the record is guarded on the fingerprint that was read, so exactly one start
// replaces it — that one records the change and tells people; the others read
// again, find the record already saying what they run, and say nothing.
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

/**
 * How often one start reads the record again after a write found it moved.
 * Losing takes a concurrent start running a *different* file — a replica of
 * the same file finds its own fingerprint on the next read and stops — so a
 * start that keeps losing is not racing replicas, it is talking to an adapter
 * whose guarded write never says yes. That is reported, not retried for ever.
 */
const RECORD_ATTEMPTS = 5;

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
            const outcome = await this.record(this.port, () => new Date());
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

    /**
     * Compares the running settings with the record and writes what follows.
     *
     * `clock` is read once per attempt, after the record has been read and
     * right before it is written, so the moment a row carries is the moment
     * of the write that produced it. Read once when the start began, it would
     * date a write by its start — and a start whose write landed after
     * another's could carry the earlier moment, listing the changes in an
     * order the record never went through.
     */
    async record(port: AppliedSettingsPort, clock: () => Date): Promise<BootOutcome> {
        const settings = settingsSubtreeOf(this.catalog);
        const fingerprint = fingerprintOf(settings);
        for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt++) {
            const previous = await port.readApplied();
            const running: AppliedSettingsRecord = {
                fingerprint,
                settings,
                source: this.source,
                appliedAt: clock(),
            };
            const outcome = await this.reconcile(port, previous, running);
            if (outcome) return outcome;
            // The record moved between the read and the write: another start
            // got there first. Read again — a replica of the same file now
            // finds its own fingerprint and has nothing to add; one running a
            // different file has a change of its own to record.
        }
        throw new Error(
            `The applied settings record moved ${RECORD_ATTEMPTS} times while this start was ` +
                'writing it. Either concurrent starts are running different configuration files, ' +
                'or the persistence adapter never confirms the guarded write: `writeApplied` must ' +
                'answer true, and `recordChange` the change, while the record still carries the ' +
                'fingerprint that was read.',
        );
    }

    /**
     * What one read of the record calls for, written. `null` means the write
     * found the record moved since `previous` was read, and wrote nothing.
     */
    private async reconcile(
        port: AppliedSettingsPort,
        previous: AppliedSettingsRecord | null,
        running: AppliedSettingsRecord,
    ): Promise<BootOutcome | null> {
        if (previous?.fingerprint === running.fingerprint) {
            if (previous.source === running.source) return { kind: 'unchanged', record: previous };
            // The fingerprint covers the values, not where they came from. A
            // file moved with its content intact — a Dockerfile that relocates
            // `config/saas.yaml` — is not a change to report, but the record
            // must not keep naming a path that no longer exists.
            const relocated = { ...previous, source: running.source };
            const written = await port.writeApplied(relocated, previous.fingerprint);
            return written ? { kind: 'unchanged', record: relocated } : null;
        }
        if (!previous) {
            const written = await port.writeApplied(running, null);
            return written ? { kind: 'first-record', record: running } : null;
        }
        // The change and the record it supersedes land together or not at all;
        // that is the port's promise, and what makes a failure here safe: the
        // old record stays, and the next start notices again.
        const change = await port.recordChange(
            {
                noticedAt: running.appliedAt,
                source: running.source,
                previous: previous.settings,
                current: running.settings,
            },
            running,
            previous.fingerprint,
        );
        return change ? { kind: 'changed', record: running, change } : null;
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
