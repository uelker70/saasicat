// The `maxlength` a form gives each contact detail: the bound the platform
// holds a line of the address to, the two letters of a country's code, and
// what an email address can hold. That the platform refuses one character
// more is proved where it refuses, in `@saasicat/nest`.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SUBSCRIBER_ADDRESS_MAX_LENGTHS,
    SUBSCRIBER_CONTACT_FIELDS,
    subscriberContactMaxLengthOf,
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
