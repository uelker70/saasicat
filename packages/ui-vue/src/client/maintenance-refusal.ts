// Recognising the maintenance lock's refusal, and telling a mounted gate about
// it the moment it happens.
//
// While the application is locked, every request a tenant's page sends is
// refused with `503` and the code `MAINTENANCE`. The gate polls the status on
// its own, but a page should not wait a minute to say so: the application's
// HTTP client hands each refused response to `reportMaintenanceRefusal`, and
// every mounted gate switches to the maintenance page at once — saying that
// what the tenant was doing was not carried out (`SC-UI-026`).
//
// Framework-free, so an HTTP interceptor can call it without a component.

import type { MaintenanceStatusView } from '@saasicat/core';

const MAINTENANCE_CODE = 'MAINTENANCE';
const SERVICE_UNAVAILABLE = 503;

type LockedStatus = Extract<MaintenanceStatusView, { state: 'locked' }>;

type RefusalListener = (status: LockedStatus) => void;

const listeners = new Set<RefusalListener>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The locked status a response carries, when it is the lock's refusal: a
 * `503` whose body has the code `MAINTENANCE`. Null for anything else,
 * including a `503` from a proxy in front of the application.
 */
export function maintenanceRefusalOf(status: number, body: unknown): LockedStatus | null {
    if (status !== SERVICE_UNAVAILABLE || !isRecord(body) || body.code !== MAINTENANCE_CODE) {
        return null;
    }
    const carried = body.maintenance;
    if (isRecord(carried) && carried.state === 'locked' && typeof carried.lockedAt === 'string') {
        return carried as unknown as LockedStatus;
    }
    // A refusal without the window beside it still means the lock holds; the
    // gate asks for the rest.
    return { state: 'locked', lockedAt: '', endsAt: null, message: null, overrun: false };
}

/**
 * Hands a response to every mounted maintenance gate. Returns whether it was
 * the lock's refusal, so an interceptor can stop treating it as an error of
 * its own.
 */
export function reportMaintenanceRefusal(status: number, body: unknown): boolean {
    const locked = maintenanceRefusalOf(status, body);
    if (!locked) return false;
    for (const listener of listeners) listener(locked);
    return true;
}

/** Hears every refusal reported; returns what stops hearing it. */
export function onMaintenanceRefusal(listener: RefusalListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
