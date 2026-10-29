// A returning customer's new subscriber joined into the subscriber it had
// (`SC-ADM-027`): what a join reads, what it changes, and what it records.
//
// Self-registration creates a subscriber of its own, and nothing matches a
// sign-up to an earlier customer by itself: an email address typed into a form
// would hand whoever typed it another customer's record. So the operator joins
// them, declaring that both are one legal entity. "From" is the subscriber
// with the live tenant — usually the one sign-up just created —, "into" the
// earlier one, whose every link is closed. Everything from holds moves into the
// earlier one in one transaction; from stays as an empty record that names the
// subscriber it was joined into. A join is not undone.

import type {
    AdminSubscriberDetails,
    AdminSubscriberTenant,
    SubscriberContactChange,
    SubscriberIdentityDelta,
    SubscriberRecord,
    SubscriberTaxOriginValues,
    SubscriberTenantLinkRecord,
    SubscriberVatIdCheckRecord,
} from './subscriber.types.js';

/**
 * Every table that names a subscriber, with the canonical model it holds. A
 * join moves the rows of each, and `1.0-a-subscriber-is-joined.postgres.sql`
 * guards each against being given a row for a joined subscriber afterwards.
 * `subscriptions` is not among them: a subscription belongs to its tenant, and
 * the tenant goes with the link.
 */
export const SUBSCRIBER_OWNED_TABLES = [
    { table: 'subscriber_tenants', model: 'SubscriberTenant' },
    { table: 'subscriber_corrections', model: 'SubscriberCorrection' },
    { table: 'subscriber_tax_origin_changes', model: 'SubscriberTaxOriginChange' },
    { table: 'subscriber_vat_id_checks', model: 'SubscriberVatIdCheck' },
    { table: 'subscriber_payment_methods', model: 'SubscriberPaymentMethod' },
    { table: 'subscriber_payment_method_setups', model: 'SubscriberPaymentMethodSetup' },
    { table: 'subscriber_ledger_entries', model: 'SubscriberLedgerEntry' },
    { table: 'subscription_contracts', model: 'SubscriptionContract' },
    { table: 'subscription_invoices', model: 'SubscriptionInvoice' },
    { table: 'subscriber_payments', model: 'SubscriberPayment' },
    { table: 'subscriber_credits', model: 'SubscriberCredit' },
    { table: 'subscriber_refunds', model: 'SubscriberRefund' },
    { table: 'subscriber_reversals', model: 'SubscriberReversal' },
    { table: 'subscriber_reconciliation_cases', model: 'SubscriberReconciliationCase' },
] as const;

export type SubscriberOwnedTable = (typeof SUBSCRIBER_OWNED_TABLES)[number]['table'];

/** How many rows of each table a join moves. A table the schema leaves out is not named. */
export type SubscriberJoinMoves = Partial<Record<SubscriberOwnedTable, number>>;

/** A subscriber as a join reads it, under the lock it holds on both. */
export interface SubscriberJoinSide {
    subscriber: SubscriberRecord;
    /** Every tenant it is and was linked to, the live link first. */
    links: SubscriberTenantLinkRecord[];
    /** The subscriber it was joined into, or `null` where it was joined into none. */
    joinedIntoId: string | null;
    /** The check of its VAT id that counts now, or `null` while none does. */
    countingVatIdCheck: SubscriberVatIdCheckRecord | null;
    /** How many of its payment methods are in use: none or one. */
    paymentMethodsInUse: number;
}

/** Everything a join is decided from: both sides, and what the subscriber joined holds. */
export interface SubscriberJoinState {
    from: SubscriberJoinSide;
    into: SubscriberJoinSide;
    moving: SubscriberJoinMoves;
}

/** What the operator asks for, and what it declares. */
export interface SubscriberJoinRequest {
    /**
     * The operator's declaration. `same-entity`: the two are one legal entity
     * — a typo in the name, a new VAT number, a change of name it went
     * through. `takeover`: another entity took the business over, which is a
     * transfer (`SC-SUB-017`) and is refused.
     */
    kind: 'same-entity' | 'takeover';
    /** Why, in the operator's words. Part of the record. */
    reason: string;
    /**
     * The digest of the preview the operator confirmed. A join that names one
     * is refused when what it would do has changed since; one that names none
     * — the command line, which shows its preview in the same run — is held to
     * no earlier preview.
     */
    previewDigest?: string;
}

