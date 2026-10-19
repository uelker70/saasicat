// SubscriptionInvoice — what a subscriber is invoiced for its subscription.
//
// An invoice is built from the charge journal: the charges a billing period
// opens with together, a charge that arises later in the period on an invoice
// of its own (`SC-PRIC-022`). It copies everything it states on the day it is
// issued — the issuer and the subscriber as they stand then (`SC-PRIC-092`),
// the tax treatment the adapter decides then (`SC-PRIC-038`, `SC-PRIC-043`),
// the payment method it is collected with and the day a direct debit is
// collected (`SC-PRIC-028`) — so a later change leaves it as it was. Nothing
// here edits an issued invoice;
// a correction is a cancellation invoice and its replacement (`SC-PRIC-091`).

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

/** What a correction of an issued invoice is (`SC-PRIC-091`). */
export type SubscriptionInvoiceCorrectionKind = 'cancellation' | 'replacement';

/**
 * What a cancellation invoice or a replacement says of the invoice it corrects
 * (`SC-PRIC-091`, `SC-PRIC-089`): which invoice that is, as it was issued, and
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
    /**
     * The invoice its chain began with (`SC-PRIC-036`): its own id for an
     * invoice issued on the journal's charges, the cancelled invoice's chain
     * for a cancellation invoice and a replacement.
     */
    chainId: string;
    /**
     * Its step in the chain: 0 the invoice the chain began with, 1 its
     * cancellation, 2 the replacement, 3 the replacement's cancellation and so on.
     */
    chainStep: number;
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
     * own content (`SC-PRIC-093`); none where it named none.
     */
    footer: string[];
    /** The treatment the tax adapter decided when it was issued, with its name and version. */
    taxTreatment: TaxTreatment;
    /** The tax, rate by rate, computed once per rate (`SC-PRIC-041`). */
    taxes: TaxAtRate[];
    totalNet: number;
    totalTax: number;
    totalGross: number;
    /**
     * What a replacement took over, when it was issued, of what was paid for
     * the invoice it replaces (`SC-PRIC-091`), and states as paid; `0` on every
     * other invoice.
     */
    paidOnIssue: number;
    lines: SubscriptionInvoiceLineRecord[];
    /**
     * What it corrects, on a cancellation invoice or a replacement; `null` on
     * an invoice issued for the charge journal's charges.
     */
    correction: SubscriptionInvoiceCorrection | null;
    createdAt: Date;
}

/**
 * An invoice to issue on the journal's charges: everything but what the store
 * assigns — the id, the number, which the store draws when it writes the
 * invoice, and the chain, which the invoice begins. It corrects nothing, and
 * nothing was paid for it before.
 */
export interface NewSubscriptionInvoice extends Omit<
    SubscriptionInvoiceRecord,
    | 'id'
    | 'number'
    | 'numberSequence'
    | 'chainId'
    | 'chainStep'
    | 'paidOnIssue'
    | 'lines'
    | 'correction'
    | 'createdAt'
> {
    lines: NewSubscriptionInvoiceLine[];
}

/** The details of the subscriber an invoice names, which a cancellation may correct. */
export type InvoiceSubscriberDetail = Exclude<
    keyof SubscriptionInvoiceSubscriber,
    'customerNumber'
>;

/** Those details, in the order an invoice names them. */
export const INVOICE_SUBSCRIBER_DETAILS: readonly InvoiceSubscriberDetail[] = [
    'legalName',
    'vatId',
    'taxNumber',
    'addressLine1',
    'addressLine2',
    'postalCode',
    'city',
    'country',
];

/**
 * The details of the subscriber the operator corrected for a replacement
 * (`SC-PRIC-091`), each with the value it replaced on the cancelled invoice.
 */
export type CorrectedInvoiceSubscriber = Partial<
    Record<InvoiceSubscriberDetail, { previous: string | null; corrected: string | null }>
>;

/**
 * The longest reason a cancellation is given (`SC-ADM-020`): both invoices
 * name it, on the page and in the file a program reads.
 */
export const INVOICE_CANCELLATION_REASON_MAX_LENGTH = 500;

/** A cancellation as a store reads it back (`SC-PRIC-091`). */
export interface SubscriptionInvoiceCancellationRecord {
    id: string;
    /** The invoice it cancels. */
    cancelledInvoiceId: string;
    /** The cancellation invoice that cancels it. */
    cancellationInvoiceId: string;
    /** The replacement for what is still owed; `null` where nothing is. */
    replacementInvoiceId: string | null;
    /** The reason the operator gave (`SC-ADM-020`). */
    reason: string;
    /** What the operator corrected for the replacement; `null` where nothing. */
    correctedSubscriber: CorrectedInvoiceSubscriber | null;
    /**
     * The address both invoices are delivered to where the subscriber's record
     * holds no invoice email (`SC-PRIC-047`); `null` otherwise.
     */
    deliverTo: string | null;
    /** Who cancelled it, as an actor tag the audit log writes. */
    cancelledBy: string;
    cancelledAt: Date;
}

/** An invoice of a chain, cancelled or standing, and what corrects what (`SC-PRIC-036`). */
export interface SubscriptionInvoiceChain {
    /** Every invoice of the chain, by its step: the first invoice first. */
    invoices: SubscriptionInvoiceRecord[];
    /** Every cancellation within it, in the order of the invoices they cancel. */
    cancellations: SubscriptionInvoiceCancellationRecord[];
}

/** A line of a cancellation or a replacement to write, naming the line it corrects. */
export type NewCorrectionInvoiceLine = Omit<SubscriptionInvoiceLineRecord, 'id' | 'invoiceId'>;

/**
 * A cancellation invoice or a replacement to write. The store draws its
 * number, and places it in the chain of the invoice it corrects, a step after
 * it — the replacement a step after the cancellation.
 */
export interface NewCorrectionInvoice extends Omit<
    SubscriptionInvoiceRecord,
    | 'id'
    | 'number'
    | 'numberSequence'
    | 'chainId'
    | 'chainStep'
    | 'lines'
    | 'correction'
    | 'createdAt'
> {
    lines: NewCorrectionInvoiceLine[];
}

/** A cancellation to write, with both invoices, in the chain's turn (`SC-PRIC-091`, `SC-PRIC-036`). */
export interface NewSubscriptionInvoiceCancellation {
    /** The invoice cancelled, which still stands in its chain. */
    cancelledInvoiceId: string;
    cancellation: NewCorrectionInvoice;
    /** `null` where nothing the cancelled invoice invoiced is still owed. */
    replacement: NewCorrectionInvoice | null;
    reason: string;
    correctedSubscriber: CorrectedInvoiceSubscriber | null;
    deliverTo: string | null;
    cancelledBy: string;
    cancelledAt: Date;
}

/** What writing a cancellation wrote. */
export interface IssuedSubscriptionInvoiceCancellation {
    cancellation: SubscriptionInvoiceCancellationRecord;
    cancellationInvoice: SubscriptionInvoiceRecord;
    replacement: SubscriptionInvoiceRecord | null;
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
