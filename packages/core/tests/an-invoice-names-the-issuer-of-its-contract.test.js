// Which issuer an invoice names: the counterparty of its contract, with the
// corrections the operator declared for that entity since, at the address the
// file names while it names that entity — and the contract's copy otherwise.
//
// The whole rule is one pure function over the contract's copy, the file's
// issuer and the recorded settings changes, so the cases are enumerated here.
// The recorded changes are what a start writes when the file moved
// (`SettingsChangeRecord`): the file it replaced and the file it applied, the
// declaration of a correction included.

// @requirement SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { invoiceIssuerOf } from '../dist/index.js';

/** The issuer as a contract concluded in 2025 copied it. */
const COPY = {
    legalName: 'Example Softwre GmbH',
    vatId: 'DE123456789',
    taxNumber: null,
    addressLine1: 'Old Street 1',
    addressLine2: null,
    postalCode: '80331',
    city: 'München',
    country: 'DE',
};

/** The same entity, its name spelt right, moved to another address. */
const CORRECTED = {
    ...COPY,
    legalName: 'Example Software GmbH',
    addressLine1: 'New Street 9',
    postalCode: '80333',
};

/** A start that applied a file naming `after` where the one before named `before`. */
function step(before, after, correctionOf) {
    return {
        previous: { issuer: before },
        current: { issuer: correctionOf ? { ...after, correctionOf } : after },
    };
}

const DECLARED = { legalName: COPY.legalName, reason: 'Misspelt at registration' };

describe('the issuer an invoice names', () => {
    test('is the file’s, address and all, while the file names the entity the contract copied', () => {
        const moved = { ...COPY, addressLine1: 'New Street 9', postalCode: '80333' };

        assert.deepEqual(invoiceIssuerOf(COPY, moved, []), moved);
    });

    test('is the file’s where the operator declared the change a correction of that entity', () => {
        const history = [step(COPY, CORRECTED, DECLARED)];

        assert.deepEqual(invoiceIssuerOf(COPY, CORRECTED, history), CORRECTED);
    });

    test('follows one declared correction after another back to the copy', () => {
        const renamed = { ...CORRECTED, legalName: 'Example Software SE', vatId: 'DE999999999' };
        const history = [
            step(COPY, CORRECTED, DECLARED),
            step(CORRECTED, renamed, {
                legalName: CORRECTED.legalName,
                vatId: CORRECTED.vatId,
                reason: 'Change of legal form',
            }),
        ];

        assert.deepEqual(invoiceIssuerOf(COPY, renamed, history), renamed);
    });

    test('stays the corrected one after the declaration has left the file', () => {
        const history = [step(COPY, CORRECTED, DECLARED), step(CORRECTED, CORRECTED)];

        assert.deepEqual(invoiceIssuerOf(COPY, CORRECTED, history), CORRECTED);
    });

    test('is the contract’s copy where nothing recorded connects it to the file’s entity', () => {
        const other = { ...CORRECTED, legalName: 'Successor AG', vatId: 'DE111111111' };

        assert.deepEqual(invoiceIssuerOf(COPY, other, []), COPY);
    });

    test('is the contract’s copy where the recorded change was not declared a correction', () => {
        const other = { ...CORRECTED, legalName: 'Successor AG', vatId: 'DE111111111' };

        assert.deepEqual(invoiceIssuerOf(COPY, other, [step(COPY, other)]), COPY);
    });

    test('is the contract’s copy where the declaration names another value than the copy holds', () => {
        const history = [
            step(COPY, CORRECTED, { legalName: 'Somebody Else GmbH', reason: 'Typo' }),
        ];

        assert.deepEqual(invoiceIssuerOf(COPY, CORRECTED, history), COPY);
    });

    test('is not moved by a correction of an entity the contract was not concluded with', () => {
        const unrelated = { ...COPY, legalName: 'Unrelated GmbH' };
        const history = [
            step(unrelated, CORRECTED, { legalName: 'Unrelated GmbH', reason: 'Typo' }),
        ];

        assert.deepEqual(invoiceIssuerOf(COPY, CORRECTED, history), COPY);
    });

    test('is not moved by a recorded change of any other setting', () => {
        const history = [
            {
                previous: { issuer: COPY, vatRate: 19, timeZone: 'Europe/Berlin' },
                current: { issuer: COPY, vatRate: 7, timeZone: 'Europe/Vienna' },
            },
        ];
        const other = { ...CORRECTED, legalName: 'Successor AG' };

        assert.deepEqual(invoiceIssuerOf(COPY, COPY, history), COPY);
        assert.deepEqual(invoiceIssuerOf(COPY, other, history), COPY);
    });

    test('is the contract’s copy where the file names no issuer', () => {
        assert.deepEqual(invoiceIssuerOf(COPY, null, []), COPY);
    });

    test('reads the copy and the file the way the start does, so a stray space is the same entity', () => {
        const spaced = { ...CORRECTED, legalName: ` ${COPY.legalName} ` };

        assert.deepEqual(invoiceIssuerOf(COPY, spaced, []), spaced);
    });

    test('reads a recorded block it cannot use as no identity rather than as a wrong one', () => {
        const history = [{ previous: { issuer: 'not a block' }, current: { issuer: [CORRECTED] } }];

        assert.deepEqual(invoiceIssuerOf(COPY, CORRECTED, history), COPY);
    });
});
