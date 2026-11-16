// The ports behind the deletion of a tenant (`SC-PRIV-022`): the application's
// erasers, one per store, and its report of what the tenant keeps itself — and
// where the platform keeps the record of each deletion, with the subscriber.

import type {
    CommercialRecordCounts,
    NewTenantDeletionRecord,
    TenantCount,
    TenantDeletionFailure,
    TenantDeletionRecord,
    TenantDeletionRecordHalt,
    TenantKeepLine,
} from '../tenant-deletion.types.js';
import type { TransactionContext } from './core-ports.types.js';

/**
 * Erases one of the application's stores for one tenant: its database, its
 * files, a search index. The platform calls the erasers in the order the
 * application lists them, every one's `count` before the first `erase`, and
 * only with an identifier `tenantIdProblem` accepts; begin each method with
 * `assertOneTenant(tenantId)` all the same (`SC-PRIV-016`), since the platform
 * cannot hold the application's code to it.
 *
 * The platform calls the erasers inside `RlsBypassPort`, as it does its other
 * work across tenants: under row-level security that honours the bypass, a
 * store's statements reach every tenant's rows, and the identifier in their
 * condition is all that bounds them.
 *
 * `erase` may be called again for a store that erased already — a call whose
 * answer was lost, or a run that stopped and was repeated — so what is already
 * gone is done: resolve (`SC-PRIV-018`). A store too large to erase in one
 * call's time makes progress on each call, in batches for instance, and the
 * next run calls again.
 */
export interface TenantEraser {
    /**
     * The store's name, stable across releases: the record keeps its counts
     * under it. A stable key (`isTenantDeletionKey`), unique in the list.
     */
    readonly name: string;
    /** What the store holds for `tenantId` now, by category; called once, before any store erases. */
    count(tenantId: string): Promise<readonly TenantCount[]>;
    /** Erases everything the store holds for `tenantId`. What is already gone is done: resolve. */
    erase(tenantId: string): Promise<void>;
}

/**
 * Reports what a tenant has to keep for obligations of its own, such as
 * receipts under a retention period (`SC-PRIV-022`): one line per category,
 * with a count and the category's words. The platform shows the lines in the
 * banner of the read-only period, hands them to every reminder and keeps them
 * in the deletion record; they do not stop the deletion. A tenant with nothing
 * to keep is answered with no lines.
 */
export interface TenantKeepReportPort {
    keep(tenantId: string): Promise<readonly TenantKeepLine[]>;
}

/**
 * Keeps the record of each tenant's deletion with its subscriber
 * (`SC-PRIV-023`): one per tenant, with a part per store.
 *
 * A deletion may take longer than a run, and several instances may run at
 * once, so a run claims a record before it works on it, renews the claim
 * before each store, and lets go of it when it stops; a claim older than its
 * lease is taken over. Each write is conditional on what the caller read, and
 * a part already recorded is not recorded again. An adapter translates; it
 * does not decide.
 */
export interface TenantDeletionRecordPort {
    /**
     * Writes `record` with its stores, unclaimed, where the tenant has none —
     * in the caller's transaction where one is given — and returns it as
     * stored. Returns null where the tenant has one already: of two
     * concurrent calls exactly one writes.
     */
    begin(
        record: NewTenantDeletionRecord,
        tx?: TransactionContext,
    ): Promise<TenantDeletionRecord | null>;
    /** The records of those of `tenantIds` that have one, in one read. */
    findForTenants(tenantIds: readonly string[]): Promise<TenantDeletionRecord[]>;
    /** Every record of `subscriberId`, the most recently begun first. */
    findForSubscriber(subscriberId: string): Promise<TenantDeletionRecord[]>;
    /**
     * Claims the open record `id` for this run at `now`, where no run holds it
     * or the run that does took it on before `staleBefore`. Returns it as
     * claimed, or null where it is closed or another run holds a fresh claim —
     * of two concurrent calls exactly one claims it.
     */
    claim(id: string, now: Date, staleBefore: Date): Promise<TenantDeletionRecord | null>;
    /**
     * Moves the claim taken at `claimedAt` to `now`. Returns false where the
     * record is no longer held by it: the claim went stale and another run
     * took it on.
     */
    renew(id: string, claimedAt: Date, now: Date): Promise<boolean>;
    /** Lets go of the claim taken at `claimedAt`; does nothing where another holds the record. */
    release(id: string, claimedAt: Date): Promise<void>;
    /**
     * Records what `store` counted at `at`, where it has not counted yet. The
     * first counts stand: a store counted again after it erased would count
     * nothing (`SC-PRIV-018`).
     */
    recordCounts(
        id: string,
        store: string,
        counts: readonly TenantCount[],
        at: Date,
    ): Promise<void>;
    /** Records that `store` confirmed at `at`, where it has not confirmed yet. */
    recordErased(id: string, store: string, at: Date): Promise<void>;
    /**
     * Records the commercial record counted `before` the first store, or
     * `after` the last — or after the store that took part of it along.
     */
    recordCommercial(
        id: string,
        which: 'before' | 'after',
        counts: CommercialRecordCounts,
    ): Promise<void>;
    /**
     * Records `failure` as the last one, counts one attempt more, and sets
     * `halt` — null where the next run may go on.
     */
    recordFailure(
        id: string,
        failure: TenantDeletionFailure,
        halt: TenantDeletionRecordHalt | null,
    ): Promise<void>;
    /**
     * Closes the open record `id` at `at`, in the caller's transaction where
     * one is given. Returns false where it was closed already.
     */
    close(id: string, at: Date, tx?: TransactionContext): Promise<boolean>;
    /**
     * Counts the commercial record of `subscriberId`: the subscriber itself,
     * its contracts, charges, invoices, payments and credits. A model the
     * schema does not adopt counts 0, before as after.
     */
    countCommercialRecord(subscriberId: string): Promise<CommercialRecordCounts>;
}