/** How the check of the VAT id that counts is decided by a join, for the subscriber joined into. */
export type SubscriberJoinVatIdCheck =
    /** The check that counts for the subscriber joined counts for the number taken over. */
    | 'adopted'
    /** The number changes and no check comes with it: none counts until the next one. */
    | 'ended'
    /** The number stays, and so does the check that counts for it. */
    | 'kept';

/** One field the details of the subscriber joined replace, with both values. */
export interface SubscriberJoinReplacement {
    field:
        | 'addressLine1'
        | 'addressLine2'
        | 'postalCode'
        | 'city'
        | 'country'
        | 'invoiceEmail'
        | 'business';
    previous: string | boolean | null;
    next: string | boolean | null;
}

/** What a join changes, worked out from the state it read. Nothing here is written yet. */
export interface SubscriberJoinPlan {
    fromSubscriberId: string;
    intoSubscriberId: string;
    moving: SubscriberJoinMoves;
    /** The contact details the subscriber joined replaces: what sign-up collected is the newer. */
    contact: SubscriberContactChange;
    /** Whether it is a business, where the subscriber joined says otherwise; `undefined` keeps it. */
    business: boolean | null | undefined;
    /** Every contact and business field that moves, as the preview names them. */
    replaced: SubscriberJoinReplacement[];
    /** The legal identity that differs, recorded as a correction of the same entity; `null` where none does. */
    identity: SubscriberIdentityDelta | null;
    /** The tax origin that moves, recorded as one change with the join's reason; `null` where none does. */
    taxOrigin: { previous: SubscriberTaxOriginValues; changed: SubscriberTaxOriginValues } | null;
    vatIdCheck: SubscriberJoinVatIdCheck;
    /** The check that counts after the join where it is the one adopted. */
    adoptedVatIdCheckId: string | null;
    /** How many payment methods of the subscriber joined into go out of use: none or one. */
    paymentMethodsOutOfUse: number;
}

/**
 * What a repository writes for a join the platform has decided, every value
 * settled: the plan, who, why, when and the digest of what was decided.
 */
export interface SubscriberJoinWrite {
    plan: SubscriberJoinPlan;
    reason: string;
    /** Who joins them, as an actor tag the audit log would write. */
    joinedBy: string;
    /** Taken while both rows are locked, by the platform's clock. */
    joinedAt: Date;
    /** The digest of the state the plan was decided from. */
    digest: string;
}

/** One join as it was recorded: never rewritten. */
export interface SubscriberJoinRecord {
    id: string;
    fromSubscriberId: string;
    intoSubscriberId: string;
    reason: string;
    joinedBy: string;
    joinedAt: Date;
    digest: string;
    moved: SubscriberJoinMoves;
}

/** A subscriber in a join's preview, as its record shows it. */
export interface AdminSubscriberJoinSide {
    subscriber: AdminSubscriberDetails;
    tenants: AdminSubscriberTenant[];
}

/**
 * What the operator is shown before joining: both subscribers side by side,
 * what moves, what is replaced and corrected, and the digest a join names to
 * be held to it (`SC-ADM-027`).
 */
export interface AdminSubscriberJoinPreview {
    from: AdminSubscriberJoinSide;
    into: AdminSubscriberJoinSide;
    moving: SubscriberJoinMoves;
    replaced: SubscriberJoinReplacement[];
    corrected: SubscriberIdentityDelta | null;
    vatIdCheck: SubscriberJoinVatIdCheck;
    paymentMethodsOutOfUse: number;
    /** The payment methods in use at the subscriber joined, which stay in use at the earlier one. */
    paymentMethodsTakenOver: number;
    digest: string;
}

/** A join as a record names it: the other subscriber, and who joined them, when and why. */
export interface AdminSubscriberJoinNote {
    subscriberId: string;
    customerNumber: string;
    legalName: string;
    /** ISO 8601. */
    joinedAt: string;
    joinedBy: string;
    reason: string;
}

/** What a join answers: the subscriber everything moved to, as the record of the one joined names it. */
export interface AdminSubscriberJoined {
    joinedInto: AdminSubscriberJoinNote;
}

/** The joins a record names: the one it was joined into, and those joined into it. */
export interface AdminSubscriberJoins {
    into: AdminSubscriberJoinNote | null;
    from: AdminSubscriberJoinNote[];
}

/**
 * The manifest capability that announces joining a returning customer's
 * subscriber into the one it had. The platform sets it where it serves joins.
 */
export const SUBSCRIBER_JOIN_CAPABILITY = 'subscribers.join';
