// Canonical row -> record mapping for invoices. Pure, and shared by both
// adapters for the reason `subscription-contract-mapping.ts` gives.
//
// An invoice is read back defensively: it is a document kept for years, read by
// releases that did not write it, and a party, a treatment or a tax figure of
// the wrong shape must fail loudly here rather than reach a rendered invoice as
// a blank or a zero.

import { oneOf } from './closed-value.js';
import { dayOf, type ColumnWhere } from './column-day.js';
import type { LegalIdentity, PartyAddress } from './legal-identity.js';
import type { TaxAtRate } from './money.js';
import {
    CORRECTION_ORIGIN,
    SUBSCRIBER_CHARGE_ORIGINS,
    SUBSCRIBER_CHARGE_SOURCES,
} from './subscriber-ledger-mapping.js';
import { PAYMENT_METHOD_TYPES } from './subscriber-payment-method-mapping.js';
import {
    INVOICE_SUBSCRIBER_DETAILS,
    type CorrectedInvoiceSubscriber,
    type NewCorrectionInvoice,
    type NewCorrectionInvoiceLine,
    type NewSubscriptionInvoice,
    type NewSubscriptionInvoiceCancellation,
    type NewSubscriptionInvoiceLine,
    type SubscriptionInvoiceCancellationRecord,
    type SubscriptionInvoiceChain,
    type SubscriptionInvoiceCorrection,
    type SubscriptionInvoiceIssuer,
    type SubscriptionInvoiceLineRecord,
    type SubscriptionInvoicePayment,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceSubscriber,
} from './subscription-invoice.types.js';
import { taxTreatmentToJson, toTaxTreatment } from './tax-origin.js';
import type { CalendarDay } from './zoned-day.js';

const INVOICES = 'subscription_invoices';
const LINES = 'subscription_invoice_lines';
const CANCELLATIONS = 'subscription_invoice_cancellations';

/** How far from a whole number of cents float arithmetic may leave a rounded amount. */
const CENT_TOLERANCE = 1e-6;

/**
 * A `subscription_invoices` row as either adapter reads it back. Amounts are
 * `unknown` because a Prisma row carries a `Decimal` where a Drizzle row carries
 * a numeric string, and days because one carries a `Date` at midnight UTC where
 * the other carries the text.
 */
export interface CanonicalSubscriptionInvoiceRow {
    id: string;
    number: string;
    numberPrefix: string;
    numberYear: number;
    numberSequence: number;
    tenantId: string;
    subscriberId: string;
    subscriptionId: string;
    contractId: string;
    chainId: string;
    chainStep: number;
    issuedAt: Date;
    issueDate: unknown;
    dueDate: unknown;
    servicePeriodFrom: unknown;
    servicePeriodUntil: unknown;
    /** `null` on an invoice that is not collected, and on one issued before invoices recorded it. */
    payment: unknown;
    collectionDate: unknown;
    currency: string;
    issuerParty: unknown;
    subscriberParty: unknown;
    footer: unknown;
    taxTreatment: unknown;
    taxes: unknown;
    totalNet: unknown;
    totalTax: unknown;
    totalGross: unknown;
    paidOnIssue: unknown;
    createdAt: Date;
}

/** A `subscription_invoice_lines` row as either adapter reads it back. */
export interface CanonicalSubscriptionInvoiceLineRow {
    id: string;
    invoiceId: string;
    position: number;
    chargeId: string;
    contractLineItemId: string;
    title: string;
    origin: string;
    source: string;
    periodFrom: unknown;
    periodUntil: unknown;
    amountNet: unknown;
    taxRate: unknown;
    correctedPosition: number | null;
    correctsPosition: number | null;
}

/** A `subscription_invoice_cancellations` row as either adapter reads it back. */
export interface CanonicalSubscriptionInvoiceCancellationRow {
    id: string;
    cancelledInvoiceId: string;
    cancellationInvoiceId: string;
    replacementInvoiceId: string | null;
    reason: string;
    correctedSubscriber: unknown;
    deliverTo: string | null;
    cancelledBy: string;
    cancelledAt: Date;
}

/**
 * The cancellation an invoice row takes part in as the cancellation invoice or
 * the replacement, and the invoice it cancels as that row reads: what a store
 * hands `toSubscriptionInvoiceRecord` for the row to say what it corrects.
 */
