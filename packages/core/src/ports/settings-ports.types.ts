// The port behind the record of the applied configuration.

import type {
    AppliedSettingsRecord,
    NewSettingsChange,
    SettingsChangeRecord,
} from '../applied-settings.types.js';

/** Which changes to list. */
export interface SettingsChangeFilter {
    /** Only changes an operator has, or has not, acknowledged. Omitted: both. */
    acknowledged?: boolean;
    /** Newest first. Omitted: every matching change. */
    limit?: number;
}

/**
 * Stores what the installation applied and what changed between two boots.
 *
 * `applied_settings` holds one row for the installation; `settings_changes`
 * holds one row per boot that found the fingerprint moved. An adapter
 * translates: it does not decide what a change is, and it does not read the
 * row back into anything that runs.
 */
export interface AppliedSettingsPort {
    /** The record, or null before the first boot that could write one. */
    readApplied(): Promise<AppliedSettingsRecord | null>;
    /** Replaces the installation's record — there is only ever the one row. */
    writeApplied(record: AppliedSettingsRecord): Promise<void>;
    /** Appends a change a boot noticed; the id is the adapter's to assign. */
    recordChange(change: NewSettingsChange): Promise<SettingsChangeRecord>;
    /** Changes, newest first. */
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
