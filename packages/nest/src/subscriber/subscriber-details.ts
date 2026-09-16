// What a subscriber's details have to be before they are written: trimmed, a
// blank value recorded as unknown, the legal name present, and the two details
// that have a form — the country and the invoice email — in it.
//
// Every way a detail arrives goes through here: a new subscriber, a contact
// change, a correction of the legal identity. A rule held on one of them and
// not the others would let the same value in through the next door.

import { UnprocessableEntityException } from '@nestjs/common';
import type {
    LegalIdentityField,
    NewSubscriberDetails,
    SubscriberContact,
    SubscriberContactChange,
    SubscriberDetails,
    SubscriberIdentityCorrection,
    SubscriberIdentityValues,
} from '@saasicat/core';
import { SUBSCRIBER_ERROR_CODES, LEGAL_IDENTITY_FIELDS } from '@saasicat/core';

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
        vatId: settleText('vatId', details.vatId),
        taxNumber: settleText('taxNumber', details.taxNumber),
        ...settleContact(details, CONTACT_FIELDS),
    };
}

/**
 * The contact details a change names, settled: `null` clears one, `undefined`
 * leaves it out. A field of the legal identity is refused rather than dropped —
 * a caller that sent a new legal name through here would otherwise be told it
 * succeeded.
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
    return field === 'legalName' ? settleLegalName(value) : settleText(field, value);
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
