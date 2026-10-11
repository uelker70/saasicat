// Canonical row -> record mapping for invoices. Pure, and shared by both
// adapters for the reason `subscription-contract-mapping.ts` gives.
//
// An invoice is read back defensively: it is a document kept for years, read by
// releases that did not write it, and a party, a treatment or a tax figure of
// the wrong shape must fail loudly here rather than reach a rendered invoice as
// a blank or a zero.

import { oneOf } from './closed-value.js';
import type { LegalIdentity, PartyAddress } from './legal-identity.js';
import type { TaxAtRate } from './money.js';
import {
    SUBSCRIBER_CHARGE_ORIGINS,
    SUBSCRIBER_CHARGE_SOURCES,
} from './subscriber-ledger-mapping.js';
import type {
    NewSubscriptionInvoice,
    NewSubscriptionInvoiceLine,
    SubscriptionInvoiceIssuer,
    SubscriptionInvoiceLineRecord,
    SubscriptionInvoiceRecord,
    SubscriptionInvoiceSubscriber,
} from './subscription-invoice.types.js';
import { taxTreatmentToJson, toTaxTreatment } from './tax-origin.js';
import type { CalendarDay } from './zoned-day.js';

const INVOICES = 'subscription_invoices';
const LINES = 'subscription_invoice_lines';

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
    issuedAt: Date;
    issueDate: unknown;
    dueDate: unknown;
    servicePeriodFrom: unknown;
    servicePeriodUntil: unknown;
    currency: string;
    issuerParty: unknown;
    subscriberParty: unknown;
    taxTreatment: unknown;
    taxes: unknown;
    totalNet: unknown;
    totalTax: unknown;
    totalGross: unknown;
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
}

/** Reads an invoice row and its lines back as a record, the lines in their order. */
export function toSubscriptionInvoiceRecord(
    row: CanonicalSubscriptionInvoiceRow,
    lines: readonly CanonicalSubscriptionInvoiceLineRow[],
): SubscriptionInvoiceRecord {
    const where = (column: string) => ({ table: INVOICES, column, id: row.id });
    const treatment = toTaxTreatment(row.taxTreatment);
    if (!treatment) {
        throw new Error(`${INVOICES}.taxTreatment of ${row.id} is not a tax treatment.`);
    }
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
        issuedAt: row.issuedAt,
        issueDate: dayOf(row.issueDate, where('issueDate')),
        dueDate: dayOf(row.dueDate, where('dueDate')),
        servicePeriodFrom: dayOf(row.servicePeriodFrom, where('servicePeriodFrom')),
        servicePeriodUntil: dayOf(row.servicePeriodUntil, where('servicePeriodUntil')),
        currency: row.currency,
        issuer: issuerOf(row.issuerParty, where('issuerParty')),
        subscriber: subscriberOf(row.subscriberParty, where('subscriberParty')),
        taxTreatment: treatment,
        taxes: taxesOf(row.taxes, where('taxes')),
        totalNet: amountOf(row.totalNet, where('totalNet')),
        totalTax: amountOf(row.totalTax, where('totalTax')),
        totalGross: amountOf(row.totalGross, where('totalGross')),
        lines: [...lines]
            .sort((a, b) => a.position - b.position)
            .map((line) => toSubscriptionInvoiceLineRecord(line)),
        createdAt: row.createdAt,
    };
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
    };
}

/**
 * The columns an invoice is written with: amounts as decimal strings of two
 * places, as a charge's are, and days as their text, which each adapter turns
 * into what its date column takes.
 */
export interface SubscriptionInvoiceColumns {
    number: string;
    numberPrefix: string;
    numberYear: number;
    numberSequence: number;
    tenantId: string;
    subscriberId: string;
    subscriptionId: string;
    contractId: string;
    issuedAt: Date;
    issueDate: CalendarDay;
    dueDate: CalendarDay;
    servicePeriodFrom: CalendarDay;
    servicePeriodUntil: CalendarDay;
    currency: string;
    issuerParty: SubscriptionInvoiceIssuer;
    subscriberParty: SubscriptionInvoiceSubscriber;
    taxTreatment: Record<string, unknown>;
    taxes: TaxAtRate[];
    totalNet: string;
    totalTax: string;
    totalGross: string;
}

/** The columns a line is written with, in the form `SubscriptionInvoiceColumns` describes. */
export interface SubscriptionInvoiceLineColumns {
    invoiceId: string;
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

/** The columns an invoice is written with, given the number the store drew. */
export function subscriptionInvoiceColumns(
    invoice: NewSubscriptionInvoice,
    drawn: { number: string; numberSequence: number },
): SubscriptionInvoiceColumns {
    return {
        number: drawn.number,
        numberPrefix: invoice.numberPrefix,
        numberYear: invoice.numberYear,
        numberSequence: drawn.numberSequence,
        tenantId: invoice.tenantId,
        subscriberId: invoice.subscriberId,
        subscriptionId: invoice.subscriptionId,
        contractId: invoice.contractId,
        issuedAt: invoice.issuedAt,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        servicePeriodFrom: invoice.servicePeriodFrom,
        servicePeriodUntil: invoice.servicePeriodUntil,
        currency: invoice.currency,
        issuerParty: { ...invoice.issuer },
        subscriberParty: { ...invoice.subscriber },
        taxTreatment: taxTreatmentToJson(invoice.taxTreatment),
        taxes: invoice.taxes.map((entry) => ({ rate: entry.rate, net: entry.net, tax: entry.tax })),
        totalNet: centsText(invoice.totalNet, 'totalNet'),
        totalTax: centsText(invoice.totalTax, 'totalTax'),
        totalGross: centsText(invoice.totalGross, 'totalGross'),
    };
}

/** The columns a line is written with. */
export function subscriptionInvoiceLineColumns(
    line: NewSubscriptionInvoiceLine,
    invoiceId: string,
): SubscriptionInvoiceLineColumns {
    return {
        invoiceId,
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

/** A day as the `Date` at midnight UTC a Prisma `@db.Date` column takes. */
export function utcMidnightOf(day: CalendarDay): Date {
    return new Date(`${day}T00:00:00.000Z`);
}

type Where = { table: string; column: string; id: string };

const DAY_LENGTH = 'YYYY-MM-DD'.length;

function dayOf(value: unknown, where: Where): CalendarDay {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, DAY_LENGTH);
    }
    if (
        typeof value === 'string' &&
        value.length === DAY_LENGTH &&
        !Number.isNaN(Date.parse(value))
    ) {
        return value;
    }
    throw new Error(`${where.table}.${where.column} of ${where.id} is not a day.`);
}

function amountOf(value: unknown, where: Where): number {
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

function textOrNull(source: Record<string, unknown>, key: string, where: Where): string | null {
    const value = source[key];
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
