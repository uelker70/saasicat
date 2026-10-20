// What correcting an issued invoice writes (`SC-PRIC-091`): the cancellation
// invoice, which states the cancelled invoice reversed and asks for nothing;
// the replacement for the charges still owed, named by the cancelled invoice's
// parties with what the operator corrected; and how what was paid for the
// cancelled invoice moves onto the replacement, each payment's share apart,
// the oldest first, and what the replacement does not take as a credit.
//
// Pure. The caller holds the chain's turn while it reads what these take and
// writes what they answer (`SC-PRIC-036`).

import { toCents, type TaxPerRate } from './money.js';
import type { SubscriberCorrectionRecord } from './subscriber.types.js';
import {
    INVOICE_SUBSCRIBER_DETAILS,
    type InvoiceSubscriberDetail,
    type NewCorrectionInvoice,
    type SubscriptionInvoiceChain,
    type SubscriptionInvoiceIssuer,
    type SubscriptionInvoicePayment,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceSubscriber,
    type CorrectedInvoiceSubscriber,
} from './subscription-invoice.types.js';
import type { InvoiceTaxLine, TaxTreatment } from './tax.types.js';
import { addDaysToDay, dayInZone, yearOfDay } from './zoned-day.js';

/** `amount` taken the other way: nothing stays nothing, rather than minus nothing. */
function reversed(amount: number): number {
    return amount === 0 ? 0 : -amount;
}

/** Where a cancellation and its replacement are issued: when, in which zone, under which prefix. */
export interface CorrectionIssue {
    issuedAt: Date;
    /** The installation's time zone, which the days the invoices state are read in (`SC-PRIC-045`). */
    timeZone: string;
    numberPrefix: string;
}

/**
 * The cancellation invoice of `cancelled`: the same parties, treatment, footer
 * and service period, its figures reversed so that the two add up to nothing,
 * each line naming the line it cancels. It asks for nothing, so it is collected
 * with nothing and falls due on the day it is issued (`SC-PRIC-089`).
 */
export function draftCancellationInvoice(
    cancelled: SubscriptionInvoiceRecord,
    issue: CorrectionIssue,
): NewCorrectionInvoice {
    const issueDate = dayInZone(issue.issuedAt, issue.timeZone);
    return {
        numberPrefix: issue.numberPrefix,
        numberYear: yearOfDay(issueDate),
        tenantId: cancelled.tenantId,
        subscriberId: cancelled.subscriberId,
        subscriptionId: cancelled.subscriptionId,
        contractId: cancelled.contractId,
        issuedAt: issue.issuedAt,
        issueDate,
        dueDate: issueDate,
        payment: null,
        collectionDate: null,
        servicePeriodFrom: cancelled.servicePeriodFrom,
        servicePeriodUntil: cancelled.servicePeriodUntil,
        currency: cancelled.currency,
        issuer: { ...cancelled.issuer },
        subscriber: { ...cancelled.subscriber },
        footer: [...cancelled.footer],
        taxTreatment: cancelled.taxTreatment,
        taxes: cancelled.taxes.map((entry) => ({
            rate: entry.rate,
            net: reversed(entry.net),
            tax: reversed(entry.tax),
        })),
        totalNet: reversed(cancelled.totalNet),
        totalTax: reversed(cancelled.totalTax),
        totalGross: reversed(cancelled.totalGross),
        paidOnIssue: 0,
        lines: cancelled.lines.map((line) => ({
            position: line.position,
            chargeId: line.chargeId,
            contractLineItemId: line.contractLineItemId,
            title: line.title,
            origin: line.origin,
            source: line.source,
            periodFrom: line.periodFrom,
            periodUntil: line.periodUntil,
            amountNet: reversed(line.amountNet),
            taxRate: line.taxRate,
            correctedPosition: line.position,
        })),
    };
}

/** What the replacement of an invoice is issued with, beyond the invoice it replaces. */
export interface ReplacementIssue extends CorrectionIssue {
    /**
     * The subscriber it names: the cancelled invoice's, with a correction of its
     * legal identity since and what the operator corrected (`SC-PRIC-091`).
     */
    subscriber: SubscriptionInvoiceSubscriber;
    /** The issuer it names: the cancelled invoice's, with a declared correction since (`SC-PRIC-092`). */
    issuer: SubscriptionInvoiceIssuer;
    /** The footer lines `config/saas.yaml` names on its issue date for that issuer (`SC-PRIC-093`). */
    footer: readonly string[];
    /** The treatment the tax adapter decides for the parties it names, over its service period. */
    treatment: TaxTreatment;
    /** The adapter's rule for the tax of an invoice (`SC-PRIC-041`). */
    tax: (lines: readonly InvoiceTaxLine[]) => TaxPerRate;
    /** Days from the issue date to the due date, unless collected by direct debit (`SC-PRIC-046`). */
    paymentTermDays: number;
    /** Days from the issue date to the day a direct debit is collected (`SC-PRIC-028`). */
    directDebitLeadDays: number;
    /** The subscriber's payment method in use, as `invoicePaymentOf` records it, or `null`. */
    payment: SubscriptionInvoicePayment | null;
    /** What was paid for the cancelled invoice and moves onto the replacement, before it takes it: `paidByShares`. */
    paid: number;
}

