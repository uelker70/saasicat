// Where an invoice stands, decided once for the operator's record of a
// subscriber and for the tenant's list alike: the invoices it is linked to by
// a cancellation, and where its payment stands — open, overdue, paid on a day,
// reversed on a day, to be refunded or refunded on a day. Every day is the
// installation's (`SC-ADM-048`, `SC-UI-028`).

import type { InvoiceSettlementRecord } from './invoice-export.types.js';
import { toCents } from './money.js';
import { isOverdueOn } from './open-items.js';
import { REOPENING_SETTLEMENT_KINDS } from './subscriber-payment-mapping.js';
import { owedOn } from './subscriber-payment-rules.js';
import type { SubscriberCreditStanding } from './subscriber-payment.types.js';
import type { SubscriptionInvoiceRecord } from './subscription-invoice.types.js';
import { dayInZone, type CalendarDay } from './zoned-day.js';

/** Another invoice, by the number on its document. */
export interface InvoiceReference {
    invoiceId: string;
    number: string;
}

/**
 * Where an invoice's payment stands. `owed` is what it still owes, of a total
 * the invoice carries; an invoice paid in part is open with less owed than its
 * total. `to-be-refunded` and `refunded` are an invoice whose total is
 * negative: the subscriber is owed its amount, which is paid out of the credit
 * it gave rise to.
 */
export type InvoicePaymentStanding =
    | { kind: 'open'; owed: number; overdue: boolean }
    | { kind: 'reversed'; on: CalendarDay; owed: number; overdue: boolean }
    | { kind: 'paid'; on: CalendarDay }
    | { kind: 'to-be-refunded'; open: number }
    | { kind: 'refunded'; on: CalendarDay };

/**
 * An invoice's standing beside what it corrects, which the invoice itself
 * carries: the cancellation invoice that cancelled it and the replacement that
 * took its place, and where its payment stands — `null` for an invoice
 * cancelled, a cancellation invoice and an invoice of nothing, none of which
 * is paid (`SC-PRIC-095`).
 */
export interface InvoiceStanding {
    cancelledBy: InvoiceReference | null;
    replacedBy: InvoiceReference | null;
    payment: InvoicePaymentStanding | null;
}

/** What of an invoice its standing is read from. */
export type StandingInvoice = Pick<
    SubscriptionInvoiceRecord,
    'id' | 'number' | 'totalGross' | 'dueDate' | 'correction'
>;

/** What the standing of a subscriber's invoices is read from. */
export interface InvoiceStandingSource<I extends StandingInvoice = StandingInvoice> {
    /**
     * The invoices whose standing is asked for, with every cancellation
     * invoice and replacement among them that refers to one of them: a
     * cancellation invoice belongs to the subscriber of the invoice it
     * cancels, so the subscriber's invoices hold both.
     */
    invoices: readonly I[];
    /**
     * Every settlement against any of them, whenever recorded; a payment
     * moved into a replacement is dated by when it settled first.
     */
    settlements: readonly Pick<
        InvoiceSettlementRecord,
        'invoiceId' | 'kind' | 'amount' | 'recordedAt' | 'payment'
    >[];
    /** The subscriber's credits, of which an invoice whose total is negative gave rise to one. */
    credits: readonly SubscriberCreditStanding[];
}

/** The day it is read on and the zone its days are the installation's in. */
export interface InvoiceStandingClock {
    today: CalendarDay;
    timeZone: string;
}

/** Every invoice of `source`, in its order, with its standing. */
export function invoiceStandingsOf<I extends StandingInvoice>(
    source: InvoiceStandingSource<I>,
    clock: InvoiceStandingClock,
): { invoice: I; standing: InvoiceStanding }[] {
    const corrections = correctionsByInvoice(source.invoices);
    const settlements = settlementsByInvoice(source.settlements);
    const firstSettled = firstSettledMoments(source.settlements);
    return source.invoices.map((invoice) => {
        const corrected = corrections.get(invoice.id);
        const cancelledBy = corrected?.cancelledBy ?? null;
        const unpaid = cancelledBy !== null || invoice.correction?.kind === 'cancellation';
        const payment = unpaid
            ? null
            : paymentStandingOf(
                  invoice,
                  settlements.get(invoice.id) ?? [],
                  { firstSettled, credits: source.credits },
                  clock,
              );
        return {
            invoice,
            standing: { cancelledBy, replacedBy: corrected?.replacedBy ?? null, payment },
        };
    });
}

/** The cancellation invoice and the replacement each corrected invoice is named by. */
function correctionsByInvoice(
    invoices: readonly StandingInvoice[],
): Map<string, { cancelledBy?: InvoiceReference; replacedBy?: InvoiceReference }> {
    const corrections = new Map<
        string,
        { cancelledBy?: InvoiceReference; replacedBy?: InvoiceReference }
    >();
    for (const invoice of invoices) {
        if (!invoice.correction) continue;
        const of = invoice.correction.of.invoiceId;
        const reference = { invoiceId: invoice.id, number: invoice.number };
        const known = corrections.get(of) ?? {};
        if (invoice.correction.kind === 'cancellation') known.cancelledBy = reference;
        else known.replacedBy = reference;
        corrections.set(of, known);
    }
    return corrections;
}

