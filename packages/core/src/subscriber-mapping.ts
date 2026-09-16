// Canonical row -> record mapping for subscribers, and the party copies a
// contract takes from them. Pure, and shared by every adapter and the platform.
//
// Both adapters read the same canonical tables, so "which column becomes which
// field" is one decision, for the reason `subscription-contract-mapping.ts`
// gives: two copies of it drift without anybody comparing them.

import { issuerIdentityOf } from './issuer-identity.js';
import { LEGAL_IDENTITY_FIELDS, type LegalIdentityField } from './legal-identity.js';
import type { PlanCatalog } from './plan-catalog.types.js';
import type { PendingRegistration } from './registration.types.js';
import type {
    NewSubscriberDetails,
    SubscriberCorrectionRecord,
    SubscriberIdentityDelta,
    SubscriberIdentityValues,
    SubscriberRecord,
} from './subscriber.types.js';
import type {
    ContractIssuerParty,
    ContractSubscriberParty,
    SubscriptionContractParties,
} from './subscription-contract.types.js';

/** A `subscribers` row as either adapter reads it back. */
export interface CanonicalSubscriberRow {
    id: string;
    customerSequence: number;
    customerNumberPrefix: string;
    legalName: string;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    vatId: string | null;
    taxNumber: string | null;
    invoiceEmail: string | null;
    migrated: boolean;
    createdAt: Date;
    updatedAt: Date;
}

/** A `subscriber_corrections` row as either adapter reads it back. */
export interface CanonicalSubscriberCorrectionRow {
    id: string;
    subscriberId: string;
    previous: unknown;
    corrected: unknown;
    reason: string;
    correctedBy: string;
    correctedAt: Date;
}

/**
 * The customer number a subscriber is known by: the prefix it was assigned
 * with, then the number. Kept apart in storage so the number orders and the
 * prefix stays what it was on the day it was assigned.
 */
export function formatCustomerNumber(prefix: string, sequence: number): string {
    return `${prefix}${sequence}`;
}

/** `tenantId` is the tenant the subscriber's live link names, read beside the row. */
export function toSubscriberRecord(
    row: CanonicalSubscriberRow,
    tenantId: string | null,
): SubscriberRecord {
    return {
        id: row.id,
        customerNumber: formatCustomerNumber(row.customerNumberPrefix, row.customerSequence),
        legalName: row.legalName,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        postalCode: row.postalCode,
        city: row.city,
        country: row.country,
        vatId: row.vatId,
        taxNumber: row.taxNumber,
        invoiceEmail: row.invoiceEmail,
        tenantId,
        migrated: row.migrated,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export function toSubscriberCorrectionRecord(
    row: CanonicalSubscriberCorrectionRow,
): SubscriberCorrectionRecord {
    return {
        id: row.id,
        subscriberId: row.subscriberId,
        previous: toIdentityValues(row.previous),
        corrected: toIdentityValues(row.corrected),
        reason: row.reason,
        correctedBy: row.correctedBy,
        correctedAt: row.correctedAt,
    };
}

/**
 * The part of a correction that changes something: every corrected field whose
 * stored value differs, with the value it replaces. Both adapters decide this
 * the same way, under the lock they read `current` with.
 */
export function identityCorrectionDelta(
    current: Pick<SubscriberRecord, LegalIdentityField>,
    corrected: SubscriberIdentityValues,
): SubscriberIdentityDelta {
    const previous: Record<string, string | null> = {};
    const next: Record<string, string | null> = {};
    for (const field of LEGAL_IDENTITY_FIELDS) {
        const value = corrected[field];
        if (value === undefined || value === current[field]) continue;
        previous[field] = current[field];
        next[field] = value;
    }
    return {
        previous: previous as SubscriberIdentityValues,
        corrected: next as SubscriberIdentityValues,
    };
}

/**
 * Who a new contract is between: the subscriber as it stands, and the issuer as
 * the running configuration names it — or no issuer, where it names none.
 */
export function contractPartiesOf(
    subscriber: SubscriberRecord,
    issuer: PlanCatalog['issuer'],
): SubscriptionContractParties {
    const party: ContractSubscriberParty = {
        customerNumber: subscriber.customerNumber,
        legalName: subscriber.legalName,
        vatId: subscriber.vatId,
        taxNumber: subscriber.taxNumber,
        addressLine1: subscriber.addressLine1,
        addressLine2: subscriber.addressLine2,
        postalCode: subscriber.postalCode,
        city: subscriber.city,
        country: subscriber.country,
    };
    return {
        subscriberId: subscriber.id,
        subscriber: party,
        issuer: issuer ? issuerPartyOf(issuer) : null,
    };
}

function issuerPartyOf(issuer: NonNullable<PlanCatalog['issuer']>): ContractIssuerParty {
    // The three identity fields come from the one function that reads them, so a
    // contract copies exactly what the start compares against the record.
    // `correctionOf` is a declaration about the change, not part of the party,
    // and is not copied onto anything.
    //
    // That function reads no identity out of a block whose name is blank, and
    // the members are written out rather than spread: spreading the `null` would
    // leave the copy without any of the three, which is a contract naming a
    // party it does not name. An empty name is what a party copy has always
    // carried for "not stated" — see `toIssuerParty`, which reads one back.
    const identity = issuerIdentityOf(issuer);
    return {
        legalName: identity?.legalName ?? '',
        vatId: identity?.vatId ?? null,
        taxNumber: identity?.taxNumber ?? null,
        addressLine1: issuer.addressLine1 ?? null,
        addressLine2: issuer.addressLine2 ?? null,
        postalCode: issuer.postalCode ?? null,
        city: issuer.city ?? null,
        country: issuer.country ?? null,
    };
}

/**
 * The subscriber a completed sign-up is created with: the name the tenant was
 * registered under as its legal name, the address the registration was
 * verified with as its invoice email, and the billing address and tax
 * identifiers step 4 took.
 */
export function subscriberFromRegistration(
    pending: Pick<
        PendingRegistration,
        | 'tenantName'
        | 'email'
        | 'addressLine1'
        | 'addressLine2'
        | 'postalCode'
        | 'city'
        | 'country'
        | 'vatId'
        | 'taxNumber'
    >,
): NewSubscriberDetails {
    return {
        legalName: pending.tenantName,
        invoiceEmail: pending.email,
        addressLine1: pending.addressLine1,
        addressLine2: pending.addressLine2,
        postalCode: pending.postalCode,
        city: pending.city,
        country: pending.country,
        vatId: pending.vatId,
        taxNumber: pending.taxNumber,
    };
}

function toIdentityValues(value: unknown): SubscriberIdentityValues {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    const source = value as Record<string, unknown>;
    const values: Record<string, string | null> = {};
    for (const field of LEGAL_IDENTITY_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
        const entry = source[field];
        values[field] = typeof entry === 'string' ? entry : null;
    }
    return values as SubscriberIdentityValues;
}
