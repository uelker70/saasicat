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
    SubscriberCreditRecord,
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
 * What an invoice owes, as `owedOn` reads its settlements, unless it is
 * cancelled or is a cancellation invoice: those owe nothing. The cancellation
 * invoice and the invoice it cancels add up to nothing, and what is still owed
 * stands on the replacement (`SC-PRIC-091`).
 */
export function owedByInvoice(
    gross: number,
    settled: readonly number[],
    corrected: { cancelled: boolean; isCancellation: boolean },
): number {
    if (corrected.cancelled || corrected.isCancellation) return 0;
    return owedOn(gross, settled);
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
    return isOwnCreditOf(credit, paymentId) ? 0 : 1;
}

/**
 * Whether a credit is what payment `paymentId` left: what it brought beyond its
 * invoice, or its share of a cancelled invoice the replacement did not take
 * (`SC-PRIC-091`). A refund of the payment, and a reversal of it, take these
 * first (`SC-PRIC-083`, `SC-PRIC-084`).
 */
export function isOwnCreditOf(
    credit: { origin: SubscriberCreditOrigin },
    paymentId: string,
): boolean {
    const { origin } = credit;
    return (
        (origin.kind === 'payment' || origin.kind === 'cancellation') &&
        origin.paymentId === paymentId
    );
}

/** A credit a payment left, as a reversal of that payment reads it. */
export interface ReversibleCredit {
    creditId: string;
    /** What of the credit no reversal of the payment took yet, open or paid out. */
    left: number;
    /** What of the credit is still owed to the subscriber, from `openOfCredit`. */
    open: number;
}

/**
 * The credits a payment left, as a reversal of it reads them: in the order a
 * reversal takes them, the earliest first, with what of each no reversal of the
 * payment took yet — `takenFromCredits`, what its reversals took of them in
 * all, counted against them in that same order — and what is still open of it.
 */
export function reversibleCreditsOf(
    credits: readonly { creditId: string; amount: number; createdAt: Date; open: number }[],
    takenFromCredits: number,
): ReversibleCredit[] {
    let taken = Math.max(0, toCents(takenFromCredits));
    return [...credits]
        .sort(
            (a, b) =>
                a.createdAt.getTime() - b.createdAt.getTime() ||
                a.creditId.localeCompare(b.creditId, 'en'),
        )
        .map((credit) => {
            const amount = toCents(credit.amount);
            const takenHere = Math.min(amount, taken);
            taken -= takenHere;
            return {
                creditId: credit.creditId,
                left: (amount - takenHere) / 100,
                open: credit.open,
            };
        });
}

/**
 * A credit that another payment collected for an invoice the reversed payment
 * settles left, as the reversal reads it.
 */
