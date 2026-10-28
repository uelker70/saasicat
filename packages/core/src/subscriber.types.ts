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
import type { AdminSubscriberJoins } from './subscriber-join.types.js';
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

/**
 * The address an invoice names. Sign-up asks for every one of them, and once
 * given they can be changed but not cleared: without them nothing can be
 * invoiced (`SC-PRIC-032`).
 */
export const SUBSCRIBER_INVOICE_ADDRESS_FIELDS = [
    'addressLine1',
    'postalCode',
    'city',
    'country',
] as const;
export type SubscriberInvoiceAddressField = (typeof SUBSCRIBER_INVOICE_ADDRESS_FIELDS)[number];

/**
 * Whether a subscriber can be given its next contract where a tax adapter
 * decides (`SC-PRIC-032`, `SC-PRIC-039`): which fields of the address an
 * invoice names are empty, and the adapter's sentence where it supports no
 * treatment for the subscriber as it stands. Computed when it is read, from the
 * record and the adapter as they are then.
 */
export interface SubscriberReadiness {
    ready: boolean;
    missing: SubscriberInvoiceAddressField[];
    /** The adapter's sentence, or `null` where it treats the subscriber. */
    taxRefusal: string | null;
}

/** A subscriber's master data as the operator reads it: who it is, and what a tax adapter decides from. */
export interface AdminSubscriberDetails {
    id: string;
    customerNumber: string;
    legalName: string;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    invoiceEmail: string | null;
    business: boolean | null;
    vatId: string | null;
    /** Whether the check that counts for the VAT id found it valid. */
    vatIdValidated: boolean;
    taxNumber: string | null;
    /** Created from the application's own tenant record, not from what a customer entered. */
    migrated: boolean;
}

/**
 * A subscriber as the operator sees it: its master data and — where a tax
 * adapter decides — what holds its next contract back (`SC-PRIC-070`).
 */
export interface AdminSubscriberStanding {
    subscriber: AdminSubscriberDetails;
    /** `null` where no tax adapter decides. */
    readiness: SubscriberReadiness | null;
}

/**
 * A tenant's subscriber as the operator sees it beside the tenant: who the
 * contracts are concluded with, and what holds its next contract back. The
 * rest of what is known about it is in its record (`SC-ADM-021`).
 */
export interface AdminTenantSubscriber {
    subscriber: AdminSubscriberDetails | null;
    /** `null` where no tax adapter decides, or the tenant has no subscriber. */
    readiness: SubscriberReadiness | null;
}

/**
 * A tenant a subscriber is or was linked to, as its record names it. The
 * platform keeps only the tenant's id on the link; its slug and name are what
 * the application answers for that id now, and `known` is `false` where the
 * application no longer has the tenant — which the record shows as such and
 * does not read as the link having ended (`SC-ADM-036`).
 */
export interface AdminSubscriberTenant {
    tenantId: string;
    /** ISO 8601. */
    linkedAt: string;
    /** ISO 8601; `null` while the link is live. */
    unlinkedAt: string | null;
    known: boolean;
    slug: string | null;
    name: string | null;
    /** ISO 8601; where the application soft-deleted the tenant, when. */
    deletedAt: string | null;
}

/**
 * Everything the operator reads about a subscriber at the top of its record:
 * its standing, and every tenant it was linked to, the live one first, then
 * the earlier ones, the latest first.
 */
export interface AdminSubscriberRecord extends AdminSubscriberStanding {
    tenants: AdminSubscriberTenant[];
    /**
     * The subscriber it was joined into and those joined into it
     * (`SC-ADM-027`); absent where the installation keeps no joins.
     */
    joins?: AdminSubscriberJoins;
}

/** One subscriber in the operator's list of subscribers. */
export interface AdminSubscriberRow {
    id: string;
    customerNumber: string;
    legalName: string;
    vatId: string | null;
    city: string | null;
    country: string | null;
    /** The tenant its live link names, as the application names it; `null` without one. */
    liveTenant: { id: string; slug: string | null; name: string | null } | null;
    /**
     * The subscriber it was joined into, by its customer number; `null` where it
     * was joined into none, absent where the installation keeps no joins.
     */
    joinedInto?: { subscriberId: string; customerNumber: string } | null;
}

/** A page of the operator's list of subscribers, and the subscriber the next one continues after. */
export interface AdminSubscriberList {
    subscribers: AdminSubscriberRow[];
    /** `null` on the last page. */
    next: string | null;
}

/**
 * What a search of subscribers matches, read from what the operator typed by
 * `subscriberSearchTermsOf`, so every store matches the same text the same
 * way. A subscriber matches where any of the three does.
 */
export interface SubscriberSearchTerms {
    /** Matched case-insensitively anywhere in the legal name, every character literally. */
    legalName: string;
    /**
     * The customer number, matched exactly: the number, and — where the text
     * named one — the prefix it was assigned with, case-insensitively.
     */
    customerNumber: { prefix: string | null; sequence: number } | null;
    /** The VAT identification number in its canonical form, matched exactly. */
    vatId: string | null;
}

