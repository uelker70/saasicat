// The `maxlength` a form gives each detail of a subscriber: the bound the
// platform holds a line of the address to, the two letters of a country's
// code, what an email address can hold, and the bounds of the legal name and
// the tax identifiers. That the platform refuses one character more is proved
// where it refuses, in `@saasicat/nest`.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    INVOICE_SUBSCRIBER_DETAILS,
    invoiceCorrectionMaxLengthOf,
    LEGAL_IDENTITY_FIELDS,
    SUBSCRIBER_ADDRESS_MAX_LENGTHS,
    SUBSCRIBER_CONTACT_FIELDS,
    SUBSCRIBER_LEGAL_NAME_MAX_LENGTH,
    SUBSCRIBER_TAX_IDENTIFIER_MAX_LENGTH,
    subscriberContactMaxLengthOf,
    subscriberIdentityMaxLengthOf,
} from '../dist/index.js';

describe('the input of a contact detail', () => {
    test('holds a line of the address to its bound, the country to two letters and the email to 254', () => {
        assert.deepEqual(
            Object.fromEntries(
                SUBSCRIBER_CONTACT_FIELDS.map((field) => [
                    field,
                    subscriberContactMaxLengthOf(field),
                ]),
            ),
            { ...SUBSCRIBER_ADDRESS_MAX_LENGTHS, country: 2, invoiceEmail: 254 },
        );
    });
});

// @requirement SC-SUB-050 — Legal name, tax identifiers and country hold one bound and one form at every way in
describe('the input of a detail of the legal identity', () => {
    test('holds the legal name to 300 and each tax identifier to 30', () => {
        assert.deepEqual(
            [SUBSCRIBER_LEGAL_NAME_MAX_LENGTH, SUBSCRIBER_TAX_IDENTIFIER_MAX_LENGTH],
            [300, 30],
        );
        assert.deepEqual(
            Object.fromEntries(
                LEGAL_IDENTITY_FIELDS.map((field) => [field, subscriberIdentityMaxLengthOf(field)]),
            ),
            { legalName: 300, vatId: 30, taxNumber: 30 },
        );
    });

    test("the operator's correction of an invoice holds each detail to the bound it has wherever it arrives", () => {
        assert.deepEqual(
            Object.fromEntries(
                INVOICE_SUBSCRIBER_DETAILS.map((detail) => [
                    detail,
                    invoiceCorrectionMaxLengthOf(detail),
                ]),
            ),
            {
                ...SUBSCRIBER_ADDRESS_MAX_LENGTHS,
                legalName: 300,
                vatId: 30,
                taxNumber: 30,
                country: 2,
            },
        );
    });
});