export interface CanonicalInvoiceCorrection {
    cancellation: CanonicalSubscriptionInvoiceCancellationRow;
    cancelled: { id: string; number: string; issueDate: unknown };
}

/**
 * Reads an invoice row and its lines back as a record, the lines in their
 * order. `correction` is the cancellation the row is the cancellation invoice
 * or the replacement of, with the invoice it cancels; `null` for any other row.
 */
export function toSubscriptionInvoiceRecord(
    row: CanonicalSubscriptionInvoiceRow,
    lines: readonly CanonicalSubscriptionInvoiceLineRow[],
    correction: CanonicalInvoiceCorrection | null = null,
): SubscriptionInvoiceRecord {
    const where = (column: string) => ({ table: INVOICES, column, id: row.id });
    const treatment = toTaxTreatment(row.taxTreatment);
    if (!treatment) {
        throw new Error(`${INVOICES}.taxTreatment of ${row.id} is not a tax treatment.`);
    }
    const dueDate = dayOf(row.dueDate, where('dueDate'));
    return {
        id: row.id,
        number: row.number,
        numberPrefix: row.numberPrefix,
        numberYear: row.numberYear,
        numberSequence: row.numberSequence,
        tenantId: row.tenantId,
        subscriberId: row.subscriberId,
        subscriptionId: row.subscriptionId,
        contractId: row.contractId,
        chainId: row.chainId,
        chainStep: row.chainStep,
        issuedAt: row.issuedAt,
        issueDate: dayOf(row.issueDate, where('issueDate')),
        dueDate,
        servicePeriodFrom: dayOf(row.servicePeriodFrom, where('servicePeriodFrom')),
        servicePeriodUntil: dayOf(row.servicePeriodUntil, where('servicePeriodUntil')),
        ...collectionOf(row.payment, row.collectionDate, dueDate, where),
        currency: row.currency,
        issuer: issuerOf(row.issuerParty, where('issuerParty')),
        subscriber: subscriberOf(row.subscriberParty, where('subscriberParty')),
        footer: footerOf(row.footer, where('footer')),
        taxTreatment: treatment,
        taxes: taxesOf(row.taxes, where('taxes')),
        totalNet: amountOf(row.totalNet, where('totalNet')),
        totalTax: amountOf(row.totalTax, where('totalTax')),
        totalGross: amountOf(row.totalGross, where('totalGross')),
        paidOnIssue: amountOf(row.paidOnIssue, where('paidOnIssue')),
        lines: [...lines]
            .sort((a, b) => a.position - b.position)
            .map((line) => toSubscriptionInvoiceLineRecord(line)),
        correction: correction && correctionOf(row.id, correction),
        createdAt: row.createdAt,
    };
}

/**
 * What an invoice row corrects, read from the cancellation it takes part in. A
 * cancellation the row is neither the cancellation invoice nor the replacement
 * of was handed the wrong way, and is refused rather than read as one.
 */
function correctionOf(
    invoiceId: string,
    { cancellation, cancelled }: CanonicalInvoiceCorrection,
): SubscriptionInvoiceCorrection {
    const kind =
        cancellation.cancellationInvoiceId === invoiceId
            ? 'cancellation'
            : cancellation.replacementInvoiceId === invoiceId
              ? 'replacement'
              : null;
    if (kind === null || cancelled.id !== cancellation.cancelledInvoiceId) {
        throw new Error(
            `${CANCELLATIONS} row ${cancellation.id} was read for invoice ${invoiceId}, which it ` +
                'neither cancels with nor replaces with.',
        );
    }
    return {
        kind,
        of: {
            invoiceId: cancelled.id,
            number: cancelled.number,
            issueDate: dayOf(cancelled.issueDate, {
                table: INVOICES,
                column: 'issueDate',
                id: cancelled.id,
            }),
        },
        reason: cancellation.reason,
    };
}

/**
 * A chain as a store hands it back (`SubscriptionInvoiceRepository.holdChain`):
 * its invoices by their step, and each cancellation in the order of the invoice
 * it cancels — the order they were written in, which no clock can tie.
 */
