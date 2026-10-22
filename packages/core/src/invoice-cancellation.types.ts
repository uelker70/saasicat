// What an operator gives the cancellation of an invoice, and what its preview
// and the cancellation itself answer, as the administration reads them
// (`SC-PRIC-095`). The server's plan and answer carry more and are declared to
// hold to these, so what the page reads cannot drift from what is served.

import type { InvoiceLineOwed } from './invoice-line-correction.js';
import type { SubscriberCreditRecord } from './subscriber-payment.types.js';
import type {
    InvoiceSubscriberDetail,
    NewCorrectionInvoice,
    NewCorrectionInvoiceLine,
    SubscriptionInvoiceLineRecord,
    SubscriptionInvoiceRecord,
} from './subscription-invoice.types.js';

/**
 * A line of an invoice as the operator reads it to cancel the invoice
 * (`SC-ADM-035`): as the document states it, with what its charge stands at
 * and whether the cancellation may say it is not owed, or owed in part.
 */
export interface AdminInvoiceLine extends Pick<
    SubscriptionInvoiceLineRecord,
    | 'position'
    | 'title'
    | 'origin'
    | 'source'
    | 'periodFrom'
    | 'periodUntil'
    | 'amountNet'
    | 'taxRate'
    | 'correctedPosition'
    | 'correctsPosition'
> {
    /**
     * Its charge's amount and every correction of it written along the
     * invoice's chain, net, in the invoice's currency: below `amountNet` where
     * an earlier cancellation lowered it.
     */
    standsAt: number;
    /**
     * Whether a cancellation may name it as not owed, or owed below
     * `standsAt`: a line whose charge asks for something, and not a discount,
     * which follows what it reduced, a credit or a correction.
     */
    correctable: boolean;
}

/** An invoice with its lines, as the operator reads it to cancel it (`SC-ADM-035`). */
export interface AdminInvoice extends Pick<
    SubscriptionInvoiceRecord,
    'id' | 'number' | 'currency' | 'dueDate' | 'totalNet' | 'totalTax' | 'totalGross'
> {
    /** ISO 8601. */
    issuedAt: string;
    /** In the order the document lists them. */
    lines: AdminInvoiceLine[];
}

/**
 * A charge line of the cancelled invoice: what it stands at, and what it
 * becomes on the replacement, net, in the invoice's currency.
 */
export interface AdminCorrectedInvoiceLine {
    position: number;
    standsAt: number;
    /** `standsAt` where nothing moves it; nothing where none of it is owed. */
    becomes: number;
}

/** A line of the replacement as the preview shows it. */
export type AdminReplacementLine = Pick<
    NewCorrectionInvoiceLine,
    | 'position'
    | 'title'
    | 'origin'
    | 'source'
    | 'periodFrom'
    | 'periodUntil'
    | 'amountNet'
    | 'correctedPosition'
    | 'correctsPosition'
>;

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
     * The lines of the cancelled invoice that are not owed, or not in full,
     * each by its position with what is still owed of it, net; a line left out
     * is owed in full. Only a line whose charge asks for something is named —
     * a discount follows what it reduced, in the share that fell
     * (`SC-PRIC-020`). Each is written as a counter-entry with the reason.
     */
    lines?: readonly InvoiceLineOwed[];
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
    /**
     * `null` where nothing of the cancelled invoice is owed any more. Its
     * lines name the line of the cancelled invoice each replaces, and a
     * correction's line the line on the replacement whose charge it corrects.
     */
    replacement:
        | (Pick<
              NewCorrectionInvoice,
              | 'issueDate'
              | 'dueDate'
              | 'totalNet'
              | 'totalTax'
              | 'totalGross'
              | 'taxTreatment'
              | 'subscriber'
          > & { lines: AdminReplacementLine[] })
        | null;
    /** Each charge line of the cancelled invoice, a correction's line aside, by its position. */
    lines: AdminCorrectedInvoiceLine[];
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
    /** `null` where nothing of the cancelled invoice was owed any more. */
    replacement: Pick<SubscriptionInvoiceRecord, 'number' | 'paidOnIssue'> | null;
    /** What each charge line of the cancelled invoice stood at, and became. */
    lines: AdminCorrectedInvoiceLine[];
    /** The credits it left for the operator to refund. */
    credits: Pick<SubscriberCreditRecord, 'amount'>[];
}
