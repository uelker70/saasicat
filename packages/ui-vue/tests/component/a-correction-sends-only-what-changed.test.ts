// What a correction dialog sends, read off its form: only the fields that
// changed, a blank tax identifier as cleared, never a blank reason or a blank
// legal name. The dialogs keep their confirming button disabled while the rule
// answers `null`, so each class below is also what the operator can submit.

// @requirement SC-SUB-041 — The operator corrects a subscriber's identity and business status, with a reason

import { describe, expect, test } from 'vitest';

import {
    businessStatusChangeOf,
    identityCorrectionOf,
} from '../../src/internal/tenant-detail/subscriber-corrections.js';

const HELD = { legalName: 'Wien GmbH', vatId: 'ATU12345678', taxNumber: null };
const UNCHANGED = { legalName: 'Wien GmbH', vatId: 'ATU12345678', taxNumber: '', reason: '' };

describe('the identity correction the form describes', () => {
    test.each([
        ['no reason', { legalName: 'Wien AG' }],
        ['a reason of blanks only', { legalName: 'Wien AG', reason: '   ' }],
        ['a blank legal name', { legalName: '  ', reason: 'Renamed' }],
        ['a reason but no change', { reason: 'Checked, all correct' }],
        ['a change only in the blanks around a value', { legalName: ' Wien GmbH ', reason: 'x' }],
        ['a blank tax number where none is held', { taxNumber: '   ', reason: 'x' }],
        ['the VAT number held, in another spelling', { vatId: 'atu 123.456-78', reason: 'x' }],
    ])('is none for %s', (_, form) => {
        expect(identityCorrectionOf(HELD, { ...UNCHANGED, ...form })).toBeNull();
    });

    test.each([
        [
            'a new legal name, trimmed',
            { legalName: ' Wien AG ', reason: ' Renamed ' },
            { legalName: 'Wien AG', reason: 'Renamed' },
        ],
        [
            'another VAT number, in the form the platform keeps it',
            { vatId: ' atu 876.543-21 ', reason: 'New number' },
            { vatId: 'ATU87654321', reason: 'New number' },
        ],
        [
            'a cleared VAT number',
            { vatId: '  ', reason: 'Not registered for VAT' },
            { vatId: null, reason: 'Not registered for VAT' },
        ],
        [
            'a first tax number',
            { taxNumber: '12/345/67890', reason: 'Handed in' },
            { taxNumber: '12/345/67890', reason: 'Handed in' },
        ],
        [
            'two changes at once, and only those',
            { legalName: 'Wien AG', taxNumber: '12/345/67890', reason: 'Register extract' },
            { legalName: 'Wien AG', taxNumber: '12/345/67890', reason: 'Register extract' },
        ],
    ])('sends %s', (_, form, expected) => {
        expect(identityCorrectionOf(HELD, { ...UNCHANGED, ...form })).toEqual(expected);
    });
});

describe('the change of business status the form describes', () => {
    test.each([
        ['the status held', true, { business: true, reason: 'Confirmed' }],
        ['no reason', true, { business: false, reason: '' }],
        ['a reason of blanks only', null, { business: true, reason: '  ' }],
    ])('is none for %s', (_, held, form) => {
        expect(businessStatusChangeOf(held, form)).toBeNull();
    });

    test.each([
        ['business to consumer', true, false],
        ['not stated to business', null, true],
        ['business to not stated', true, null],
    ])('sends %s, the reason trimmed', (_, held, business) => {
        expect(businessStatusChangeOf(held, { business, reason: ' Sole trader ' })).toEqual({
            business,
            reason: 'Sole trader',
        });
    });
});
