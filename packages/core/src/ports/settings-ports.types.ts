// The port behind the record of the applied configuration.

import type {
    AppliedSettingsRecord,
    NewSettingsChange,
    SettingsChangeRecord,
} from '../applied-settings.types.js';
import type { ArchivedTermsVersion, TermsVersionToArchive } from '../terms.types.js';

/** Which changes to list. */
export interface SettingsChangeFilter {
    /** Only changes an operator has, or has not, acknowledged. Omitted: both. */
    acknowledged?: boolean;
    /** The most recently recorded ones. Omitted: every matching change. */
    limit?: number;
}

/**
 * Stores what the installation applied and what changed between two boots.
 *
 * `applied_settings` holds one row for the installation; `settings_changes`
 * holds one row per boot that found the fingerprint moved. An adapter
 * translates: it does not decide what a change is, and it does not read the
 * row back into anything that runs.
 *
 * Both writes are guarded on the fingerprint the caller read. Several replicas
 * of one installation start together after one edit of the file, each reads
 * the same record and each finds the same difference; the guard is what makes
 * one of them the boot that recorded it and the others boots that found it
 * recorded. Without it every replica would write the change and mail the
 * addresses, once per replica.
 */
export interface AppliedSettingsPort {
    /** The record, or null before the first boot that could write one. */
    readApplied(): Promise<AppliedSettingsRecord | null>;
    /**
     * Replaces the installation's record — there is only ever the one row —
     * provided the stored record still carries `expectedFingerprint`: the
     * fingerprint the caller read, or `null` where it read no record. Returns
     * whether it did. `false` means the record moved between the caller's read
     * and this write, and nothing was written: another boot got there first.
     */
    writeApplied(
        record: AppliedSettingsRecord,
        expectedFingerprint: string | null,
    ): Promise<boolean>;
    /**
     * Appends a change a boot noticed and replaces the record it supersedes, in
     * one step: both land, or neither does. Guarded like `writeApplied`, on the
     * fingerprint of the record the change was noticed against. Returns the
     * change as stored — the id is the adapter's to assign — or `null` where
     * the record had already moved on: another boot noticed first, and the
     * change is that boot's to report.
     */
    recordChange(
        change: NewSettingsChange,
        record: AppliedSettingsRecord,
        expectedFingerprint: string,
    ): Promise<SettingsChangeRecord | null>;
    /**
     * Changes, the most recently recorded first: the order the record went
     * through them, which the database numbers at each write — not the order
     * of the moments they carry, which are the recording starts' clocks.
     */
    listChanges(filter?: SettingsChangeFilter): Promise<SettingsChangeRecord[]>;
    /**
     * Marks a change as seen. Returns the updated record, or null where no
     * change has that id. A change already acknowledged keeps its first
     * acknowledgement — repeating the action changes nothing.
     */
    acknowledgeChange(
        id: string,
        acknowledgedBy: string,
        acknowledgedAt: Date,
    ): Promise<SettingsChangeRecord | null>;
}

/**
 * Where the versions of the terms are kept, unalterably: a contract names the
 * version it was concluded under, and the subscriber is owed that file for as
 * long as the contract is kept. The shipped adapters keep it in the database
 * (`TermsVersion`, which refuses every update and delete).
 */
export interface TermsArchivePort {
    /**
     * Stores the version. Storing it again with the same checksum is the same
     * write and changes nothing; another checksum for a version already
     * archived is refused with `TERMS_VERSION_CHANGED`, and the first stays.
     */
    store(terms: TermsVersionToArchive): Promise<void>;
    /** The version as it was archived, or `null` where it was not. */
    read(version: string): Promise<ArchivedTermsVersion | null>;
    /**
     * Why the archive would let a version it keeps be changed or removed, or
     * `null` where it would not. Asked at the start, which is refused while it
     * names a reason.
     */
    protectionProblem(): Promise<string | null>;
}
