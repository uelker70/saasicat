// The arithmetic of what a payment settles, what a credit still owes, how a
// refund divides across credits, and how a reversal takes back what its payment
// brought and gives it back again — shared by both adapters, which run it
// inside the turn that holds the rows it reads. Everything is counted in whole
// cents, so no amount drifts by a rounding the subscriber would see.

import { toCents } from './money.js';
import type {
    CreditPart,
    InvoicePart,
    SubscriberCreditEntryKind,
    SubscriberCreditOrigin,
} from './subscriber-payment.types.js';

/**
 * What an invoice of `gross` still owes after the entries `settled` against
 * it, each signed as `settledAmountOf` reads it — a reversal that opened the
 * invoice again counts against what was settled; negative where it owes the
 * subscriber, as an invoice whose total is negative does.
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

/**
 * The entries that give back what an earlier entry paid out of a credit; an
 * adapter that sums entries in SQL passes it as a parameter, so the sign is
 * decided here alone.
 */
export const GIVING_BACK_CREDIT_ENTRY_KINDS: readonly SubscriberCreditEntryKind[] = [
    'REFUND_FAILED',
    'REVERSAL_TAKEN_BACK',
];

const GIVING_BACK: ReadonlySet<SubscriberCreditEntryKind> = new Set(GIVING_BACK_CREDIT_ENTRY_KINDS);

/**
 * How much of a credit an entry pays out: a failed refund and a reversal the
 * gateway gave back return their amount.
 */