export function subscriptionInvoiceChainOf(
    invoices: readonly SubscriptionInvoiceRecord[],
    cancellations: readonly SubscriptionInvoiceCancellationRecord[],
): SubscriptionInvoiceChain {
    const ordered = [...invoices].sort((a, b) => a.chainStep - b.chainStep);
    const stepOf = new Map(ordered.map((invoice) => [invoice.id, invoice.chainStep]));
    const step = (cancellation: SubscriptionInvoiceCancellationRecord) => {
        const found = stepOf.get(cancellation.cancelledInvoiceId);
        if (found === undefined) {
            throw new Error(
                `${CANCELLATIONS} row ${cancellation.id} was read with a chain that does not hold ` +
                    `invoice ${cancellation.cancelledInvoiceId}.`,
            );
        }
        return found;
    };
    return {
        invoices: ordered,
        cancellations: [...cancellations].sort((a, b) => step(a) - step(b)),
    };
}

/** Reads a cancellation back, with what it corrected checked to be details of a subscriber. */
export function toSubscriptionInvoiceCancellationRecord(
    row: CanonicalSubscriptionInvoiceCancellationRow,
): SubscriptionInvoiceCancellationRecord {
    return {
        id: row.id,
        cancelledInvoiceId: row.cancelledInvoiceId,
        cancellationInvoiceId: row.cancellationInvoiceId,
        replacementInvoiceId: row.replacementInvoiceId,
        reason: row.reason,
        correctedSubscriber: correctedSubscriberFrom(row.correctedSubscriber, row.id),
        deliverTo: row.deliverTo,
        cancelledBy: row.cancelledBy,
        cancelledAt: row.cancelledAt,
    };
}

