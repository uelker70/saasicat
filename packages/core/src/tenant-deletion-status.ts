// Where a tenant's deletion stands (`SC-ADM-058`), decided in one place for
// the run that deletes it and for the pages that show it: a page that phrased
// the decision a second time would one day call a tenant due that the run
// keeps.
//
// The order is the run's. A begun deletion is its record's: closed, halted by
// what the record keeps, held by the installation's mark before its next store
// (`SC-PRIV-021`), or under way — retried where the last run failed and let it
// go. One not begun waits for its day in the installation's zone, and on it is
// held by every reason the run asks before it begins; before the day, the same
// reasons are the operator's forecast of what the day would bring.

import type { InstallationMarkVerdict } from './installation-mark.types.js';
import type { SubscriptionEnd } from './subscription-end.types.js';
import {
    commercialRecordLost,
    type CommercialRecordCounts,
    type TenantDeletionFailure,
    type TenantDeletionHalt,
    type TenantDeletionRecord,
} from './tenant-deletion.types.js';
import { dayInZone, type CalendarDay } from './zoned-day.js';

/**
 * The manifest capability that announces the operator's view of a tenant's
 * deletion. The platform sets it where it serves the view, and the admin UI
 * shows the view only where it is set.
 */
export const TENANT_DELETION_CAPABILITY = 'deletions.read';

/** Whether the day `end` names for its tenant's deletion has come by `today`. */
export function deletionDayHasCome(
    end: Pick<SubscriptionEnd, 'deletesOn'>,
    today: CalendarDay,
): boolean {
    // Days are `YYYY-MM-DD`, so the later day is also the larger text.
    return end.deletesOn <= today;
}

/** Whether a run goes on with a begun deletion: neither closed nor halted. */
export function deletionGoesOn(record: Pick<TenantDeletionRecord, 'closedAt' | 'halt'>): boolean {
    return record.closedAt === null && record.halt === null;
}

/** What the run asks before it begins a due deletion. */
export interface DeletionHoldInputs {
    /** Whether the database is the installation's own (`SC-PRIV-021`). */
    readonly verdict: InstallationMarkVerdict;
    /** Whether a subscriber keeps the record of the deletion (`SC-PRIV-023`). */
    readonly hasSubscriber: boolean;
    /** Whether a contract of the tenant runs past the end (`SC-PRIV-026`). */
    readonly contractRunsPastEnd: boolean;
}

/** A reason a deletion does not go on, with what it names. */
export type TenantDeletionHaltReason =
    | {
          readonly reason: Extract<TenantDeletionHalt, 'installation-unmarked'>;
          /** The identifier the process expects the database to be marked with. */
          readonly expected: string;
      }
    | {
          readonly reason: Extract<TenantDeletionHalt, 'installation-differs'>;
          readonly expected: string;
          /** The identifier the database is marked with. */
          readonly marked: string;
      }
    | { readonly reason: Extract<TenantDeletionHalt, 'no-subscriber'> }
    | { readonly reason: Extract<TenantDeletionHalt, 'contract-runs-past-end'> }
    | {
          readonly reason: Extract<TenantDeletionHalt, 'commercial-record-lost'>;
          /** The store after whose erasing the record was found short. */
          readonly store: string | null;
          /** The parts of the record that fell. */
          readonly lost: readonly (keyof CommercialRecordCounts)[];
      };

/** A reason the installation's mark holds a deletion for. */
export type TenantDeletionMarkHalt = Extract<
    TenantDeletionHaltReason,
    { reason: 'installation-unmarked' | 'installation-differs' }
>;

/** A reason that holds a due deletion before it begins. */
export type TenantDeletionHeldBeforeBeginning = Exclude<
    TenantDeletionHaltReason,
    { reason: 'commercial-record-lost' }
>;

/**
 * The reason the installation's mark holds every deletion for, begun or not,
 * or null where the database is the installation's (`SC-PRIV-021`).
 */
export function deletionHeldByTheMark(
    verdict: InstallationMarkVerdict,
): TenantDeletionMarkHalt | null {
    switch (verdict.kind) {
        case 'matches':
            return null;
        case 'unmarked':
            return { reason: 'installation-unmarked', expected: verdict.expected };
        case 'differs':
            return {
                reason: 'installation-differs',
                expected: verdict.expected,
                marked: verdict.marked,
            };
    }
}

/**
 * Every reason that holds a due deletion before it begins, in the order the
 * run asks them; empty where nothing does. A tenant identifier that names no
 * single tenant holds it too, and is not among them: whoever asks here reads
 * the tenant by a valid identifier.
 */
export function deletionHeldBy(inputs: DeletionHoldInputs): TenantDeletionHeldBeforeBeginning[] {
    const reasons: TenantDeletionHeldBeforeBeginning[] = [];
    const mark = deletionHeldByTheMark(inputs.verdict);
    if (mark) reasons.push(mark);
    if (!inputs.hasSubscriber) reasons.push({ reason: 'no-subscriber' });
    if (inputs.contractRunsPastEnd) reasons.push({ reason: 'contract-runs-past-end' });
    return reasons;
}

