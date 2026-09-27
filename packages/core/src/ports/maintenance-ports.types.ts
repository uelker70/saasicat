// The ports behind maintenance windows: where the windows are kept, and how the
// application hears of one to tell its users.

import type {
    MaintenanceWindowChanges,
    MaintenanceWindowEvent,
    MaintenanceWindowRecord,
    MaintenanceWindowStage,
    NewMaintenanceWindow,
} from '../maintenance-window.types.js';

/**
 * Keeps the maintenance windows, in the application's own database.
 *
 * Every running version of the application reads this table while the lock
 * holds — the one being replaced as well as the one replacing it — so its shape
 * is part of the contract between two releases: it gains columns, and never in
 * a deploy the lock protects.
 *
 * An adapter translates. It does not decide whether a window may be locked or
 * moved; it makes each write conditional on what the caller read, so that two
 * operators acting at once cannot both succeed.
 */
export interface MaintenanceWindowPort {
    /** The open window — announced or locked, not yet over — or null. There is at most one. */
    findOpen(): Promise<MaintenanceWindowRecord | null>;
    /** The most recently recorded windows first, open or over; at most `limit` of them. */
    listRecent(limit: number): Promise<MaintenanceWindowRecord[]>;
    /**
     * Records a new open window and returns it as stored — the id is the
     * adapter's to assign. Returns null where a window is already open: the
     * database holds an installation to one, so of two concurrent calls exactly
     * one lands.
     */
    open(window: NewMaintenanceWindow): Promise<MaintenanceWindowRecord | null>;
    /**
     * Applies `changes` to window `id`, provided it is still open and at
     * `stage`. Returns the window as stored, or null where it is not: it ended,
     * it was locked in the meantime, or no window has that id.
     */
    update(
        id: string,
        stage: MaintenanceWindowStage,
        changes: MaintenanceWindowChanges,
    ): Promise<MaintenanceWindowRecord | null>;
}

/**
 * Hears when a window is announced, moved or cancelled, so the application can
 * write to its users. Optional: without it tenants learn of a window from the
 * banner alone.
 *
 * Called after the change is recorded, and never waited on by the operator: a
 * notification that fails is logged, and the window stands as recorded.
 */
export interface MaintenanceNotificationPort {
    windowChanged(event: MaintenanceWindowEvent): Promise<void>;
}
