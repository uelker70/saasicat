// What a subscriber's details have to be before they are written: trimmed, a
// blank value recorded as unknown, the legal name present, the two details
// that have a form — the country and the invoice email — in it, and the
// business status a yes, a no or not stated.
//
// Every way a detail arrives goes through here: a new subscriber, a contact
// change, a correction of the legal identity. A rule held on one of them and
// not the others would let the same value in through the next door.

import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import type {
    LegalIdentityField,
    NewSubscriberDetails,
    SubscriberContact,
    SubscriberContactChange,
    SubscriberDetails,
    SubscriberIdentityCorrection,
    SubscriberIdentityValues,
} from '@saasicat/core';
import {
    canonicalVatId,
    LEGAL_IDENTITY_FIELDS,
    SUBSCRIBER_ERROR_CODES,
    SUBSCRIBER_INVOICE_ADDRESS_FIELDS,
    type SubscriberInvoiceAddressField,
} from '@saasicat/core';

import { codedError } from '../errors/coded-error.js';

/** ISO 3166-1 alpha-2, as the schema of `config/saas.yaml` holds the issuer's. */
const COUNTRY_CODE = /^[A-Z]{2}$/;

/** RFC 5321 caps an address at 254 characters. */
const MAX_EMAIL_LENGTH = 254;

const CONTACT_FIELDS: readonly (keyof SubscriberContact)[] = [
    'addressLine1',
    'addressLine2',
    'postalCode',
    'city',
    'country',
    'invoiceEmail',
];

/** A new subscriber's details, every one settled. */
export function settleNewSubscriberDetails(details: NewSubscriberDetails): SubscriberDetails {
    return {
        legalName: settleLegalName(details.legalName),
        vatId: settleVatId(details.vatId),
        taxNumber: settleText('taxNumber', details.taxNumber),
        ...settleContact(details, CONTACT_FIELDS),
        business: settleBusinessStatus(details.business),
    };
}

/**
 * Whether the subscriber is a business: `true`, `false`, or `null` for not
 * stated. Anything else is refused rather than read as one of them — a `"no"`
 * that reads as truthy would treat a consumer as a business.
 */
export function settleBusinessStatus(value: unknown): boolean | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'boolean') throw invalid('business');
    return value;
}

/**
 * The contact details a change names, settled: `null` clears one, `undefined`
 * leaves it out. A field of the legal identity, and the business status, are
 * refused rather than dropped — a caller that sent a new legal name through
 * here would otherwise be told it succeeded.
 */
export function settleContactChange(change: SubscriberContactChange): SubscriberContactChange {
    const identity = LEGAL_IDENTITY_FIELDS.find(
        (field) => (change as Record<string, unknown>)[field] !== undefined,
    );
    if (identity) {
        throw new UnprocessableEntityException(
            codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_IDENTITY_NOT_A_CONTACT, {
                field: identity,
            }),
        );
    }
    if ((change as Record<string, unknown>).business !== undefined) {
        throw new UnprocessableEntityException(
            codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_BUSINESS_STATUS_NOT_A_CONTACT),
        );
    }
    const named = CONTACT_FIELDS.filter((field) => change[field] !== undefined);
    return settleContact(change, named);
}

/**
 * The values a correction writes, settled, holding only the fields it names —
 * `null` clears a tax identifier, `undefined` leaves it out. What it replaces is
 * decided where the stored values are read.
 */
export function settleIdentityCorrection(
    correction: SubscriberIdentityCorrection,
): SubscriberIdentityValues {
    const values: Record<string, string | null> = {};
    for (const field of LEGAL_IDENTITY_FIELDS) {
        if (correction[field] === undefined) continue;
        values[field] = settleIdentityValue(field, correction[field]);
    }
    return values as SubscriberIdentityValues;
}

function settleIdentityValue(field: LegalIdentityField, value: unknown): string | null {
    if (field === 'legalName') return settleLegalName(value);
    if (field === 'vatId') return settleVatId(value);
    return settleText(field, value);
}

/** A VAT identification number given as text, in its canonical form (`canonicalVatId`). */
function settleVatId(value: unknown): string | null {
    const text = settleText('vatId', value);
    return text === null ? null : canonicalVatId(text);
}

function settleLegalName(value: unknown): string {
    const legalName = settleText('legalName', value);
    if (legalName === null) {
        throw new UnprocessableEntityException(
            codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_LEGAL_NAME_REQUIRED),
        );
    }
    return legalName;
}

function settleContact(
    source: Partial<SubscriberContact>,
    fields: readonly (keyof SubscriberContact)[],
): SubscriberContact {
    const contact = {} as SubscriberContact;
    for (const field of fields) {
        contact[field] = settleContactValue(field, source[field]);
    }
    return contact;
}

function settleContactValue(field: keyof SubscriberContact, value: unknown): string | null {
    const text = settleText(field, value);
    if (text === null) return null;
    if (field === 'country') {
        const country = text.toUpperCase();
        if (!COUNTRY_CODE.test(country)) throw invalid(field);
        return country;
    }
    if (field === 'invoiceEmail' && !isEmailShaped(text)) throw invalid(field);
    return text;
}

/**
 * Trimmed text, or `null` for nothing. Anything but a string is refused: a
 * number where a name belongs is not a name.
 */
function settleText(field: keyof SubscriberDetails, value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw invalid(field);
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

/**
 * One `@` with something on both sides, a dot in the domain, and no space.
 * Deliberately not a pattern: what is being asked is whether a value is shaped
 * like an address at all, and a scan answers that in one pass on any input.
 */
function isEmailShaped(value: string): boolean {
    if (value.length > MAX_EMAIL_LENGTH) return false;
    const at = value.indexOf('@');
    if (at <= 0 || at !== value.lastIndexOf('@')) return false;
    const domain = value.slice(at + 1);
    const dot = domain.lastIndexOf('.');
    if (dot <= 0 || dot === domain.length - 1) return false;
    return !/\s/.test(value);
}

function invalid(field: keyof SubscriberDetails): UnprocessableEntityException {
    return new UnprocessableEntityException(
        codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_DETAIL_INVALID, { field }),
    );
}

/** The fields of the address an invoice names that are empty. */
export function invoiceAddressGapsOf(
    details: Pick<SubscriberDetails, SubscriberInvoiceAddressField>,
): SubscriberInvoiceAddressField[] {
    return SUBSCRIBER_INVOICE_ADDRESS_FIELDS.filter((field) => details[field] === null);
}

/**
 * Where a tax adapter decides, a contract names its subscriber only once the
 * address an invoice names is complete (`SC-PRIC-032`).
 */
export function identityIncomplete(
    missing: readonly SubscriberInvoiceAddressField[],
): UnprocessableEntityException {
    return new UnprocessableEntityException(
        codedError(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_IDENTITY_INCOMPLETE, {
            missing: [...missing],
        }),
    );
}

/** The empty fields `identityIncomplete` named, or `null` where `error` is another refusal. */
export function identityGapsOf(error: unknown): SubscriberInvoiceAddressField[] | null {
    if (!(error instanceof HttpException)) return null;
    const response = error.getResponse() as { code?: unknown; params?: { missing?: unknown } };
    if (response.code !== SUBSCRIBER_ERROR_CODES.SUBSCRIBER_IDENTITY_INCOMPLETE) return null;
    const missing = response.params?.missing;
    return Array.isArray(missing) ? (missing as SubscriberInvoiceAddressField[]) : [];
}