/** Where a tenant's deletion stands. Every state names the day it is due on. */
export type TenantDeletionStatus =
    | {
          readonly kind: 'scheduled';
          readonly deletesOn: CalendarDay;
          /** What would hold it were its day today; empty where nothing would. */
          readonly wouldBeHeldBy: readonly TenantDeletionHaltReason[];
      }
    | { readonly kind: 'due'; readonly deletesOn: CalendarDay }
    | {
          readonly kind: 'halted';
          readonly deletesOn: CalendarDay;
          /** Never empty. */
          readonly heldBy: readonly TenantDeletionHaltReason[];
      }
    | {
          readonly kind: 'running';
          readonly deletesOn: CalendarDay;
          readonly startedAt: Date;
          readonly storesErased: number;
          readonly storesTotal: number;
          /** A failure the run holding it met, such as a call it stopped waiting for. */
          readonly lastFailure: TenantDeletionFailure | null;
      }
    | {
          readonly kind: 'retrying';
          readonly deletesOn: CalendarDay;
          readonly startedAt: Date;
          readonly attempts: number;
          readonly lastFailure: TenantDeletionFailure;
      }
    | { readonly kind: 'deleted'; readonly deletesOn: CalendarDay; readonly closedAt: Date };

/** What decides where a tenant's deletion stands. */
export interface TenantDeletionStatusInput {
    /** The end that decides the tenant's deletion, or null where no open `ended` reason names one. */
    readonly end: Pick<SubscriptionEnd, 'deletesOn'> | null;
    readonly record: TenantDeletionRecord | null;
    readonly holds: DeletionHoldInputs;
    readonly now: Date;
    /** The installation's zone, which its days are read in. */
    readonly timeZone: string;
    /** How long a run's claim on a deletion holds. */
    readonly leaseMs: number;
}

/** The reason a deletion's record keeps it halted for. */
function keptHalt(record: TenantDeletionRecord): TenantDeletionHaltReason {
    const { commercialBefore: before, commercialAfter: after } = record;
    return {
        reason: 'commercial-record-lost',
        store: record.lastFailure?.store ?? null,
        lost: before && after ? commercialRecordLost(before, after) : [],
    };
}

/** Where a begun deletion stands, decided by its record and the installation's mark. */
function statusOfBegun(
    record: TenantDeletionRecord,
    verdict: InstallationMarkVerdict,
    now: Date,
    leaseMs: number,
): TenantDeletionStatus {
    const { deletesOn, startedAt } = record;
    if (record.closedAt !== null) return { kind: 'deleted', deletesOn, closedAt: record.closedAt };
    // The run asks the mark before it reads any record, so a mark that holds
    // the installation also holds a deletion its record keeps halted: both
    // are named, the mark first, as the run would meet them.
    const mark = deletionHeldByTheMark(verdict);
    if (record.halt !== null) {
        const kept = keptHalt(record);
        return { kind: 'halted', deletesOn, heldBy: mark ? [mark, kept] : [kept] };
    }
    if (mark) return { kind: 'halted', deletesOn, heldBy: [mark] };
    // A claim is fresh up to and including the moment one lease after it was
    // taken, as the stores decide when a run may take it over.
    const claimed =
        record.claimedAt !== null && record.claimedAt.getTime() >= now.getTime() - leaseMs;
    if (!claimed && record.lastFailure !== null) {
        return {
            kind: 'retrying',
            deletesOn,
            startedAt,
            attempts: record.attempts,
            lastFailure: record.lastFailure,
        };
    }
    return {
        kind: 'running',
        deletesOn,
        startedAt,
        storesErased: record.stores.filter((store) => store.erasedAt !== null).length,
        storesTotal: record.stores.length,
        lastFailure: record.lastFailure,
    };
}

/**
 * Where a tenant's deletion stands at `now`, or null where nothing is to come:
 * no end decides a deletion and none has begun. A begun deletion is its
 * record's, whatever the end says.
 */
export function tenantDeletionStatusOf(
    input: TenantDeletionStatusInput,
): TenantDeletionStatus | null {
    const { end, record, holds } = input;
    if (record) return statusOfBegun(record, holds.verdict, input.now, input.leaseMs);
    if (!end) return null;
    const { deletesOn } = end;
    const heldBy = deletionHeldBy(holds);
    if (!deletionDayHasCome(end, dayInZone(input.now, input.timeZone))) {
        return { kind: 'scheduled', deletesOn, wouldBeHeldBy: heldBy };
    }
    if (heldBy.length > 0) return { kind: 'halted', deletesOn, heldBy };
    return { kind: 'due', deletesOn };
}
