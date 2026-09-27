// What a maintenance window looks like to a tenant and to the operator.
//
// Pure, and in one place, because three sides read the same record — the
// guard that refuses a request, the status endpoint a tenant's page polls, and
// the administration — and each deciding "overrun" or "no longer shown" on its
// own would be the same decision written three times.

import type {
    MaintenanceStatusView,
    MaintenanceWindowRecord,
    MaintenanceWindowStatus,
    MaintenanceWindowView,
} from './maintenance-window.types.js';

/**
 * What `Retry-After` says to a client refused by a lock whose announced end
 * has passed, or that never had one: long enough not to hammer the server,
 * short enough that a client comes back soon after the operator unlocks.
 */
const RETRY_AFTER_WITHOUT_END_SECONDS = 60;

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

/** What became of a window. */
export function maintenanceWindowStatusOf(
    window: MaintenanceWindowRecord,
): MaintenanceWindowStatus {
    if (window.endedAt) return window.lockedAt ? 'ended' : 'cancelled';
    return window.lockedAt ? 'locked' : 'announced';
}

/** Whether the lock still holds after the end it announced. */
export function isMaintenanceOverrun(window: MaintenanceWindowRecord, now: Date): boolean {
    return (
        maintenanceWindowStatusOf(window) === 'locked' &&
        window.endsAt !== null &&
        window.endsAt.getTime() <= now.getTime()
    );
}

/**
 * Whether an announcement has lapsed: never locked, and its announced end has
 * passed. Tenants are no longer shown it — past information is noise — while
 * the operator is, because it still stands in the way of the next one.
 */
export function isMaintenanceAnnouncementLapsed(
    window: MaintenanceWindowRecord,
    now: Date,
): boolean {
    return (
        maintenanceWindowStatusOf(window) === 'announced' &&
        window.endsAt !== null &&
        window.endsAt.getTime() <= now.getTime()
    );
}

/** What a tenant's page is told, given the open window — or none. */
export function maintenanceStatusOf(
    open: MaintenanceWindowRecord | null,
    now: Date,
): MaintenanceStatusView {
    if (!open) return { state: 'none' };
    const status = maintenanceWindowStatusOf(open);
    if (status === 'locked' && open.lockedAt) {
        return {
            state: 'locked',
            lockedAt: open.lockedAt.toISOString(),
            endsAt: iso(open.endsAt),
            message: open.message,
            overrun: isMaintenanceOverrun(open, now),
        };
    }
    if (
        status === 'announced' &&
        open.startsAt &&
        open.endsAt &&
        !isMaintenanceAnnouncementLapsed(open, now)
    ) {
        return {
            state: 'announced',
            startsAt: open.startsAt.toISOString(),
            endsAt: open.endsAt.toISOString(),
            message: open.message,
        };
    }
    return { state: 'none' };
}

/** A window as the administration shows it. */
export function maintenanceWindowViewOf(
    window: MaintenanceWindowRecord,
    now: Date,
): MaintenanceWindowView {
    return {
        id: window.id,
        status: maintenanceWindowStatusOf(window),
        startsAt: iso(window.startsAt),
        endsAt: iso(window.endsAt),
        message: window.message,
        createdAt: window.createdAt.toISOString(),
        createdBy: window.createdBy,
        lockedAt: iso(window.lockedAt),
        lockedBy: window.lockedBy,
        endedAt: iso(window.endedAt),
        endedBy: window.endedBy,
        overrun: isMaintenanceOverrun(window, now),
        lapsed: isMaintenanceAnnouncementLapsed(window, now),
    };
}

/**
 * Seconds until the announced end, for the `Retry-After` of a refused request.
 * Never less than one: a client told zero would retry at once, in a loop.
 */
export function maintenanceRetryAfterSeconds(window: MaintenanceWindowRecord, now: Date): number {
    if (!window.endsAt || window.endsAt.getTime() <= now.getTime()) {
        return RETRY_AFTER_WITHOUT_END_SECONDS;
    }
    return Math.max(1, Math.ceil((window.endsAt.getTime() - now.getTime()) / 1000));
}