/**
 * The replacement of `cancelled` for its charges, each line naming the line it
 * replaces. Its tax is the treatment decided for the parties it names; it takes
 * over what was paid for the cancelled invoice, as far as it owes it, and
 * states that as paid; only what remains is collected, and announced where a
 * direct debit collects it (`SC-PRIC-091`, `SC-PRIC-028`). Its payment term runs
 * from its own issue date.
 */
export function draftReplacementInvoice(
    cancelled: SubscriptionInvoiceRecord,
    issue: ReplacementIssue,
): NewCorrectionInvoice {
    const issueDate = dayInZone(issue.issuedAt, issue.timeZone);
    const lines = cancelled.lines.map((line) => ({
        position: line.position,
        chargeId: line.chargeId,
        contractLineItemId: line.contractLineItemId,
        title: line.title,
        origin: line.origin,
        source: line.source,
        periodFrom: line.periodFrom,
        periodUntil: line.periodUntil,
        amountNet: line.amountNet,
        taxRate: issue.treatment.rate,
        correctedPosition: line.position,
    }));
    const tax = issue.tax(lines.map((line) => ({ net: line.amountNet, rate: line.taxRate })));
    const paidOnIssue =
        Math.min(Math.max(0, toCents(issue.paid)), Math.max(0, toCents(tax.gross))) / 100;
    const owed = toCents(tax.gross) - toCents(paidOnIssue);
    const payment = owed > 0 ? issue.payment : null;
    const collectionDate =
        payment?.type === 'sepa_debit' ? addDaysToDay(issueDate, issue.directDebitLeadDays) : null;
    return {
        numberPrefix: issue.numberPrefix,
        numberYear: yearOfDay(issueDate),
        tenantId: cancelled.tenantId,
        subscriberId: cancelled.subscriberId,
        subscriptionId: cancelled.subscriptionId,
        contractId: cancelled.contractId,
        issuedAt: issue.issuedAt,
        issueDate,
        dueDate: collectionDate ?? addDaysToDay(issueDate, issue.paymentTermDays),
        payment: payment ? { ...payment } : null,
        collectionDate,
        servicePeriodFrom: cancelled.servicePeriodFrom,
        servicePeriodUntil: cancelled.servicePeriodUntil,
        currency: cancelled.currency,
        issuer: { ...issue.issuer },
        subscriber: { ...issue.subscriber },
        footer: [...issue.footer],
        taxTreatment: issue.treatment,
        taxes: tax.rates,
        totalNet: tax.net,
        totalTax: tax.tax,
        totalGross: tax.gross,
        paidOnIssue,
        lines,
    };
}

/**
 * The subscriber a replacement names before the operator corrects anything:
 * the cancelled invoice's, with each correction of the subscriber's legal
 * identity recorded after `issuedAt` applied, the oldest first (`SC-SUB-017`).
 * What else the record changed since — an address, an email — stays as the
 * invoice named it: the charges are owed between the parties of their contract.
 */
export function subscriberCorrectedSince(
    subscriber: SubscriptionInvoiceSubscriber,
    corrections: readonly Pick<SubscriberCorrectionRecord, 'corrected' | 'correctedAt'>[],
    issuedAt: Date,
): SubscriptionInvoiceSubscriber {
    const next: SubscriptionInvoiceSubscriber = { ...subscriber };
    const since = corrections
        .filter((correction) => correction.correctedAt.getTime() > issuedAt.getTime())
        .sort((a, b) => a.correctedAt.getTime() - b.correctedAt.getTime());
    for (const { corrected } of since) {
        if (corrected.legalName !== undefined) next.legalName = corrected.legalName;
        if (corrected.vatId !== undefined) next.vatId = corrected.vatId;
        if (corrected.taxNumber !== undefined) next.taxNumber = corrected.taxNumber;
    }
    return next;
}

/**
 * The subscriber `invoice` names with the operator's corrections, and those
 * corrections as the cancellation records them: each with the value it
 * replaced. A detail given as it already stands is no correction.
 */