export interface CoveringCredit {
    creditId: string;
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
    /** What it takes of the credits the payment left, open or paid out alike. */
    fromCredit: number;
    /** What it takes of each of those credits that is still open, in the order given. */
    credits: CreditPart[];
    /**
     * What it takes of each of those credits beyond its open part, in the
     * order given: paid out, or lent to another reversal as a cover.
     */
    beyondOpen: CreditPart[];
    /** What it takes of the covering credits instead of opening their invoices again, in the order given. */
    covering: CreditPart[];
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
 * the payment brought: the credits it left first, in the order given — what it
 * brought beyond its invoice, then its share of a cancelled invoice the
 * replacement did not take —, so the operator is not left refunding what is
 * owed again: their open part shrinks them, their part already paid out matches
 * nothing. Then the invoices it settles, in the order given, the oldest first.
 * What the reversal would open again of them is covered first by `covering`,
 * the open credits other payments collected for those invoices left, in the
 * order given: that money was collected for the same invoices, so it settles
 * them rather than waiting to be paid out while they are collected again.
 * Whatever exceeds the credits and the invoices matches nothing; no covering
 * credit takes it.
 */
export function withdrawalParts(
    amount: number,
    credits: readonly ReversibleCredit[],
    invoices: readonly ReversibleInvoice[],
    covering: readonly CoveringCredit[] = [],
): WithdrawalParts {
    let left = toCents(amount);
    let share = 0;
    let unmatchedFromCredits = 0;
    const takenOfCredits: CreditPart[] = [];
    const beyondOpen: CreditPart[] = [];
    for (const credit of credits) {
        if (left === 0) break;
        const taken = Math.min(left, Math.max(0, toCents(credit.left)));
        if (taken === 0) continue;
        const open = Math.min(taken, Math.max(0, toCents(credit.open)));
        if (open > 0) takenOfCredits.push({ creditId: credit.creditId, amount: open / 100 });
        if (taken > open) {
            beyondOpen.push({ creditId: credit.creditId, amount: (taken - open) / 100 });
        }
        unmatchedFromCredits += taken - open;
        share += taken;
        left -= taken;
    }
    const opening: { invoiceId: string; cents: number }[] = [];
    for (const invoice of invoices) {
        if (left === 0) break;
        const taken = Math.min(left, Math.max(0, toCents(invoice.left)));
        if (taken === 0) continue;
        opening.push({ invoiceId: invoice.invoiceId, cents: taken });
        left -= taken;
    }
    let toCover = opening.reduce((sum, each) => sum + each.cents, 0);
    const covered: CreditPart[] = [];
    for (const other of covering) {
        if (toCover === 0) break;
        const taken = Math.min(toCover, Math.max(0, toCents(other.open)));
        if (taken === 0) continue;
        covered.push({ creditId: other.creditId, amount: taken / 100 });
        toCover -= taken;
    }
    let coveredCents = opening.reduce((sum, each) => sum + each.cents, 0) - toCover;
    const opened: InvoicePart[] = [];
    for (const each of opening) {
        const kept = Math.min(each.cents, coveredCents);
        coveredCents -= kept;
        if (each.cents > kept) {
            opened.push({ invoiceId: each.invoiceId, amount: (each.cents - kept) / 100 });
        }
    }
    return {
        fromCredit: share / 100,
        credits: takenOfCredits,
        beyondOpen,
        covering: covered,
        invoices: opened,
        unmatched: (unmatchedFromCredits + left) / 100,
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
 * What a reversal opened again and has not settled again, gathered on the
 * invoice that stands in each chain now (`SC-PRIC-091`): what the gateway
 * gives back settles that invoice, whichever invoice of the chain the reversal
 * opened, so a dispute won after a cancellation settles the replacement rather
 * than becoming a credit beside it. `nets` is `netByInvoice` over the
 * reversal's settlements; `standing` names the invoice that stands in the
 * chain of each, or `null` where a cancellation left none — the invoice is
 * kept then, owing nothing. In the order the invoices first appear.
 */
export function reopenedByStanding(
    nets: readonly InvoicePart[],
    standing: ReadonlyMap<string, string | null>,
): { invoiceId: string; left: number }[] {
    const left = new Map<string, number>();
    for (const net of nets) {
        const invoiceId = standing.get(net.invoiceId) ?? net.invoiceId;
        left.set(invoiceId, (left.get(invoiceId) ?? 0) - toCents(net.amount));
    }
    return [...left].map(([invoiceId, cents]) => ({ invoiceId, left: cents / 100 }));
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
 * What other reversals took of one credit to cover what they would have opened
 * of its invoice (`SC-PRIC-087`) and still hold: the credit's `entries` of
 * reversals not in `own`, net of what was given back, in whole cents, in the
 * order the reversals first appear. Where the credit's own payment is reversed
 * as well, these covers are lifted first (`SC-PRIC-090`).
 */
export function coversOf(
    entries: readonly {
        reversalId: string | null;
        kind: SubscriberCreditEntryKind;
        amount: number;
    }[],
    own: ReadonlySet<string>,
): { reversalId: string; amount: number }[] {
    const taken = new Map<string, number>();
    for (const entry of entries) {
        if (entry.reversalId === null || own.has(entry.reversalId)) continue;
        taken.set(entry.reversalId, (taken.get(entry.reversalId) ?? 0) + paidOutBy(entry));
    }
    return [...taken]
        .filter(([, cents]) => cents > 0)
        .map(([reversalId, cents]) => ({ reversalId, amount: cents / 100 }));
}

/**
 * The covers a withdrawal lifts: what it takes of each of its payment's
 * credits beyond the open part (`parts.beyondOpen`) reaches the covers that
 * credit gave other reversals (`coversOf`) before it counts as paid out, in
 * the order given — and only that credit's: what one credit paid out lifts
 * nothing another one lent. Each lifted cover opens its reversal's invoice
 * again; what it reaches beyond them stays unmatched (`SC-PRIC-090`).
 */
export function coversLifted<
    Cover extends { creditId: string; reversalId: string; amount: number },
>(
    parts: Pick<WithdrawalParts, 'beyondOpen' | 'unmatched'>,
    covers: readonly Cover[],
): { lifted: Cover[]; unmatched: number } {
    const lifted: Cover[] = [];
    for (const part of parts.beyondOpen) {
        let reach = toCents(part.amount);
        for (const cover of covers) {
            if (reach <= 0) break;
            if (cover.creditId !== part.creditId) continue;
            const taken = Math.min(reach, toCents(cover.amount));
            if (taken <= 0) continue;
            lifted.push({ ...cover, amount: taken / 100 });
            reach -= taken;
        }
    }
    const liftedCents = lifted.reduce((sum, each) => sum + toCents(each.amount), 0);
    return { lifted, unmatched: (toCents(parts.unmatched) - liftedCents) / 100 };
}

/**
 * `parts` in the order a reversal of payment `paymentId` takes credits: the
 * credit that payment left first, then the covering ones, the oldest first —
 * so what the gateway gives back returns to them in that order, whatever order
 * a database reads their entries in.
 */
export function inWithdrawalOrder(
    parts: readonly CreditPart[],
    credits: readonly SubscriberCreditRecord[],
    paymentId: string,
): CreditPart[] {
    const byId = new Map(credits.map((credit) => [credit.id, credit]));
    const rank = (part: CreditPart): [number, number, string] => {
        const credit = byId.get(part.creditId);
        if (!credit) return [2, 0, part.creditId];
        return [isOwnCreditOf(credit, paymentId) ? 0 : 1, credit.createdAt.getTime(), credit.id];
    };
    return [...parts].sort((a, b) => {
        const [x, y] = [rank(a), rank(b)];
        return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'en');
    });
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
