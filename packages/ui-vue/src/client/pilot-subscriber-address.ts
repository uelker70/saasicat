// The address of a pilot's subscriber as the pilot dialog asks for it: which
// fields still lack where a contract needs the full address, and what is sent.
// Framework-free, so the dialog only binds it.

import {
    SUBSCRIBER_INVOICE_ADDRESS_FIELDS,
    type SubscriberInvoiceAddressField,
} from '@saasicat/core';

import type { PilotSubscriberAddress } from './resources/pilots.types.js';

/** The fields of the address, in the order the dialog asks for them. */
export const PILOT_SUBSCRIBER_ADDRESS_FIELDS = [
    'addressLine1',
    'addressLine2',
    'postalCode',
    'city',
    'country',
] as const satisfies readonly (keyof PilotSubscriberAddress)[];

export type PilotSubscriberAddressField = (typeof PILOT_SUBSCRIBER_ADDRESS_FIELDS)[number];

/** The address as the dialog's inputs hold it: every field, empty where nothing was entered. */
export type PilotSubscriberAddressForm = { [field in PilotSubscriberAddressField]: string };

/**
 * The fields of the address an invoice names that are still empty, in that
 * order, where `required` — the manifest saying a contract needs the full
 * address. None otherwise. Blanks count as empty; the second line is never
 * required.
 */
export function pilotAddressGaps(
    form: PilotSubscriberAddressForm,
    required: boolean,
): SubscriberInvoiceAddressField[] {
    if (!required) return [];
    return SUBSCRIBER_INVOICE_ADDRESS_FIELDS.filter((field) => form[field].trim() === '');
}

/**
 * What the dialog sends as `subscriber`: the fields entered, trimmed, the
 * country upper-cased; `undefined` where none was, so the payload carries no
 * key a route that refuses unknown keys would have to declare.
 */
export function pilotSubscriberOf(
    form: PilotSubscriberAddressForm,
): PilotSubscriberAddress | undefined {
    const address: PilotSubscriberAddress = {};
    for (const field of PILOT_SUBSCRIBER_ADDRESS_FIELDS) {
        const value = form[field].trim();
        if (value !== '') address[field] = field === 'country' ? value.toUpperCase() : value;
    }
    return Object.keys(address).length > 0 ? address : undefined;
}