export function correctedSubscriberOf(
    subscriber: SubscriptionInvoiceSubscriber,
    corrections: Partial<Record<InvoiceSubscriberDetail, string | null>>,
): { subscriber: SubscriptionInvoiceSubscriber; corrected: CorrectedInvoiceSubscriber | null } {
    const next: SubscriptionInvoiceSubscriber = { ...subscriber };
    const corrected: CorrectedInvoiceSubscriber = {};
    for (const field of INVOICE_SUBSCRIBER_DETAILS) {
        const value = corrections[field];
        if (value === undefined || value === subscriber[field]) continue;
        if (field === 'legalName') {
            // A party is never named by nothing.
            if (value === null) continue;
            next.legalName = value;
        } else {
            next[field] = value;
        }
        corrected[field] = { previous: subscriber[field], corrected: value };
    }
    return {
        subscriber: next,
        corrected: Object.keys(corrected).length > 0 ? corrected : null,
    };
}

/** What a payment settles of an invoice, as a cancellation of it reads it. */
export interface InvoicePaymentShare {
    paymentId: string;
    /** When the gateway's confirmation was recorded: the order the shares move in. */
    recordedAt: Date;
    /** What the payment still settles there: its settlements, less what reversals took back. */
    amount: number;
}

/**
 * Each payment's share of an invoice from its settlements there — each signed
 * as `settledAmountOf` reads it, so a reversal and an earlier move take back
 * what they took —, with when the payment was recorded. A payment whose
 * settlements there come to nothing has no share.
 */
export function paymentSharesOf(
    settlements: readonly { paymentId: string; amount: number }[],
    recordedAt: ReadonlyMap<string, Date>,
): InvoicePaymentShare[] {
    const cents = new Map<string, number>();
    for (const settlement of settlements) {
        cents.set(
            settlement.paymentId,
            (cents.get(settlement.paymentId) ?? 0) + toCents(settlement.amount),
        );
    }
    const shares: InvoicePaymentShare[] = [];
    for (const [paymentId, amount] of cents) {
        const at = recordedAt.get(paymentId);
        if (!at) throw new Error(`Payment ${paymentId} settles an invoice and was not read.`);
        if (amount !== 0) shares.push({ paymentId, recordedAt: at, amount: amount / 100 });
    }
    return shares;
}

/** How one payment's share of a cancelled invoice moves. */
export interface MovedPaymentPart {
    paymentId: string;
    /** Taken off the cancelled invoice: the whole share. */
    movedOut: number;
    /** Settled on the replacement. */
    movedIn: number;
    /** What the replacement did not take, credited to the subscriber. */
    credited: number;
}

/** Whether a share brings anything to move: one at or below nothing moves nothing. */
const bringsSomething = (share: InvoicePaymentShare): boolean => toCents(share.amount) > 0;

/**
 * What the shares of a cancelled invoice bring to its replacement — the
 * shares that move, as `movedPaymentParts` moves them —, which the replacement
 * states as paid on issue as far as it owes it (`ReplacementIssue.paid`). So
 * what the document states as paid is what moves onto it, and its amount due
 * is what is collected.
 */
export function paidByShares(shares: readonly InvoicePaymentShare[]): number {
    return (
        shares.filter(bringsSomething).reduce((sum, share) => sum + toCents(share.amount), 0) / 100
    );
}

/**
 * How each payment's share of a cancelled invoice moves onto its replacement,
 * which owes `replacementOwes` (`SC-PRIC-091`): in the order the payments were
 * confirmed, the oldest first, each settling the replacement as far as it still
 * owes, so that what remains of the most recent ones is credited. Without a
 * replacement, every share is credited. A share of nothing moves nothing.
 */
export function movedPaymentParts(
    shares: readonly InvoicePaymentShare[],
    replacementOwes: number,
): MovedPaymentPart[] {
    let owes = Math.max(0, toCents(replacementOwes));
    return [...shares]
        .sort(
            (a, b) =>
                a.recordedAt.getTime() - b.recordedAt.getTime() ||
                a.paymentId.localeCompare(b.paymentId, 'en'),
        )
        .filter(bringsSomething)
        .map((share) => {
            const cents = toCents(share.amount);
            const movedIn = Math.min(cents, owes);
            owes -= movedIn;
            return {
                paymentId: share.paymentId,
                movedOut: cents / 100,
                movedIn: movedIn / 100,
                credited: (cents - movedIn) / 100,
            };
        });
}

/**
 * The invoice of a chain that stands: the last replacement, or the first
 * invoice where none was cancelled. A chain whose last cancellation left no
 * replacement has none standing: what it invoiced is owed no more.
 */
export function standingInvoiceOf(
    chain: SubscriptionInvoiceChain,
): SubscriptionInvoiceRecord | null {
    const cancelled = new Set(chain.cancellations.map((each) => each.cancelledInvoiceId));
    const cancellations = new Set(chain.cancellations.map((each) => each.cancellationInvoiceId));
    return (
        [...chain.invoices]
            .sort((a, b) => b.chainStep - a.chainStep)
            .find((invoice) => !cancelled.has(invoice.id) && !cancellations.has(invoice.id)) ?? null
    );
}