function correctedSubscriberFrom(value: unknown, id: string): CorrectedInvoiceSubscriber | null {
    if (value === null || value === undefined) return null;
    const where = { table: CANCELLATIONS, column: 'correctedSubscriber', id };
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${where.table}.${where.column} of ${id} is not a set of corrections.`);
    }
    const corrected: CorrectedInvoiceSubscriber = {};
    for (const [field, change] of Object.entries(value)) {
        const detail = oneOf(INVOICE_SUBSCRIBER_DETAILS, field, where);
        if (change === null || typeof change !== 'object' || Array.isArray(change)) {
            throw new Error(
                `${where.table}.${where.column}.${field} of ${id} is not a correction.`,
            );
        }
        corrected[detail] = {
            previous: textOrNull(change, 'previous', where),
            corrected: textOrNull(change, 'corrected', where),
        };
    }
    return corrected;
}

function toSubscriptionInvoiceLineRecord(
    row: CanonicalSubscriptionInvoiceLineRow,
): SubscriptionInvoiceLineRecord {
    const where = (column: string) => ({ table: LINES, column, id: row.id });
    return {
        id: row.id,
        invoiceId: row.invoiceId,
        position: row.position,
        chargeId: row.chargeId,
        contractLineItemId: row.contractLineItemId,
        title: row.title,
        origin: oneOf(SUBSCRIBER_CHARGE_ORIGINS, row.origin, where('origin')),
        source: oneOf(SUBSCRIBER_CHARGE_SOURCES, row.source, where('source')),
        periodFrom: dayOf(row.periodFrom, where('periodFrom')),
        periodUntil: dayOf(row.periodUntil, where('periodUntil')),
        amountNet: amountOf(row.amountNet, where('amountNet')),
        taxRate: amountOf(row.taxRate, where('taxRate')),
        correctedPosition: row.correctedPosition,
        correctsPosition: correctsPositionOf(row),
    };
}

/**
 * The position a line corrects, checked against its origin: a correction's
 * line names the line on its invoice whose charge it corrects, and no other
 * line names one — the same rule the database holds
 * (`subscription_invoice_lines_correction_names_its_line`).
 */
function correctsPositionOf(row: CanonicalSubscriptionInvoiceLineRow): number | null {
    if ((row.origin === CORRECTION_ORIGIN) === (row.correctsPosition !== null)) {
        return row.correctsPosition;
    }
    throw new Error(
        `${LINES} row '${row.id}' is a ${row.origin} line ` +
            (row.correctsPosition === null
                ? 'naming no line it corrects; a correction names the line whose charge it corrects.'
                : `naming position ${row.correctsPosition} as the line it corrects; only a correction does.`),
    );
}

/**
 * The columns an invoice is written with: amounts as decimal strings of two
 * places, as a charge's are, and days as their text, which each adapter turns
 * into what its date column takes.
 */
export interface SubscriptionInvoiceColumns {
    id: string;
    number: string;
    numberPrefix: string;
    numberYear: number;
    numberSequence: number;
    tenantId: string;
    subscriberId: string;
    subscriptionId: string;
    contractId: string;
    chainId: string;
    chainStep: number;
    issuedAt: Date;
    issueDate: CalendarDay;
    dueDate: CalendarDay;
    servicePeriodFrom: CalendarDay;
    servicePeriodUntil: CalendarDay;
    payment: SubscriptionInvoicePayment | null;
    collectionDate: CalendarDay | null;
    currency: string;
    issuerParty: SubscriptionInvoiceIssuer;
    subscriberParty: SubscriptionInvoiceSubscriber;
    footer: string[];
    taxTreatment: Record<string, unknown>;
    taxes: TaxAtRate[];
    totalNet: string;
    totalTax: string;
    totalGross: string;
    paidOnIssue: string;
}

/** The columns a line is written with, in the form `SubscriptionInvoiceColumns` describes. */
export interface SubscriptionInvoiceLineColumns {
    invoiceId: string;
    chainStep: number;
    correctedPosition: number | null;
    correctsPosition: number | null;
    position: number;
    chargeId: string;
    contractLineItemId: string;
    title: string;
    origin: string;
    source: string;
    periodFrom: CalendarDay;
    periodUntil: CalendarDay;
    amountNet: string;
    taxRate: string;
}

/** Where the store places an invoice it writes: its id, the number it drew, its chain. */
export interface PlacedInvoice {
    id: string;
    number: string;
    numberSequence: number;
    /** The invoice's own id for an invoice issued on the journal's charges. */
    chainId: string;
    chainStep: number;
}

/**
 * The columns an invoice is written with, as the store placed it. An invoice
 * issued on the journal's charges was paid nothing on issue.
 */
export function subscriptionInvoiceColumns(
    invoice: NewSubscriptionInvoice | NewCorrectionInvoice,
    placed: PlacedInvoice,
): SubscriptionInvoiceColumns {
    return {
        id: placed.id,
        number: placed.number,
        numberPrefix: invoice.numberPrefix,
        numberYear: invoice.numberYear,
        numberSequence: placed.numberSequence,
        tenantId: invoice.tenantId,
        subscriberId: invoice.subscriberId,
        subscriptionId: invoice.subscriptionId,
        contractId: invoice.contractId,
        chainId: placed.chainId,
        chainStep: placed.chainStep,
        issuedAt: invoice.issuedAt,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        servicePeriodFrom: invoice.servicePeriodFrom,
        servicePeriodUntil: invoice.servicePeriodUntil,
        payment: invoice.payment ? { ...invoice.payment } : null,
        collectionDate: invoice.collectionDate,
        currency: invoice.currency,
        issuerParty: { ...invoice.issuer },
        subscriberParty: { ...invoice.subscriber },
        footer: [...invoice.footer],
        taxTreatment: taxTreatmentToJson(invoice.taxTreatment),
        taxes: invoice.taxes.map((entry) => ({ rate: entry.rate, net: entry.net, tax: entry.tax })),
        totalNet: centsText(invoice.totalNet, 'totalNet'),
        totalTax: centsText(invoice.totalTax, 'totalTax'),
        totalGross: centsText(invoice.totalGross, 'totalGross'),
        paidOnIssue: centsText('paidOnIssue' in invoice ? invoice.paidOnIssue : 0, 'paidOnIssue'),
    };
}

/**
 * The position a line to write corrects, refused where it does not fit its
 * origin: a correction's line names the line whose charge it corrects, no
 * other line names one, and a line of an invoice the run issues corrects
 * nothing — the same rule `correctsPositionOf` reads by.
 */
function correctsPositionColumnOf(
    line: NewSubscriptionInvoiceLine | NewCorrectionInvoiceLine,
): number | null {
    const corrects = 'correctsPosition' in line ? line.correctsPosition : null;
    if ((line.origin === CORRECTION_ORIGIN) === (corrects !== null)) return corrects;
    throw new Error(
        `A ${line.origin} line at position ${line.position} is written ` +
            (corrects === null
                ? 'naming no line it corrects; a correction names the line whose charge it corrects.'
                : `naming position ${corrects} as the line it corrects; only a correction does.`),
    );
}

/** The columns a line is written with, at its invoice's step of the chain. */
export function subscriptionInvoiceLineColumns(
    line: NewSubscriptionInvoiceLine | NewCorrectionInvoiceLine,
    invoiceId: string,
    chainStep: number,
): SubscriptionInvoiceLineColumns {
    return {
        invoiceId,
        chainStep,
        correctedPosition: 'correctedPosition' in line ? line.correctedPosition : null,
        correctsPosition: correctsPositionColumnOf(line),
        position: line.position,
        chargeId: line.chargeId,
        contractLineItemId: line.contractLineItemId,
        title: line.title,
        origin: line.origin,
        source: line.source,
        periodFrom: line.periodFrom,
        periodUntil: line.periodUntil,
        amountNet: centsText(line.amountNet, 'amountNet'),
        taxRate: centsText(line.taxRate, 'taxRate'),
    };
}

/** The columns a cancellation is written with, given the invoices the store wrote for it. */
export interface SubscriptionInvoiceCancellationColumns {
    id: string;
    cancelledInvoiceId: string;
    cancellationInvoiceId: string;
    replacementInvoiceId: string | null;
    reason: string;
    correctedSubscriber: CorrectedInvoiceSubscriber | null;
    deliverTo: string | null;
    cancelledBy: string;
    cancelledAt: Date;
}

export function subscriptionInvoiceCancellationColumns(
    write: NewSubscriptionInvoiceCancellation,
    written: { id: string; cancellationInvoiceId: string; replacementInvoiceId: string | null },
): SubscriptionInvoiceCancellationColumns {
    return {
        id: written.id,
        cancelledInvoiceId: write.cancelledInvoiceId,
        cancellationInvoiceId: written.cancellationInvoiceId,
        replacementInvoiceId: written.replacementInvoiceId,
        reason: write.reason,
        correctedSubscriber: write.correctedSubscriber && { ...write.correctedSubscriber },
        deliverTo: write.deliverTo,
        cancelledBy: write.cancelledBy,
        cancelledAt: write.cancelledAt,
    };
}

/** A day as the `Date` at midnight UTC a Prisma `@db.Date` column takes. */
export function utcMidnightOf(day: CalendarDay): Date {
    return new Date(`${day}T00:00:00.000Z`);
}

type Where = ColumnWhere;

/**
 * How the invoice is paid, read together because each half answers for the
 * other: a direct debit is announced with its mandate reference and the day it
 * is collected (`SC-PRIC-028`), on which it falls due (`SC-PRIC-046`), and
 * nothing else has a collection date. A row that breaks any of it is not an
 * invoice a collection may act on, and its document would announce one day
 * and name another as due.
 */
function collectionOf(
    payment: unknown,
    collectionDate: unknown,
    dueDate: CalendarDay,
    where: (column: string) => Where,
): Pick<SubscriptionInvoiceRecord, 'payment' | 'collectionDate'> {
    const paymentAt = where('payment');
    // A column the adapter did not read would otherwise pass for an invoice
    // that is not collected.
    if (payment === undefined || collectionDate === undefined) {
        throw new Error(
            `${paymentAt.table} row ${paymentAt.id} was read without its payment or its collection date.`,
        );
    }
    if (payment === null) {
        if (collectionDate !== null) {
            throw new Error(
                `${paymentAt.table}.collectionDate of ${paymentAt.id} is set on an invoice that is not collected.`,
            );
        }
        return { payment: null, collectionDate: null };
    }
    if (typeof payment !== 'object' || Array.isArray(payment)) {
        throw new Error(`${paymentAt.table}.payment of ${paymentAt.id} is not a payment method.`);
    }
    const required = (key: string): string => {
        const value = textOrNull(payment, key, paymentAt);
        if (value === null) {
            throw new Error(`${paymentAt.table}.payment of ${paymentAt.id} names no ${key}.`);
        }
        return value;
    };
    const type = oneOf(PAYMENT_METHOD_TYPES, required('type'), {
        ...paymentAt,
        column: 'payment.type',
    });
    const recorded: SubscriptionInvoicePayment = {
        paymentMethodId: required('paymentMethodId'),
        gatewayAccount: required('gatewayAccount'),
        type,
        brand: textOrNull(payment, 'brand', paymentAt),
        last4: required('last4'),
        mandateReference: type === 'sepa_debit' ? required('mandateReference') : null,
    };
    if (type !== 'sepa_debit') {
        if (collectionDate !== null) {
            throw new Error(
                `${paymentAt.table}.collectionDate of ${paymentAt.id} is set on an invoice paid by ${type}.`,
            );
        }
        return { payment: recorded, collectionDate: null };
    }
    const collected = dayOf(collectionDate, where('collectionDate'));
    if (collected !== dueDate) {
        throw new Error(
            `${paymentAt.table}.dueDate of ${paymentAt.id} is ${dueDate}, and a direct debit falls due ` +
                `on the day it is collected, ${collected}.`,
        );
    }
    return { payment: recorded, collectionDate: collected };
}

function footerOf(value: unknown, where: Where): string[] {
    if (!Array.isArray(value) || !value.every((line) => typeof line === 'string')) {
        throw new Error(`${where.table}.${where.column} of ${where.id} is not a list of lines.`);
    }
    return [...value];
}

function amountOf(value: unknown, where: Where): number {
    // oxlint-disable-next-line typescript/no-base-to-string -- Prisma hands a Decimal, whose text is the number; any other object becomes NaN and is refused below
    const amount = Number(value === null || value === undefined ? NaN : String(value));
    if (!Number.isFinite(amount)) {
        throw new Error(`${where.table}.${where.column} of ${where.id} is not an amount.`);
    }
    return amount;
}

function centsText(amount: number, field: string): string {
    const cents = amount * 100;
    if (!Number.isFinite(cents) || Math.abs(cents - Math.round(cents)) > CENT_TOLERANCE) {
        throw new Error(
            `An invoice's ${field} of ${amount} is not a whole number of cents; ` +
                'it is rounded once, where the invoice is drafted, before it is written.',
        );
    }
    return amount.toFixed(2);
}

