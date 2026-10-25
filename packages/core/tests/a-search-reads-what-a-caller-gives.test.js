// What the operator's search of subscribers matches, read from the one box it
// types into: a customer number, a legal name or a VAT number, whichever the
// caller on the phone gives. Read here once, so every store matches the same
// text the same way.

// @requirement SC-ADM-036 — An operator finds a subscriber by its number, name or VAT number, tenant or not

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { subscriberSearchTermsOf, tenantLinksInOrder } from '../dist/index.js';

describe('the terms a search matches', () => {
    for (const blank of ['', '   ', '\t\n']) {
        test(`${JSON.stringify(blank)} asks for every subscriber`, () => {
            assert.equal(subscriberSearchTermsOf(blank), null);
        });
    }

    test('a name is matched as typed, trimmed, and names no customer number', () => {
        assert.deepEqual(subscriberSearchTermsOf('  Muster GmbH '), {
            legalName: 'Muster GmbH',
            customerNumber: null,
            vatId: 'MUSTERGMBH',
        });
    });

    for (const [typed, customerNumber] of [
        ['10023', { prefix: null, sequence: 10023 }],
        ['AHP-10023', { prefix: 'AHP-', sequence: 10023 }],
        ['ahp-10023', { prefix: 'ahp-', sequence: 10023 }],
        ['  K-10001 ', { prefix: 'K-', sequence: 10001 }],
        ['010023', { prefix: null, sequence: 10023 }],
    ]) {
        test(`${JSON.stringify(typed)} names the number ${customerNumber.sequence} behind ${customerNumber.prefix ?? 'any prefix'}`, () => {
            assert.deepEqual(subscriberSearchTermsOf(typed)?.customerNumber, customerNumber);
        });
    }

    for (const [why, typed] of [
        ['the number zero', '0'],
        ['a prefix with no number after it', 'AHP-'],
        ['digits that are not at the end', '10023 Muster'],
        ['digits no other script writes as ASCII', '١٠٠٢٣'],
    ]) {
        test(`${why} names no customer number`, () => {
            assert.equal(subscriberSearchTermsOf(typed)?.customerNumber, null);
        });
    }

    test('the largest number a store counts to is a number, the next one is none', () => {
        assert.deepEqual(subscriberSearchTermsOf('K-2147483647')?.customerNumber, {
            prefix: 'K-',
            sequence: 2_147_483_647,
        });
        assert.equal(subscriberSearchTermsOf('K-2147483648')?.customerNumber, null);
        assert.equal(subscriberSearchTermsOf('9'.repeat(200))?.customerNumber, null);
    });

    test('a VAT number typed in one piece names no customer number past what a store counts to', () => {
        assert.deepEqual(subscriberSearchTermsOf('IT12345678901'), {
            legalName: 'IT12345678901',
            customerNumber: null,
            vatId: 'IT12345678901',
        });
    });

    test('a VAT number is matched as a subscriber keeps it: without blanks, dots and hyphens, in capitals', () => {
        assert.equal(subscriberSearchTermsOf(' de 123.456-789 ')?.vatId, 'DE123456789');
    });

    test('a line of blanks around a word takes no longer to read than the word', () => {
        const padded = `${' '.repeat(50_000)}Muster${' '.repeat(50_000)}`;
        const started = performance.now();
        assert.equal(subscriberSearchTermsOf(padded)?.legalName, 'Muster');
        assert.ok(performance.now() - started < 100, 'read in linear time');
    });
});

describe('the tenant links a record lists', () => {
    const at = (iso) => new Date(iso);
    const link = (tenantId, linkedAt, unlinkedAt = null) => ({
        tenantId,
        linkedAt: at(linkedAt),
        unlinkedAt: unlinkedAt && at(unlinkedAt),
    });

    test('the live one first, then the closed ones, the latest closed first', () => {
        const ordered = tenantLinksInOrder([
            link('t-first', '2024-01-01', '2025-01-01'),
            link('t-live', '2026-01-01'),
            link('t-second', '2025-02-01', '2025-12-01'),
        ]);

        assert.deepEqual(
            ordered.map(({ tenantId }) => tenantId),
            ['t-live', 't-second', 't-first'],
        );
    });

    test('two closed at the same moment go by when each was made, then by the tenant', () => {
        const ordered = tenantLinksInOrder([
            link('t-b', '2025-01-01', '2025-06-01'),
            link('t-older', '2024-01-01', '2025-06-01'),
            link('t-a', '2025-01-01', '2025-06-01'),
        ]);

        assert.deepEqual(
            ordered.map(({ tenantId }) => tenantId),
            ['t-a', 't-b', 't-older'],
        );
    });

    test('leaves the list it was given as it was', () => {
        const given = [link('t-old', '2024-01-01', '2025-01-01'), link('t-live', '2026-01-01')];

        tenantLinksInOrder(given);

        assert.deepEqual(
            given.map(({ tenantId }) => tenantId),
            ['t-old', 't-live'],
        );
    });
});
