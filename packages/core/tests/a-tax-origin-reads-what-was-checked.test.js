// What a tax adapter decides from, and the tax answers SaaSiCat keeps, read
// back from what a row holds.
//
// Three things are worth pinning. A VAT identification number counts as
// validated only when the check that counts for it is of that very number and
// found it valid. A check recorded later counts only for the number held and
// never over one that completed later. And a stored treatment or confirmation
// of the wrong shape reads as nothing rather than as half an answer.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SUBSCRIBER_TAX_ORIGIN_FIELDS,
    TAX_TREATMENT_KINDS,
    keepsVatIdCheck,
    taxOriginOf,
    taxOriginWrite,
    taxTreatmentToJson,
    toSubscriberTaxOriginChangeRecord,
    toSubscriberVatIdCheckRecord,
    toTaxOriginValues,
    toTaxTreatment,
    vatIdCheckFromStore,
} from '../dist/index.js';

const CHECKED_AT = new Date('2026-10-01T08:30:00.000Z');

function check(overrides = {}) {
    return {
        vatId: 'ATU12345678',
        checkedAt: CHECKED_AT,
        valid: true,
        service: 'VIES',
        confirmation: { requestIdentifier: 'WAPIAAAAZ1x2y3', name: 'PRÜF GMBH' },
        ...overrides,
    };
}

function subscriber(overrides = {}) {
    return { country: 'AT', business: true, vatId: 'ATU12345678', ...overrides };
}

// @requirement SC-PRIC-040 — A tax identifier is validated before a tax treatment depends on it
describe('a VAT id counts as validated only on a counting check that found that number valid', () => {
    test('a valid check of the number the subscriber has validates it', () => {
        assert.deepEqual(taxOriginOf(subscriber(), check()), {
            country: 'AT',
            business: true,
            vatId: 'ATU12345678',
            validatedVatId: 'ATU12345678',
        });
    });

    test('a check that found it invalid does not', () => {
        assert.equal(taxOriginOf(subscriber(), check({ valid: false })).validatedVatId, null);
    });

    test('nor does a valid check of another number', () => {
        const origin = taxOriginOf(subscriber(), check({ vatId: 'ATU87654321' }));
        assert.equal(origin.vatId, 'ATU12345678');
        assert.equal(origin.validatedVatId, null);
    });

    test('nor no check at all, and a subscriber without a number has none to validate', () => {
        assert.equal(taxOriginOf(subscriber(), null).validatedVatId, null);
        assert.equal(taxOriginOf(subscriber({ vatId: null }), check()).validatedVatId, null);
    });
});

describe('a tax origin', () => {
    test('carries whether the subscriber is a business as recorded, unknown included', () => {
        for (const business of [true, false, null]) {
            assert.equal(taxOriginOf(subscriber({ business }), null).business, business);
        }
    });
});

// @requirement SC-PRIC-040 — A tax identifier is validated before a tax treatment depends on it
describe('a check counts only for the number held, completed while held, never over a later one', () => {
    const later = check({ checkedAt: new Date('2026-10-02T08:30:00.000Z'), valid: false });
    const held = (overrides = {}) => ({ vatId: 'ATU12345678', vatIdSince: null, ...overrides });

    test('over no check, an older check, or one of a number corrected away', () => {
        assert.equal(keepsVatIdCheck(held(), null, check()), true);
        assert.equal(keepsVatIdCheck(held(), check(), later), true);
        assert.equal(keepsVatIdCheck(held(), check({ vatId: 'ATU87654321' }), check()), true);
    });

    test('not over a check that completed later, so an older valid never replaces a newer invalid', () => {
        assert.equal(keepsVatIdCheck(held(), later, check()), false);
    });

    test('of two with the same date, the one written last', () => {
        assert.equal(keepsVatIdCheck(held(), check(), check({ valid: false })), true);
    });

    test('not for a number the subscriber does not hold', () => {
        assert.equal(keepsVatIdCheck(held({ vatId: 'ATU87654321' }), null, check()), false);
        assert.equal(keepsVatIdCheck(held({ vatId: null }), null, check()), false);
    });

    test('not when it completed before the number was last set, and from that moment on', () => {
        const since = (at) => held({ vatIdSince: new Date(at) });
        assert.equal(keepsVatIdCheck(since('2026-10-01T08:30:00.001Z'), null, check()), false);
        assert.equal(keepsVatIdCheck(since('2026-10-01T08:30:00.000Z'), null, check()), true);
        assert.equal(keepsVatIdCheck(since('2026-10-01T08:29:59.999Z'), null, check()), true);
    });
});

describe('a recorded VAT id check', () => {
    const row = (confirmation) => ({
        id: 'check-1',
        subscriberId: 'subscriber-1',
        vatId: 'ATU12345678',
        checkedAt: CHECKED_AT,
        valid: true,
        service: 'VIES',
        confirmation,
        recordedAt: CHECKED_AT,
    });

    test('reads back as it was answered', () => {
        assert.deepEqual(toSubscriberVatIdCheckRecord(row(check().confirmation)), {
            ...check(),
            id: 'check-1',
            subscriberId: 'subscriber-1',
            recordedAt: CHECKED_AT,
        });
    });

    test('keeps the confirmation as text, and leaves out what is not', () => {
        assert.deepEqual(
            toSubscriberVatIdCheckRecord(
                row({ requestIdentifier: 'WAPI1', valid: true, address: null }),
            ).confirmation,
            { requestIdentifier: 'WAPI1' },
        );
        assert.deepEqual(toSubscriberVatIdCheckRecord(row('nonsense')).confirmation, {});
    });
});

