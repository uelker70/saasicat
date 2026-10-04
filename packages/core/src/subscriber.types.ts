// Subscriber — the party a subscription contract is concluded with.
//
// A tenant is where an application keeps a customer's data; the subscriber is
// who the contract is with: a customer number and the master data a contract
// and, later, an invoice name. The two are kept apart so that a tenant can go
// while the record of what was agreed stays (ADR 0012).
//
// What names the party itself — `LegalIdentity` and `PartyAddress` — is in
// `legal-identity.ts`: the operator's issuer is named by the same fields, and
// the rule about correcting them is the same on both sides of the contract.

import type { LegalIdentity, PartyAddress } from './legal-identity.js';
import type { VatIdCheck } from './tax.types.js';

/** How a subscriber is reached, which may change at any time. */
export interface SubscriberContact extends PartyAddress {
    /** Where invoices will be sent. */
    invoiceEmail: string | null;
}

/**
 * Whether the subscriber is a business: part of its tax origin beside the
 * country and the VAT identification number (ADR 0013).
 */
export interface SubscriberTaxStatus {
    /**
     * As sign-up or the operator recorded it; `null` while nobody has said.
     * Never derived from a tax identifier: a business outside the European
     * Union may have none, and is still a business.
     */
    business: boolean | null;
}

/** A subscriber's master data, as it stands. */
export type SubscriberDetails = LegalIdentity & SubscriberContact & SubscriberTaxStatus;

/**
 * What a subscriber is created with.
 *
 * Only the legal name is required. The address, the tax identifiers, the
 * business status and the invoice email stay optional until sign-up asks for
 * them and invoicing requires them; an absent or blank value is recorded as
 * unknown.
 */
export type NewSubscriberDetails = Pick<SubscriberDetails, 'legalName'> &
    Partial<Omit<SubscriberDetails, 'legalName'>>;

export interface SubscriberRecord extends SubscriberDetails {
    id: string;
    /**
     * Assigned when the subscriber is created and never changed: the number,
     * counted per installation, behind the prefix configured at that moment.
     */
    customerNumber: string;
    /** The tenant this subscriber is live for, or `null` once it has none. */
    tenantId: string | null;
    /**
     * Created by the migration that gave every existing tenant its subscriber,
     * from the application's own tenant record rather than from what a customer
     * entered.
     */
    migrated: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/** What a repository writes for a new subscriber, every detail already settled. */
export interface CreateSubscriberData extends SubscriberDetails {
    /** The tenant the subscriber is created for and live with. */
    tenantId: string;
    /** Put in front of the assigned number; empty for the number alone. */
    customerNumberPrefix: string;
}

/** Contact details to change; a member left out keeps its value. */
export type SubscriberContactChange = Partial<SubscriberContact>;

/**
 * A change to a subscriber's legal identity, and what the operator declares it
 * to be.
 *
 * SaaSiCat cannot tell a misspelt name from another company taking over, so the
 * operator says which: `correction` for the same legal entity — a typo, a wrong
 * tax identifier, a change of name that entity went through — and `takeover`
 * for another one, which is a transfer rather than an edit and is refused.
 */
export interface SubscriberIdentityCorrection {
    kind: 'correction' | 'takeover';
    legalName?: string;
    vatId?: string | null;
    taxNumber?: string | null;
    /** Why the identity is corrected. Part of the record. */
    reason: string;
    /** Who corrects it, as an actor tag the audit log would write. */
    correctedBy: string;
}

/** Identity values by field, holding only the fields a correction changed. */
export type SubscriberIdentityValues = Partial<LegalIdentity>;

/** What a correction replaces and what it writes, holding only the fields that move. */
export interface SubscriberIdentityDelta {
    previous: SubscriberIdentityValues;
    corrected: SubscriberIdentityValues;
}

/**
 * What a repository writes for a correction the service has accepted. The
 * repository dates it, while it holds the subscriber's row lock.
 */
export interface SubscriberCorrectionData {
    /** The new values; a field equal to what is stored is not recorded. */
    corrected: SubscriberIdentityValues;
    reason: string;
    correctedBy: string;
}

/** One correction of a subscriber's legal identity, as it was recorded. */
export interface SubscriberCorrectionRecord {
    id: string;
    subscriberId: string;
    /** The values the correction replaced. */
    previous: SubscriberIdentityValues;
    /** The values it wrote. */
    corrected: SubscriberIdentityValues;
    reason: string;
    correctedBy: string;
    /**
     * When the write that made it held the subscriber's row lock, by the
     * platform's clock. The list is in the order the database numbered the
     * writes; on one clock these dates follow that order, while two instances
     * whose clocks differ may date neighbouring corrections out of it.
     */
    correctedAt: Date;
}

/** The outcome of writing a correction: nothing is recorded when no value moved. */
export interface SubscriberCorrectionResult {
    subscriber: SubscriberRecord;
    correction: SubscriberCorrectionRecord | null;
}

/**
 * The details a subscriber's tax origin consists of, and whose change is
 * recorded with its date — in the order they are named and shown.
 */
export const SUBSCRIBER_TAX_ORIGIN_FIELDS = ['country', 'business', 'vatId'] as const;

export type SubscriberTaxOriginField = (typeof SUBSCRIBER_TAX_ORIGIN_FIELDS)[number];

/** Tax origin values by field, holding only the fields a change moved. */
export type SubscriberTaxOriginValues = Partial<Pick<SubscriberDetails, SubscriberTaxOriginField>>;

/**
 * One change of a subscriber's tax origin, as it was recorded: written in the
 * same transaction as the change, whichever way it arrived — a contact change
 * of the country, a correction of the VAT identification number, a change of
 * the business status — and never rewritten. A change applies from the
 * subscriber's next invoice (`SC-PRIC-043`).
 */
export interface SubscriberTaxOriginChangeRecord {
    id: string;
    subscriberId: string;
    /** The values the change replaced. */
    previous: SubscriberTaxOriginValues;
    /** The values it wrote. */
    changed: SubscriberTaxOriginValues;
    /** Who changed it, as an actor tag the audit log would write. */
    changedBy: string;
    /**
     * When the write that made it held the subscriber's row lock, by the
     * platform's clock. The list is in the order the database numbered the
     * writes; on one clock these dates follow that order, while two instances
     * whose clocks differ may date neighbouring changes out of it.
     */
    changedAt: Date;
}

/** What a repository writes for a change of the business status the service has accepted. */
export interface SubscriberBusinessStatusData {
    business: boolean | null;
    /** Who changes it, as an actor tag the audit log would write. */
    changedBy: string;
}

/** The outcome of writing a business status: nothing is recorded when it does not move. */
export interface SubscriberBusinessStatusResult {
    subscriber: SubscriberRecord;
    change: SubscriberTaxOriginChangeRecord | null;
}

/**
 * One completed check of a subscriber's VAT identification number, as it was
 * recorded: never rewritten, whether it counts now or not.
 */
export interface SubscriberVatIdCheckRecord extends VatIdCheck {
    id: string;
    subscriberId: string;
    /** When the check was recorded, by the platform's clock. */
    recordedAt: Date;
}

/** The outcome of recording a check: the check as recorded, and the one that counts now. */
export interface RecordedVatIdCheck {
    recorded: SubscriberVatIdCheckRecord;
    /**
     * The check that counts for the subscriber's number from now on: the one
     * just recorded, one recorded earlier that completed later, or none — a
     * check of a number the subscriber no longer has counts for nothing.
     */
    current: SubscriberVatIdCheckRecord | null;
}
