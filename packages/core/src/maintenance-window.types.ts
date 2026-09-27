// A maintenance window: announced to the tenants ahead of time, locked while a
// deploy runs a migration that must not race with requests, and ended when the
// operator says so.
//
// One record per window, open until it ends. Announcing creates it; locking
// marks it locked; unlocking — or cancelling one that never locked — ends it.
// A window can also be locked at once, without having been announced: an
// emergency deploy has nobody to tell in advance.
//
// The announced times are what tenants are told. They never start or end the
// lock: a migration that runs past its announced end must not let tenants back
// onto a half-migrated schema, and a pipeline that starts late must not lock
// them out for nothing.

/** One window, as a store reads it back. */
export interface MaintenanceWindowRecord {
    id: string;
    /** The announced start; null for a window locked without being announced first. */
    startsAt: Date | null;
    /** The announced, expected end; null where nobody said. */
    endsAt: Date | null;
    /** The operator's words to the tenants, shown as written; null for none. */
    message: string | null;
    /** When the window was recorded — announced, or locked at once. */
    createdAt: Date;
    /** Who recorded it, as the audit log tags an actor. */
    createdBy: string;
    /** When the lock began; null while the window is only announced. */
    lockedAt: Date | null;
    lockedBy: string | null;
    /** When the window was over — unlocked, or cancelled before it locked. */
    endedAt: Date | null;
    endedBy: string | null;
}

/** A window to record: it is open, so it has not ended. */
export type NewMaintenanceWindow = Omit<MaintenanceWindowRecord, 'id' | 'endedAt' | 'endedBy'>;

/**
 * Where an open window stands. A write names the stage it expects, so that it
 * cannot move a window that moved on in the meantime — one that another
 * operator locked, unlocked or cancelled a moment earlier.
 */
export type MaintenanceWindowStage = 'announced' | 'locked';

/** What a write may change about an open window. */
export type MaintenanceWindowChanges = Partial<
    Pick<
        MaintenanceWindowRecord,
        'startsAt' | 'endsAt' | 'message' | 'lockedAt' | 'lockedBy' | 'endedAt' | 'endedBy'
    >
>;

/**
 * What became of a window, read off its record. `cancelled` is a window that
 * ended without ever locking anybody out.
 */
export type MaintenanceWindowStatus = 'announced' | 'locked' | 'ended' | 'cancelled';

/**
 * What SaaSiCat tells the application about a window, so that it can write to
 * its own users — in its own words, from its own sender, in their language.
 * The lock itself is not among them: tenants see it in the application.
 */
export type MaintenanceWindowEvent =
    | { kind: 'announced'; window: MaintenanceWindowRecord }
    | {
          kind: 'rescheduled';
          window: MaintenanceWindowRecord;
          /** The window as it was announced before this change. */
          previous: MaintenanceWindowRecord;
      }
    | { kind: 'cancelled'; window: MaintenanceWindowRecord };

/** The longest message a window carries; the operator's words, not a document. */
export const MAINTENANCE_MESSAGE_MAX_LENGTH = 500;

/**
 * How long a process may go on reading a lock state it read before. Every
 * request asks, so each process keeps the answer this long rather than asking
 * the database per request; the command that locks waits this long before it
 * returns, so that every process has seen the lock by then.
 *
 * Part of the contract between two versions of an application: the command
 * that locks comes from the release being deployed, while the processes it
 * waits for may still run the one before. It is safe only while the figure it
 * waits by is at least theirs, so a later release may raise it and never lower
 * it.
 */
export const MAINTENANCE_STATE_MAX_AGE_SECONDS = 5;

/**
 * The manifest capability that announces the maintenance screen. The platform
 * sets it where it keeps maintenance windows, and the administration offers the
 * screen — and its lock banner — only where it is set.
 */
export const MAINTENANCE_CAPABILITY = 'maintenance.manage';

/**
 * What a tenant's page is told: nothing, a window ahead, or a lock. Dates are
 * ISO strings, and `overrun` is the server's answer rather than the browser's,
 * whose clock is not the one the window was announced by.
 */
export type MaintenanceStatusView =
    | { state: 'none' }
    | { state: 'announced'; startsAt: string; endsAt: string; message: string | null }
    | {
          state: 'locked';
          lockedAt: string;
          /** The announced end; null where nobody said. */
          endsAt: string | null;
          message: string | null;
          /** The announced end has passed, and the lock still holds. */
          overrun: boolean;
      };

/** A window as the administration shows it. */
export interface MaintenanceWindowView {
    id: string;
    status: MaintenanceWindowStatus;
    startsAt: string | null;
    endsAt: string | null;
    message: string | null;
    createdAt: string;
    createdBy: string;
    lockedAt: string | null;
    lockedBy: string | null;
    endedAt: string | null;
    endedBy: string | null;
    /** Locked, and past its announced end. */
    overrun: boolean;
    /** Announced, never locked, and past its announced end: tenants no longer see it. */
    lapsed: boolean;
}

/** `GET /admin/maintenance`: the open window, if any, and the ones before it. */
export interface MaintenanceOverview {
    open: MaintenanceWindowView | null;
    /** Newest first, the open one included. */
    recent: MaintenanceWindowView[];
    /** How long a lock takes to reach every process. */
    takesEffectWithinSeconds: number;
}

/** `POST /admin/maintenance/lock`: the locked window, and whether it was locked before. */
export interface MaintenanceLockView {
    window: MaintenanceWindowView;
    /** The lock already held; nothing was changed. */
    alreadyLocked: boolean;
    /** How long the lock takes to reach every process. */
    takesEffectWithinSeconds: number;
}

/** `POST /admin/maintenance/unlock`: the window it ended, or the open one it left alone. */
export interface MaintenanceUnlockView {
    window: MaintenanceWindowView | null;
    /** Whether a lock held and was ended by this call. */
    wasLocked: boolean;
}
