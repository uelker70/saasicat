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

/** How a subscriber is reached, which may change at any time. */
export interface SubscriberContact extends PartyAddress {
    /** Where invoices will be sent. */
    invoiceEmail: string | null;
}

/** A subscriber's master data, as it stands. */
export type SubscriberDetails = LegalIdentity & SubscriberContact;

/**
 * What a subscriber is created with.
 *
 * Only the legal name is required. The address, the tax identifiers and the
 * invoice email stay optional until sign-up asks for them and invoicing
 * requires them; an absent or blank value is recorded as unknown.
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

/** What a repository writes for a correction the service has accepted. */
export interface SubscriberCorrectionData {
    /** The new values; a field equal to what is stored is not recorded. */
    corrected: SubscriberIdentityValues;
    reason: string;
    correctedBy: string;
    correctedAt: Date;
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
    correctedAt: Date;
}

/** The outcome of writing a correction: nothing is recorded when no value moved. */
export interface SubscriberCorrectionResult {
    subscriber: SubscriberRecord;
    correction: SubscriberCorrectionRecord | null;
}
