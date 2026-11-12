// Where the reasons a tenant is held back are kept (`SC-ADM-055`).

import type {
    NewTenantAccessHold,
    TenantAccessHold,
    TenantAccessHoldKind,
} from '../tenant-access.types.js';

/**
 * Keeps the reasons a tenant is held back, in the application's own database.
 *
 * Read on every request of every tenant, so `listOpen` is the one hot path:
 * the store answers it from an index on the open reasons of a tenant.
 *
 * An adapter translates. It does not decide whether a reason applies; it keeps
 * one open row per tenant, kind and reference, so that a run repeated, or two
 * operators acting at once, record a reason once.
 */
export interface TenantAccessHoldPort {
    /** The open reasons of `tenantId`, oldest first. */
    listOpen(tenantId: string): Promise<TenantAccessHold[]>;
    /** The open reasons of each of `tenantIds`, in one read; a tenant without any is absent. */
    listOpenFor(tenantIds: readonly string[]): Promise<TenantAccessHold[]>;
    /**
     * Every tenant with an open reason of one of `kinds`, each once. What the
     * administration filters its list by before the application's rows are
     * cut to a page, so a tenant held back is found however old it is.
     */
    listTenantIdsHeldBy(kinds: readonly TenantAccessHoldKind[]): Promise<string[]>;
    /**
     * Records `hold` and returns it as stored — the id is the adapter's to
     * assign. Returns null where the same reason is already open for the
     * tenant: same kind, same reference.
     */
    record(hold: NewTenantAccessHold): Promise<TenantAccessHold | null>;
    /**
     * Lifts the open reason `id` as of `liftedAt`. Returns it as stored, or null
     * where it is not open: lifted already, or no reason has that id.
     */
    lift(id: string, liftedAt: Date, liftedBy: string): Promise<TenantAccessHold | null>;
}