function paidOutBy(entry: { kind: SubscriberCreditEntryKind; amount: number }): number {
    const cents = toCents(entry.amount);
    return GIVING_BACK.has(entry.kind) ? -cents : cents;
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

/** The credit a payment left, as a reversal of that payment reads it. */
export interface ReversibleCredit {
    creditId: string;
    /** What of the credit no reversal of the payment took yet, open or paid out. */
    left: number;
    /** What of the credit is still owed to the subscriber, from `openOfCredit`. */
    open: number;
}

/** An invoice a payment settles, as a reversal of that payment reads it. */
export interface ReversibleInvoice {
    invoiceId: string;
    /** What the payment still settles there: its settlements less what reversals took back. */
    left: number;
}

/** How a withdrawn amount divides across what its payment brought. */
export interface WithdrawalParts {
    /** What it takes of the credit, open or paid out alike. */
    fromCredit: number;
    /** What it takes of the credit that is still open; `null` where nothing. */
    credit: CreditPart | null;
    /** The invoices it opens again, in the order given, each by no more than the payment settles there. */
    invoices: InvoicePart[];
    /**
     * What meets the part of the credit already paid out, and what goes beyond
     * everything the payment brought: the operator's to reconcile.
     */
    unmatched: number;
}

/**
 * How `amount`, newly withdrawn by a reversal of a payment, divides across what
 * the payment brought: the credit it left first, so the operator is not left
 * refunding what is owed again — its open part shrinks it, its part already
 * paid out matches nothing —, then the invoices it settles, in the order given,
 * the oldest first. Whatever exceeds both matches nothing as well.
 */
export function withdrawalParts(
    amount: number,
    credit: ReversibleCredit | null,
    invoices: readonly ReversibleInvoice[],
): WithdrawalParts {
    let left = toCents(amount);
    const share = credit ? Math.min(left, Math.max(0, toCents(credit.left))) : 0;
    const open = credit ? Math.min(share, Math.max(0, toCents(credit.open))) : 0;
    left -= share;
    const opened: InvoicePart[] = [];
    for (const invoice of invoices) {
        if (left === 0) break;
        const taken = Math.min(left, Math.max(0, toCents(invoice.left)));
        if (taken === 0) continue;
        opened.push({ invoiceId: invoice.invoiceId, amount: taken / 100 });
        left -= taken;
    }
    return {
        fromCredit: share / 100,
        credit: credit && open > 0 ? { creditId: credit.creditId, amount: open / 100 } : null,
        invoices: opened,
        unmatched: (share - open + left) / 100,
    };
}

/** What a reversal took back that an amount the gateway gives back can return. */
export interface ReinstatableParts {
    /** What of the reversal's unmatched amount is not covered by an earlier give-back yet. */
    unmatched: number;
    /** What it took of each credit and has not given back yet. */
    credits: readonly { creditId: string; left: number }[];
    /**
     * What it opened again of each invoice and has not settled again yet, the
     * oldest first, with what the invoice owes now.
     */
    invoices: readonly { invoiceId: string; left: number; owed: number }[];
}

/** How an amount the gateway gives back divides across what its reversal took. */
export interface ReinstatementParts {
    /** What covers the reversal's unmatched amount. */
    covered: number;
    /** What each credit is owed again. */
    credits: CreditPart[];
    /** What settles each invoice again, as far as it still owes. */
    invoices: InvoicePart[];
    /** What the invoices no longer owe — the subscriber paid them meanwhile —, as a credit. */
    credited: number;
    /** What goes beyond everything the reversal took, which nothing takes. */
    beyond: number;
}

/**
 * How `amount`, newly given back by the gateway for a reversal, takes it back
 * part for part, in the reverse of how it was withdrawn: the unmatched part
 * first — such as the refund the subscriber received before the dispute, which
 * the gateway returns where the dispute is lost —, then what it took of the
 * credits, then what it opened of the invoices, settling each again as far as
 * it still owes. What an invoice no longer owes becomes a credit.
 */
export function reinstatementParts(amount: number, took: ReinstatableParts): ReinstatementParts {
    let left = toCents(amount);
    const covered = Math.min(left, Math.max(0, toCents(took.unmatched)));
    left -= covered;
    const credits: CreditPart[] = [];
    for (const credit of took.credits) {
        const given = Math.min(left, Math.max(0, toCents(credit.left)));
        if (given === 0) continue;
        credits.push({ creditId: credit.creditId, amount: given / 100 });
        left -= given;
    }
    const invoices: InvoicePart[] = [];
    let credited = 0;
    for (const invoice of took.invoices) {
        const given = Math.min(left, Math.max(0, toCents(invoice.left)));
        if (given === 0) continue;
        const settles = Math.min(given, Math.max(0, toCents(invoice.owed)));
        if (settles > 0) invoices.push({ invoiceId: invoice.invoiceId, amount: settles / 100 });
        credited += given - settles;
        left -= given;
    }
    return {
        covered: covered / 100,
        credits,
        invoices,
        credited: credited / 100,
        beyond: left / 100,
    };
}

/**
 * What each invoice nets from `entries` — settlements signed as
 * `settledAmountOf` reads them —, in whole cents, in the order the invoices
 * first appear. Read over a payment's settlements, it is what the payment still
 * settles on each; over a reversal's, the negative of what it opened and has
 * not settled again.
 */
export function netByInvoice(entries: readonly InvoicePart[]): InvoicePart[] {
    const net = new Map<string, number>();
    for (const entry of entries) {
        net.set(entry.invoiceId, (net.get(entry.invoiceId) ?? 0) + toCents(entry.amount));
    }
    return [...net].map(([invoiceId, cents]) => ({ invoiceId, amount: cents / 100 }));
}

/**
 * What `entries` paid out of each credit, net of what they gave back, in whole
 * cents, in the order the credits first appear. Read over a reversal's
 * entries, it is what the reversal took of each credit and has not given back.
 */
export function paidOutByCredit(
    entries: readonly { creditId: string; kind: SubscriberCreditEntryKind; amount: number }[],
): CreditPart[] {
    const paid = new Map<string, number>();
    for (const entry of entries) {
        paid.set(entry.creditId, (paid.get(entry.creditId) ?? 0) + paidOutBy(entry));
    }
    return [...paid].map(([creditId, cents]) => ({ creditId, amount: cents / 100 }));
}

/**
 * The ids of `cases`, in the order given — the order they were opened —, that
 * the first `covered` of what the gateway gave back covers in full.
 */
export function casesCovered(
    cases: readonly { id: string; amount: number }[],
    covered: number,
): string[] {
    const limit = toCents(covered);
    let running = 0;
    const ids: string[] = [];
    for (const each of cases) {
        running += toCents(each.amount);
        if (running <= limit) ids.push(each.id);
    }
    return ids;
}