describe('a stored tax treatment', () => {
    const treatment = {
        kind: 'reverse-charge',
        rate: 0,
        note: 'Steuerschuldnerschaft des Leistungsempfängers',
        adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
    };

    test('reads back as it was decided, for every kind there is', () => {
        for (const kind of TAX_TREATMENT_KINDS) {
            const decided = { ...treatment, kind };
            const stored = JSON.parse(JSON.stringify(taxTreatmentToJson(decided)));
            assert.deepEqual(toTaxTreatment(stored), decided);
        }
        assert.deepEqual(toTaxTreatment({ ...treatment, kind: 'standard', rate: 19, note: null }), {
            ...treatment,
            kind: 'standard',
            rate: 19,
            note: null,
        });
    });

    for (const [what, value] of [
        ['nothing', null],
        ['a kind no adapter names', { ...treatment, kind: 'zero-rated' }],
        ['a rate written as text', { ...treatment, rate: '19' }],
        ['a rate that is no number', { ...treatment, rate: Number.NaN }],
        ['a note that is no text', { ...treatment, note: 7 }],
        ['no adapter', { ...treatment, adapter: null }],
        ['an adapter without a version', { ...treatment, adapter: { name: 'x' } }],
    ]) {
        test(`reads ${what} as no treatment`, () => {
            assert.equal(toTaxTreatment(value), null);
        });
    }
});

describe('a write to the tax origin', () => {
    const current = { country: 'DE', business: null, vatId: null };

    test('holds only the fields that move, with the values they replace', () => {
        assert.deepEqual(
            taxOriginWrite(current, { country: 'AT', business: null, vatId: 'ATU12345678' }),
            {
                previous: { country: 'DE', vatId: null },
                changed: { country: 'AT', vatId: 'ATU12345678' },
                moved: true,
                endsCountingVatIdCheck: true,
            },
        );
    });

    test('moves nothing for a field left out or named with the value it has', () => {
        assert.deepEqual(taxOriginWrite(current, { country: 'DE', vatId: undefined }), {
            previous: {},
            changed: {},
            moved: false,
            endsCountingVatIdCheck: false,
        });
    });

    test('tells false apart from not stated, and keeps the counting check while the number stays', () => {
        assert.deepEqual(taxOriginWrite(current, { business: false }), {
            previous: { business: null },
            changed: { business: false },
            moved: true,
            endsCountingVatIdCheck: false,
        });
    });

    test('ends the counting check when the number is cleared, too', () => {
        assert.equal(
            taxOriginWrite({ ...current, vatId: 'ATU12345678' }, { vatId: null })
                .endsCountingVatIdCheck,
            true,
        );
    });

    test('names the fields of the tax origin once, in the order they are shown', () => {
        assert.deepEqual([...SUBSCRIBER_TAX_ORIGIN_FIELDS], ['country', 'business', 'vatId']);
    });

    test('reads back as recorded, a value of the wrong type as unknown and a stray field not at all', () => {
        assert.deepEqual(
            toTaxOriginValues({ country: 'AT', business: 'yes', vatId: 7, legalName: 'X' }),
            { country: 'AT', business: null, vatId: null },
        );
        assert.deepEqual(toTaxOriginValues('nonsense'), {});
        assert.deepEqual(
            toSubscriberTaxOriginChangeRecord({
                id: 'change-1',
                subscriberId: 'subscriber-1',
                previous: { business: null },
                changed: { business: true },
                changedBy: 'operator:anna',
                changedAt: CHECKED_AT,
                reason: 'Trade register extract handed in',
            }),
            {
                id: 'change-1',
                subscriberId: 'subscriber-1',
                previous: { business: null },
                changed: { business: true },
                changedBy: 'operator:anna',
                changedAt: CHECKED_AT,
                reason: 'Trade register extract handed in',
            },
        );
    });
});

// @requirement SC-REG-023 — Step 4 refuses before the payment form what no contract could follow
describe('the check a sign-up kept, as its store gives it back', () => {
    const CHECK = {
        vatId: 'ATU12345678',
        checkedAt: CHECKED_AT,
        valid: true,
        service: 'VIES',
        confirmation: { requestIdentifier: 'R-1' },
    };

    test('kept as JSON, it comes back with its date as a date', () => {
        const back = vatIdCheckFromStore(JSON.parse(JSON.stringify(CHECK)));
        assert.ok(back.checkedAt instanceof Date);
        assert.deepEqual(back, CHECK);
    });

    for (const [what, stored] of [
        ['nothing', null],
        ['a check without a date', { ...CHECK, checkedAt: undefined }],
        ['a date that is not one', { ...CHECK, checkedAt: 'yesterday' }],
        ['a validity that is not true or false', { ...CHECK, valid: 'yes' }],
        ['no number', { ...CHECK, vatId: undefined }],
        ['no service', { ...CHECK, service: 42 }],
    ]) {
        test(`${what} reads as no check: the number never counts as validated on it`, () => {
            assert.equal(vatIdCheckFromStore(stored), null);
        });
    }
});
