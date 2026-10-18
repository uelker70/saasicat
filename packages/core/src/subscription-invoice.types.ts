// SubscriptionInvoice — what a subscriber is invoiced for its subscription.
//
// An invoice is built from the charge journal: the charges a billing period
// opens with together, a charge that arises later in the period on an invoice
// of its own (`SC-PRIC-022`). It copies everything it states on the day it is
// issued — the issuer and the subscriber as they stand then (`SC-PRIC-026`),
// the tax treatment the adapter decides then (`SC-PRIC-038`, `SC-PRIC-043`),
// the payment method it is collected with and the day a direct debit is
// collected (`SC-PRIC-028`) — so a later change leaves it as it was. Nothing
// here edits an issued invoice;
// a correction is a cancellation invoice and its replacement (`SC-PRIC-025`).

import type { LegalIdentity, PartyAddress } from './legal-identity.js';
import type { TaxAtRate } from './money.js';
import type { PaymentMethodType } from './payment-gateway.types.js';
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
    /**
     * On a cancellation invoice, the position of the line it cancels; on a
     * replacement, of the line it replaces — both on the invoice
     * `correction.of` names (`SC-AUD-013`). `null` on an invoice's own line.
     */
    correctedPosition: number | null;
}

/**
 * A line to write: everything but what the store assigns. What a line
 * corrects is not among it until a store can keep it.
 */
export type NewSubscriptionInvoiceLine = Omit<
    SubscriptionInvoiceLineRecord,
    'id' | 'invoiceId' | 'correctedPosition'
>;

/** What a correction of an issued invoice is (`SC-PRIC-025`). */
export type SubscriptionInvoiceCorrectionKind = 'cancellation' | 'replacement';

/**
 * What a cancellation invoice or a replacement says of the invoice it corrects
 * (`SC-PRIC-025`, `SC-PRIC-089`): which invoice that is, as it was issued, and
 * why it was cancelled.
 */
export interface SubscriptionInvoiceCorrection {
    /**
     * `cancellation` cancels the whole of the invoice `of` names, and states
     * its amounts reversed; `replacement` takes its place for what is still
     * owed.
     */
    kind: SubscriptionInvoiceCorrectionKind;
    /** The invoice it corrects, as that invoice was issued. */
    of: {
        invoiceId: string;
        number: string;
        issueDate: CalendarDay;
    };
    /** The reason the operator gave for the cancellation (`SC-ADM-020`). */
    reason: string;
}

/**
 * The payment method an invoice is collected with, copied from the
 * subscriber's on the day it was issued — what the invoice tells the
 * subscriber, so a later change leaves it as it was (`SC-PRIC-028`).
 */
export interface SubscriptionInvoicePayment {
    /** The subscriber's payment method, which the collection charges. */
    paymentMethodId: string;
    /** The account in `config/saas.yaml#payments.accounts` that holds it. */
    gatewayAccount: string;
    type: PaymentMethodType;
    /** The card network, such as `visa`; `null` for a direct debit. */
    brand: string | null;
    /** The last four digits of the card number or the IBAN. */
    last4: string;
    /** The mandate a direct debit is collected under; `null` for a card. */
    mandateReference: string | null;
}

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
    /**
     * The day it is due (`SC-PRIC-046`): the collection date where it is
     * collected by direct debit, the issue date plus the payment term otherwise.
     */
    dueDate: CalendarDay;
    /**
     * The payment method it is collected with, as it stood when the invoice
     * was issued; `null` where it is not collected — the subscriber had no
     * payment method that can be, or the invoice asks for nothing.
     */
    payment: SubscriptionInvoicePayment | null;
    /**
     * The day a direct debit is collected from, which the invoice announces
     * with its amount and mandate reference (`SC-PRIC-028`): the issue date
     * plus the lead time. `null` unless `payment` is a direct debit.
     */
    collectionDate: CalendarDay | null;
    /** The first day its charges cover. */
    servicePeriodFrom: CalendarDay;
    /** The last day its charges cover. */
    servicePeriodUntil: CalendarDay;
    currency: string;
    issuer: SubscriptionInvoiceIssuer;
    subscriber: SubscriptionInvoiceSubscriber;
    /**
     * The lines `config/saas.yaml` named under `invoicing.footer` on the issue
     * date — what a business letter of the issuer states beyond the invoice's
     * own content (`SC-PRIC-077`); none where it named none.
     */
    footer: string[];
    /** The treatment the tax adapter decided when it was issued, with its name and version. */
    taxTreatment: TaxTreatment;
    /** The tax, rate by rate, computed once per rate (`SC-PRIC-041`). */
    taxes: TaxAtRate[];
    totalNet: number;
    totalTax: number;
    totalGross: number;
    lines: SubscriptionInvoiceLineRecord[];
    /**
     * What it corrects, on a cancellation invoice or a replacement; `null` on
     * an invoice issued for the charge journal's charges.
     */
    correction: SubscriptionInvoiceCorrection | null;
    createdAt: Date;
}

/**
 * An invoice to issue: everything but what the store assigns — the id, and
 * the number, which the store draws when it writes the invoice. What an
 * invoice corrects is not among it until a store can keep it.
 */
export interface NewSubscriptionInvoice extends Omit<
    SubscriptionInvoiceRecord,
    'id' | 'number' | 'numberSequence' | 'lines' | 'correction' | 'createdAt'
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
