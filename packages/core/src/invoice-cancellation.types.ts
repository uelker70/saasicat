// What an operator gives the cancellation of an invoice, and what its preview
// and the cancellation itself answer, as the administration reads them
// (`SC-PRIC-091`). The server's plan and answer carry more and are declared to
// hold to these, so what the page reads cannot drift from what is served.

import type { SubscriberCreditRecord } from './subscriber-payment.types.js';
import type {
    InvoiceSubscriberDetail,
    NewCorrectionInvoice,
    SubscriptionInvoiceRecord,
} from './subscription-invoice.types.js';

/**
 * What the operator gives a cancellation. Each part is settled before
 * anything is computed: the reason trimmed and held to one line of at most
 * `INVOICE_CANCELLATION_REASON_MAX_LENGTH` characters, each correction as the
 * subscriber's record holds that detail, the address trimmed and shaped like
 * an email address.
 */
export interface InvoiceCancellationRequest {
    /** Why the invoice is cancelled; both invoices name it (`SC-ADM-020`). */
    reason: string;
    /**
     * Details of the subscriber the cancelled invoice named wrongly, as the
     * replacement names them. A detail left out stays as it was; `null` clears
     * one, except the legal name.
     */
    corrections?: Partial<Record<InvoiceSubscriberDetail, string | null>>;
    /**
     * The address both invoices are delivered to, and the replacement's
     * collection notices with them; required where the subscriber's record
     * holds no invoice email (`SC-PRIC-094`).
     */
    deliverTo?: string | null;
    /**
     * The `digest` of the preview the operator confirms. Given, the
     * cancellation is refused with
     * `SUBSCRIPTION_INVOICE_CANCELLATION_PREVIEW_CHANGED` and the new preview
     * wherever what it would write differs from that preview in anything — a
     * party, a tax treatment, an amount, where what was paid goes —, so what
     * is written is what was confirmed (`SC-UI-017`). Left out, as the command
     * line leaves it, the answer says what was written.
     */
    previewDigest?: string;
}

/**
 * What the administration reads of a cancellation's preview: the invoice it
 * cancels, both invoices as they would be issued — without their numbers,
 * which only the cancellation draws —, and where what was paid goes. A detail
 * of the subscriber the replacement names otherwise than the cancelled
 * invoice did is a correction, the operator's or one recorded since.
 */
export interface AdminInvoiceCancellationPlan {
    cancelled: Pick<SubscriptionInvoiceRecord, 'number' | 'currency' | 'subscriber'>;
    cancellation: Pick<NewCorrectionInvoice, 'totalGross'>;
    replacement: Pick<
        NewCorrectionInvoice,
        | 'issueDate'
        | 'dueDate'
        | 'totalNet'
        | 'totalTax'
        | 'totalGross'
        | 'taxTreatment'
        | 'subscriber'
    >;
    /** What the replacement takes over of what was paid. */
    movedIn: number;
    /** What becomes a credit for the operator to refund. */
    credited: number;
    /** The reason both invoices name, as it is recorded. */
    reason: string;
    /** The address both invoices are delivered to; `null` where none was given. */
    deliverTo: string | null;
    /**
     * A fingerprint of everything the cancellation would write but the moment
     * it issues the two invoices, which the cancellation is held to by
     * `previewDigest`.
     */
    digest: string;
}

/** What the administration reads of what a cancellation wrote. */
export interface AdminCancelledInvoice {
    cancellationInvoice: Pick<SubscriptionInvoiceRecord, 'number'>;
    replacement: Pick<SubscriptionInvoiceRecord, 'number' | 'paidOnIssue'>;
    /** The credits it left for the operator to refund. */
    credits: Pick<SubscriberCreditRecord, 'amount'>[];
}