/** One page of a search of subscribers. */
export interface SubscriberSearch {
    /** `null` for every subscriber. */
    terms: SubscriberSearchTerms | null;
    /** Only the subscribers whose every tenant link is closed. */
    withoutLiveTenant: boolean;
    limit: number;
    /** The id of the last subscriber of the page before; the next page continues after it. */
    after?: string;
}

/**
 * A page of subscribers, the latest customer number first, and whether
 * another page follows.
 */
export interface SubscriberSearchPage {
    subscribers: SubscriberRecord[];
    hasMore: boolean;
}

/** One link between a subscriber and a tenant, as the store keeps it. */
export interface SubscriberTenantLinkRecord {
    tenantId: string;
    linkedAt: Date;
    /** `null` while the link is live. */
    unlinkedAt: Date | null;
}

/** How many subscribers one page of the operator's list holds. */
export const SUBSCRIBER_LIST_PAGE_SIZE = 50;

/** The longest text the operator's search of subscribers takes. */
export const SUBSCRIBER_SEARCH_MAX_LENGTH = 200;

/**
 * The manifest capability that announces the operator's view of subscribers:
 * a tenant's subscriber beside the tenant, the list of subscribers and each
 * subscriber's record. The platform sets it where it serves them.
 */
export const SUBSCRIBER_STANDING_CAPABILITY = 'subscribers.read';

/**
 * The manifest capability that says a tax adapter decides, so a subscriber can
 * be held back from its next contract: the operator's lists ask which only
 * where it is set, and are spared the question everywhere else.
 */
export const SUBSCRIBER_ATTENTION_CAPABILITY = 'subscribers.attention';

/**
 * How many tenants one question about attention may name: a page of a list,
 * not the whole of it. A list longer than this asks in pages.
 */
export const SUBSCRIBER_ATTENTION_PAGE_SIZE = 200;

/**
 * The manifest capability that announces the operator's corrections of a
 * subscriber — its legal identity, its business status, a check of its VAT
 * identification number — beside the subscriber's view.
 */
export const SUBSCRIBER_CORRECTION_CAPABILITY = 'subscribers.correct';

/** A tenant whose subscriber cannot be given its next contract, and why. */
export interface AdminSubscriberAttention {
    tenantId: string;
    readiness: SubscriberReadiness;
}

/** A live subscriber with the check of its VAT id that counts now. */
export interface SubscriberWithCurrentCheck {
    subscriber: SubscriberRecord;
    currentVatIdCheck: SubscriberVatIdCheckRecord | null;
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
    Partial<Omit<SubscriberDetails, 'legalName'>> & {
        /**
         * A check of `vatId` made before the subscriber existed — in a
         * sign-up's step 4, or by `SubscriberService.assessNewSubscriber` —
         * recorded with it when it is created, so its first contract is
         * decided from it. A check of another number is refused.
         */
        vatIdCheck?: VatIdCheck | null;
    };

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
    /**
     * Why it was changed: the reason of the correction or of the change of
     * business status that made it; `null` for a change of the country, which
     * comes with the contact details and states none.
     */
    reason: string | null;
}

/** What a repository writes for a change of the business status the service has accepted. */
export interface SubscriberBusinessStatusData {
    business: boolean | null;
    /** Who changes it, as an actor tag the audit log would write. */
    changedBy: string;
    /** Why, in the operator's words: whether it is a business decides the tax treatment. */
    reason: string;
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

/**
 * What became of a check of a subscriber's VAT identification number: the
 * check as it was recorded, and whether it counts for the number held — or why
 * it did not complete, in which case nothing was recorded and the number stays
 * as validated as it was (`SC-PRIC-040`).
 */
export type SubscriberVatIdCheckResult =
    | { completed: true; check: SubscriberVatIdCheckRecord; counts: boolean }
    | { completed: false; reason: string };

/** A check of a subscriber's VAT identification number, as the operator is shown it. */
export type AdminVatIdCheckOutcome =
    | {
          completed: true;
          valid: boolean;
          /** When the service answered, as an ISO string. */
          checkedAt: string;
          service: string;
          /** Whether it is the check that counts for the number held now. */
          counts: boolean;
      }
    | { completed: false; reason: string };

/**
 * The answer to an operator's correction or check: the subscriber as it now
 * stands, and the check a VAT identification number got, where one was made.
 */
export interface AdminSubscriberCorrected {
    subscriber: AdminSubscriberStanding;
    vatIdCheck: AdminVatIdCheckOutcome | null;
}

/**
 * One entry of a subscriber's history as the operator reads it, the latest
 * first: a correction of its legal identity, a change of its country or
 * business status, or a check of its VAT identification number. Dates are ISO
 * strings.
 */
export type AdminSubscriberHistoryEntry =
    | {
          kind: 'identity-corrected';
          at: string;
          by: string;
          previous: SubscriberIdentityValues;
          corrected: SubscriberIdentityValues;
          reason: string;
      }
    | {
          kind: 'tax-origin-changed';
          at: string;
          by: string;
          previous: SubscriberTaxOriginValues;
          changed: SubscriberTaxOriginValues;
          /** `null` for a change of the country with the contact details. */
          reason: string | null;
      }
    | {
          kind: 'vat-id-checked';
          at: string;
          vatId: string;
          valid: boolean;
          service: string;
          /** Whether it is the check that counts for the number held now. */
          counts: boolean;
      };