/** The field `key` of a JSON object as it was read, `undefined` where it has none. */
function fieldOf(source: object, key: string): unknown {
    const field: unknown = Object.getOwnPropertyDescriptor(source, key)?.value;
    return field;
}

function textOrNull(source: object, key: string, where: Where): string | null {
    const value = fieldOf(source, key);
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') {
        throw new Error(`${where.table}.${where.column}.${key} of ${where.id} is not text.`);
    }
    return value;
}

function partyOf(value: unknown, where: Where): LegalIdentity & PartyAddress {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${where.table}.${where.column} of ${where.id} is not a party.`);
    }
    const source = value as Record<string, unknown>;
    const legalName = textOrNull(source, 'legalName', where);
    if (legalName === null) {
        throw new Error(`${where.table}.${where.column} of ${where.id} names no legal name.`);
    }
    return {
        legalName,
        vatId: textOrNull(source, 'vatId', where),
        taxNumber: textOrNull(source, 'taxNumber', where),
        addressLine1: textOrNull(source, 'addressLine1', where),
        addressLine2: textOrNull(source, 'addressLine2', where),
        postalCode: textOrNull(source, 'postalCode', where),
        city: textOrNull(source, 'city', where),
        country: textOrNull(source, 'country', where),
    };
}

function issuerOf(value: unknown, where: Where): SubscriptionInvoiceIssuer {
    return partyOf(value, where);
}

function subscriberOf(value: unknown, where: Where): SubscriptionInvoiceSubscriber {
    const party = partyOf(value, where);
    const customerNumber = textOrNull(value as Record<string, unknown>, 'customerNumber', where);
    if (customerNumber === null) {
        throw new Error(`${where.table}.${where.column} of ${where.id} names no customer number.`);
    }
    return { ...party, customerNumber };
}

function taxesOf(value: unknown, where: Where): TaxAtRate[] {
    if (!Array.isArray(value)) {
        throw new Error(`${where.table}.${where.column} of ${where.id} is not a list of rates.`);
    }
    return value.map((entry: unknown) => {
        const item = (entry ?? {}) as Record<string, unknown>;
        return {
            rate: amountOf(item.rate, where),
            net: amountOf(item.net, where),
            tax: amountOf(item.tax, where),
        };
    });
}
