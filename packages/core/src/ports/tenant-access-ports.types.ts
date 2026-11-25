// Where the reasons a tenant is held back are kept (`SC-ADM-060`).

import type {
    NewTenantAccessHold,
    TenantAccessHold,
    TenantAccessHoldKind,
} from '../tenant-access.types.js';
import type { TransactionContext } from './core-ports.types.js';

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
     * assign — in the caller's transaction where one is given. Returns null
     * where the same reason is already open for the tenant: same kind, same
     * reference.
     */
    record(hold: NewTenantAccessHold, tx?: TransactionContext): Promise<TenantAccessHold | null>;
    /**
     * Lifts the open reason `id` as of `liftedAt`, in the caller's transaction
     * where one is given. Returns it as stored, or null where it is not open:
     * lifted already, or no reason has that id.
     */
    lift(
        id: string,
        liftedAt: Date,
        liftedBy: string,
        tx?: TransactionContext,
    ): Promise<TenantAccessHold | null>;
    /** Every reason of `tenantId`, lifted ones included, oldest first. */
    listAllOf(tenantId: string): Promise<TenantAccessHold[]>;
    /**
     * Locks the open reason `id` for the rest of `tx` (`FOR UPDATE`) and
     * returns it, or null where it is not open. Whoever lifts a reason or
     * begins a deletion on its strength takes this lock first, so of the two
     * exactly one acts on the reason as it stood.
     */
    lockOpen(id: string, tx: TransactionContext): Promise<TenantAccessHold | null>;
    /**
     * Locks every reason of `tenantId`, lifted ones included, for the rest of
     * `tx` (`FOR UPDATE`), and returns them as they stand once locked, oldest
     * first. A lift that committed before is read as it left the reason; one
     * that comes after waits for `tx`, and finds the reason as `tx` left it.
     * What the close of a deletion reads the reasons it rewrites from.
     */
    lockAllOf(tenantId: string, tx: TransactionContext): Promise<TenantAccessHold[]>;
    /**
     * Writes `recordedBy` and `liftedBy` of each reason named, as given, in the
     * caller's transaction where one is given; changes nothing else. What a
     * deletion leaves of a tenant's reasons names roles, not persons
     * (`SC-PRIV-023`).
     */
    replaceActors(
        replacements: readonly {
            readonly id: string;
            readonly recordedBy: string;
            readonly liftedBy: string | null;
        }[],
        tx?: TransactionContext,
    ): Promise<void>;
    /**
     * Empties the `note` of every reason of `tenantId`, lifted ones included,
     * in the caller's transaction where one is given; changes nothing else.
     * A note is free text and may name anybody, so what a deletion leaves of
     * a tenant's reasons keeps none (`SC-PRIV-023`).
     */
    forgetNotes(tenantId: string, tx?: TransactionContext): Promise<void>;
}
