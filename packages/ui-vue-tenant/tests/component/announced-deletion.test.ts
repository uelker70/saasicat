import { describe, expect, test } from 'vitest';

import { deletionSentence } from '../../src/announced-deletion';

// The sentence of how long a tenant's data stays readable and the day it is
// deleted on writes the two days the server named, through the application's
// own formatter, and is no sentence at all where the server named none.

const TEMPLATE = 'readable until {readOnlyUntil}, deleted on {deletesOn}';
const written = (iso: string) => `[${iso.slice(0, 10)}]`;

describe('the deletion sentence', () => {
    test('writes each day the server named through the application’s formatter', () => {
        expect(
            deletionSentence(
                TEMPLATE,
                { readOnlyDays: 30, readOnlyUntil: '2027-01-29', deletesOn: '2027-01-30' },
                written,
            ),
        ).toBe('readable until [2027-01-29], deleted on [2027-01-30]');
    });

    test.each([
        ['names none', null],
        ['predates the days', undefined],
    ])('is none where the server %s', (_, deletion) => {
        expect(deletionSentence(TEMPLATE, deletion, written)).toBeNull();
    });
});
