// The pilot dialog asks for the address of the pilot's subscriber. Where the
// manifest says a contract needs the full address, the street, postal code,
// city and country are required, and the dialog does not submit without them;
// otherwise every field is optional and an empty address sends nothing. What
// is sent is trimmed, the country upper-cased: the route judges its form.

// @requirement SC-SPEC-010 — The operator gives a pilot's subscriber its address, required under a tax adapter

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { pilotAddressGaps, pilotSubscriberOf } from '../dist/client/index.js';

const EMPTY = { addressLine1: '', addressLine2: '', postalCode: '', city: '', country: '' };
const FULL = {
    addressLine1: ' Hauptstraße 1 ',
    addressLine2: '',
    postalCode: '10115',
    city: 'Berlin ',
    country: ' de',
};

describe('where a contract needs the full address', () => {
    test('an empty address lacks the four an invoice names, in their order', () => {
        assert.deepEqual(pilotAddressGaps(EMPTY, true), [
            'addressLine1',
            'postalCode',
            'city',
            'country',
        ]);
    });

    test('all four given lack nothing, and are sent trimmed with the country upper-cased', () => {
        assert.deepEqual(pilotAddressGaps(FULL, true), []);
        assert.deepEqual(pilotSubscriberOf(FULL), {
            addressLine1: 'Hauptstraße 1',
            postalCode: '10115',
            city: 'Berlin',
            country: 'DE',
        });
    });

    test('a city of blanks is no city', () => {
        assert.deepEqual(pilotAddressGaps({ ...FULL, city: '   ' }, true), ['city']);
    });

    test('the second line is never required, and sent when given', () => {
        const withSecondLine = { ...FULL, addressLine2: ' Hinterhaus ' };
        assert.deepEqual(pilotAddressGaps(withSecondLine, true), []);
        assert.equal(pilotSubscriberOf(withSecondLine).addressLine2, 'Hinterhaus');
    });
});

describe('where it does not', () => {
    test('an empty address lacks nothing and sends nothing', () => {
        assert.deepEqual(pilotAddressGaps(EMPTY, false), []);
        assert.equal(pilotSubscriberOf(EMPTY), undefined);
    });

    test('blanks alone send nothing either', () => {
        assert.equal(pilotSubscriberOf({ ...EMPTY, city: '  ', addressLine2: ' ' }), undefined);
    });

    test('a city alone is sent alone', () => {
        const cityOnly = { ...EMPTY, city: 'Berlin' };
        assert.deepEqual(pilotAddressGaps(cityOnly, false), []);
        assert.deepEqual(pilotSubscriberOf(cityOnly), { city: 'Berlin' });
    });
});
