// The arithmetic of what a payment settles, what a credit still owes and how a
// refund divides across credits — shared by both adapters, which run it inside
// the turn that holds the rows it reads. Everything is counted in whole cents,
// so no amount drifts by a rounding the subscriber would see.

import { toCents } from './money.js';
import type {
    CreditPart,
    SubscriberCreditEntryKind,
    SubscriberCreditOrigin,
} from './subscriber-payment.types.js';

/**
 * What an invoice of `gross` still owes after the amounts `settled` against
 * it; negative where it owes the subscriber, as an invoice whose total is
 * negative does.
 */
export function owedOn(gross: number, settled: readonly number[]): number {
    const paid = settled.reduce((sum, amount) => sum + toCents(amount), 0);
    return (toCents(gross) - paid) / 100;
}

/**
 * How a payment of `amount` divides against an invoice that still owes
 * `owed`: it settles what is owed, and what it brought beyond that is a credit.
 * An invoice that owes nothing, or owes the subscriber, is settled by nothing.
 */
export function paymentSettlement(
    amount: number,
    owed: number,
): { settles: number; credits: number } {
    const brought = toCents(amount);
    const settles = Math.min(brought, Math.max(0, toCents(owed)));
    return { settles: settles / 100, credits: (brought - settles) / 100 };
}

/** How much of a credit an entry pays out: a failed refund gives its amount back. */
function paidOutBy(entry: { kind: SubscriberCreditEntryKind; amount: number }): number {
    const cents = toCents(entry.amount);
    return entry.kind === 'REFUND_FAILED' ? -cents : cents;
}

/**
 * What a credit of `amount` still owes after `entries`. Never below `0`: an
 * entry that would take it there is not written.
 */
export function openOfCredit(
    amount: number,
    entries: readonly { kind: SubscriberCreditEntryKind; amount: number }[],
): number {
    const paidOut = entries.reduce((sum, entry) => sum + paidOutBy(entry), 0);
    return Math.max(0, toCents(amount) - paidOut) / 100;
}

/** A credit as a refund is divided across it. */
export interface OpenCredit {
    id: string;
    origin: SubscriberCreditOrigin;
    createdAt: Date;
    /** What it still owes, from `openOfCredit`. */
    open: number;
}

/**
 * How a refund of `amount` that pays back payment `paymentId` divides across
 * the subscriber's open credits: the credit that payment left first — the
 * refund pays back what the subscriber overpaid with it —, then the oldest.
 * What no open credit takes matches nothing, and is the operator's to
 * reconcile.
 */
export function refundParts(
    amount: number,
    paymentId: string,
    credits: readonly OpenCredit[],
): { parts: CreditPart[]; unmatched: number } {
    const ownFirst = [...credits].sort(
        (a, b) =>
            rankFor(a, paymentId) - rankFor(b, paymentId) ||
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id, 'en'),
    );
    let left = toCents(amount);
    const parts: CreditPart[] = [];
    for (const credit of ownFirst) {
        if (left === 0) break;
        const taken = Math.min(left, toCents(credit.open));
        if (taken <= 0) continue;
        parts.push({ creditId: credit.id, amount: taken / 100 });
        left -= taken;
    }
    return { parts, unmatched: left / 100 };
}

function rankFor(credit: OpenCredit, paymentId: string): number {
    return credit.origin.kind === 'payment' && credit.origin.paymentId === paymentId ? 0 : 1;
}
