// SubscriptionInvoice — what a subscriber is invoiced for its subscription.
//
// An invoice is built from the charge journal: the charges a billing period
// opens with together, a charge that arises later in the period on an invoice
// of its own (`SC-PRIC-022`). It copies everything it states on the day it is
// issued — the issuer and the subscriber as they stand then (`SC-PRIC-026`),
// the tax treatment the adapter decides then (`SC-PRIC-038`, `SC-PRIC-043`) —
// so a later change leaves it as it was. Nothing here edits an issued invoice;
// a correction is a cancellation invoice and its replacement (`SC-PRIC-025`).

import type { LegalIdentity, PartyAddress } from './legal-identity.js';
import type { TaxAtRate } from './money.js';
import type { SubscriberChargeOrigin, SubscriberChargeSource } from './subscriber-ledger.types.js';
import type { TaxTreatment } from './tax.types.js';
import type { CalendarDay } from './zoned-day.js';

/** The issuer an invoice names, as of its issue date. */
export interface SubscriptionInvoiceIssuer extends LegalIdentity, PartyAddress {}

/** The subscriber an invoice names, copied from its record on the issue date. */
export interface SubscriptionInvoiceSubscriber extends LegalIdentity, PartyAddress {
    customerNumber: string;
}

/** One line of an invoice: one charge, as the invoice states it. */
export interface SubscriptionInvoiceLineRecord {
    id: string;
    invoiceId: string;
    /** From 1, in the order the invoice lists its lines. */
    position: number;
    /** The charge the line invoices; a charge stands on one invoice (`SC-PRIC-022`). */
    chargeId: string;
    /** The contract line the charge came from (`SC-AUD-013`). */
    contractLineItemId: string;
    /** What the line is for, as the contract line names it. */
    title: string;
    origin: SubscriberChargeOrigin;
    source: SubscriberChargeSource;
    /** The first day the charge covers, in the installation's time zone. */
    periodFrom: CalendarDay;
    /** The last day the charge covers, in the installation's time zone. */
    periodUntil: CalendarDay;
    /** Net, as the charge was written. Negative for a discount. */
    amountNet: number;
    /** In per cent: the rate of the invoice's treatment. */
    taxRate: number;
}

/** A line to write: everything but what the store assigns. */
export type NewSubscriptionInvoiceLine = Omit<SubscriptionInvoiceLineRecord, 'id' | 'invoiceId'>;

/** An invoice as a store reads it back. */
export interface SubscriptionInvoiceRecord {
    id: string;
    /** `<prefix>-<year>-<sequence>`, e.g. `AHP-2026-000123` (`formatInvoiceNumber`). */
    number: string;
    numberPrefix: string;
    /** The year of the issue date, which the sequence restarts with. */
    numberYear: number;
    /** From 1 each year, without gaps. */
    numberSequence: number;
    tenantId: string;
    subscriberId: string;
    subscriptionId: string;
    /** The contract the invoiced charges belong to. */
    contractId: string;
    issuedAt: Date;
    /** The day it was issued, in the installation's time zone. */
    issueDate: CalendarDay;
    /** The day it is due: the issue date plus the payment term (`SC-PRIC-046`). */
    dueDate: CalendarDay;
    /** The first day its charges cover. */
    servicePeriodFrom: CalendarDay;
    /** The last day its charges cover. */
    servicePeriodUntil: CalendarDay;
    currency: string;
    issuer: SubscriptionInvoiceIssuer;
    subscriber: SubscriptionInvoiceSubscriber;
    /** The treatment the tax adapter decided when it was issued, with its name and version. */
    taxTreatment: TaxTreatment;
    /** The tax, rate by rate, computed once per rate (`SC-PRIC-041`). */
    taxes: TaxAtRate[];
    totalNet: number;
    totalTax: number;
    totalGross: number;
    lines: SubscriptionInvoiceLineRecord[];
    createdAt: Date;
}

/**
 * An invoice to issue: everything but what the store assigns — the id, and
 * the number, which the store draws when it writes the invoice.
 */
export interface NewSubscriptionInvoice extends Omit<
    SubscriptionInvoiceRecord,
    'id' | 'number' | 'numberSequence' | 'lines' | 'createdAt'
> {
    lines: NewSubscriptionInvoiceLine[];
}

/** How many digits an invoice number's sequence is written with, at least. */
export const INVOICE_SEQUENCE_DIGITS = 6;

/**
 * The number an invoice carries: the prefix `config/saas.yaml` names, the year
 * the sequence counts in, and the sequence written with at least six digits —
 * `formatInvoiceNumber('AHP', 2026, 123)` is `AHP-2026-000123`.
 */
export function formatInvoiceNumber(prefix: string, year: number, sequence: number): string {
    if (!Number.isInteger(sequence) || sequence < 1) {
        throw new RangeError(`An invoice number's sequence starts at 1; ${sequence} is not one.`);
    }
    return `${prefix}-${year}-${String(sequence).padStart(INVOICE_SEQUENCE_DIGITS, '0')}`;
}