type Settlement = InvoiceStandingSource['settlements'][number];

/** Each invoice's settlements, the first recorded first. */
function settlementsByInvoice(settlements: readonly Settlement[]): Map<string, Settlement[]> {
    const byInvoice = new Map<string, Settlement[]>();
    for (const settlement of settlements) {
        const known = byInvoice.get(settlement.invoiceId) ?? [];
        known.push(settlement);
        byInvoice.set(settlement.invoiceId, known);
    }
    for (const known of byInvoice.values()) {
        known.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    }
    return byInvoice;
}

/**
 * When each payment first settled an invoice: a payment a cancellation moved
 * into the replacement arrived then, not on the day it was moved.
 */
function firstSettledMoments(settlements: readonly Settlement[]): Map<string, Date> {
    const first = new Map<string, Date>();
    for (const settlement of settlements) {
        if (settlement.kind !== 'PAYMENT') continue;
        const known = first.get(settlement.payment.id);
        if (!known || settlement.recordedAt < known) {
            first.set(settlement.payment.id, settlement.recordedAt);
        }
    }
    return first;
}

/** What a settlement takes off what its invoice owes; a reversal and a move out add to it. */
function signedAmountOf(settlement: Settlement): number {
    return REOPENING_SETTLEMENT_KINDS.includes(settlement.kind)
        ? -settlement.amount
        : settlement.amount;
}

function paymentStandingOf(
    invoice: StandingInvoice,
    settlements: readonly Settlement[],
    context: { firstSettled: Map<string, Date>; credits: readonly SubscriberCreditStanding[] },
    clock: InvoiceStandingClock,
): InvoicePaymentStanding | null {
    if (invoice.totalGross < 0) return refundStandingOf(invoice, context.credits, clock);
    if (invoice.totalGross === 0) return null;
    const owed = owedOn(invoice.totalGross, settlements.map(signedAmountOf));
    // An invoice owes its total before anything settles, so one that owes
    // nothing was brought there by a settlement.
    const paidBy = owed <= 0 ? lastSettling(invoice.totalGross, settlements) : null;
    if (paidBy) {
        return {
            kind: 'paid',
            on: dayInZone(arrivalOf(paidBy, context.firstSettled), clock.timeZone),
        };
    }
    const overdue = isOverdueOn(invoice.dueDate, clock.today);
    const last = settlements.at(-1);
    if (last?.kind === 'REVERSAL') {
        return { kind: 'reversed', on: dayInZone(last.recordedAt, clock.timeZone), owed, overdue };
    }
    return { kind: 'open', owed, overdue };
}

/**
 * The settlement after which the invoice last came to owe nothing: the one
 * whose arrival is the day it was paid, after a reversal the one that paid it
 * again.
 */
function lastSettling(gross: number, settlements: readonly Settlement[]): Settlement | null {
    let settledBy: Settlement | null = null;
    let owedCents = toCents(gross);
    for (const settlement of settlements) {
        const owedBefore = owedCents;
        owedCents -= toCents(signedAmountOf(settlement));
        if (owedBefore > 0 && owedCents <= 0) settledBy = settlement;
    }
    return settledBy;
}

/** When a settlement's money arrived: a payment moved in by a cancellation, when it settled first. */
function arrivalOf(settlement: Settlement, firstSettled: Map<string, Date>): Date {
    if (settlement.kind !== 'MOVED_IN') return settlement.recordedAt;
    return firstSettled.get(settlement.payment.id) ?? settlement.recordedAt;
}

/**
 * An invoice whose total is negative is refunded once the credit it gave rise
 * to is paid out in full, on the day the last of it left: a payout on the day
 * the operator recorded for it, a refund or a reversal on the day it was
 * recorded. A credit paid out in full ends on such an entry, as a failed
 * refund and a reversal taken back open it again.
 */
function refundStandingOf(
    invoice: StandingInvoice,
    credits: readonly SubscriberCreditStanding[],
    clock: InvoiceStandingClock,
): InvoicePaymentStanding {
    const credit = credits.find(
        ({ credit: { origin } }) => origin.kind === 'invoice' && origin.invoiceId === invoice.id,
    );
    if (!credit) return { kind: 'to-be-refunded', open: -invoice.totalGross };
    const lastOut = [...credit.entries]
        .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
        .at(-1);
    if (credit.open > 0 || !lastOut) return { kind: 'to-be-refunded', open: credit.open };
    return {
        kind: 'refunded',
        on: lastOut.paidOn ?? dayInZone(lastOut.recordedAt, clock.timeZone),
    };
}
