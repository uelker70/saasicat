// What the German tax adapter decides a charge to be, by its inputs alone:
// the issuer, the subscriber's tax origin, the period and the installation's
// time zone. Each class of case has one representative, and each rate change
// is tested on its last day and the day after.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { GermanTaxAdapter } from '../dist/index.js';

const MANIFEST = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const ADAPTER = { name: '@saasicat/tax-de', version: MANIFEST.version };
const REVERSE_CHARGE = 'Steuerschuldnerschaft des Leistungsempfängers / Reverse charge';
const NOT_TAXABLE = 'Nicht im Inland steuerbare Leistung / Not taxable in Germany';
const SMALL_BUSINESS = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

const ISSUER = { country: 'DE', vatId: 'DE123456789' };
const MAY_2026 = {
    from: new Date('2026-04-30T22:00:00.000Z'),
    until: new Date('2026-05-31T22:00:00.000Z'),
};

/** A subscriber's tax origin; a validated number is the one entered. */
function origin(country, business, validated = false) {
    const vatId = validated ? `${country === 'GR' ? 'EL' : country}U12345678` : null;
    return { country, business, vatId, validatedVatId: vatId };
}

/** Decides for `subscriber`; an option named as `undefined` is passed on as such, not defaulted. */
function decide(subscriber, options = {}) {
    const { issuer = ISSUER, smallBusiness = false, period = MAY_2026 } = options;
    const timeZone = 'timeZone' in options ? options.timeZone : 'Europe/Berlin';
    return new GermanTaxAdapter({ smallBusiness }).decide({
        issuer,
        origin: subscriber,
        period,
        timeZone,
    });
}

function treatment(kind, rate, note) {
    return { supported: true, treatment: { kind, rate, note, adapter: ADAPTER } };
}

/** The reason of an unsupported answer, or a failure naming what was decided instead. */
function refusal(decision) {
    assert.equal(decision.supported, false, `decided ${JSON.stringify(decision)}`);
    return decision.reason;
}

// @requirement SC-PRIC-064 — The German tax adapter decides Germany, businesses abroad and small businesses
describe('a charge for an issuer in Germany', () => {
    test('to a subscriber in Germany carries the German rate, business or consumer or not stated', () => {
        for (const business of [true, false, null]) {
            assert.deepEqual(
                decide(origin('DE', business)),
                treatment('standard', 19, null),
                String(business),
            );
        }
    });

    test('to a business elsewhere in the Union with a validated number is under the reverse charge', () => {
        assert.deepEqual(
            decide(origin('AT', true, true)),
            treatment('reverse-charge', 0, REVERSE_CHARGE),
        );
        assert.deepEqual(
            decide(origin('GR', true, true)),
            treatment('reverse-charge', 0, REVERSE_CHARGE),
        );
    });

    test('to a business outside the Union is not taxable in Germany', () => {
        for (const country of ['CH', 'US', 'GB']) {
            assert.deepEqual(
                decide(origin(country, true)),
                treatment('not-taxable', 0, NOT_TAXABLE),
                country,
            );
        }
    });

    test('by a small business is free of VAT for a subscriber in Germany, and only there', () => {
        const small = { smallBusiness: true };
        assert.deepEqual(
            decide(origin('DE', false), small),
            treatment('small-business', 0, SMALL_BUSINESS),
        );
        assert.deepEqual(
            decide(origin('DE', true), small),
            treatment('small-business', 0, SMALL_BUSINESS),
        );
        assert.deepEqual(
            decide(origin('AT', true, true), small),
            treatment('reverse-charge', 0, REVERSE_CHARGE),
        );
        assert.deepEqual(
            decide(origin('CH', true), small),
            treatment('not-taxable', 0, NOT_TAXABLE),
        );
        assert.match(refusal(decide(origin('AT', false), small)), /consumer outside Germany/);
    });

    test('names the adapter and the version it was published as on every treatment', () => {
        const decided = decide(origin('DE', false));
        assert.deepEqual(decided.treatment.adapter, ADAPTER);
        const adapter = new GermanTaxAdapter();
        assert.deepEqual([adapter.name, adapter.version], [ADAPTER.name, ADAPTER.version]);
    });

    test('the CommonJS build reads the same version', () => {
        const require = createRequire(import.meta.url);
        const { GermanTaxAdapter: FromCjs } = require('../dist/index.cjs');
        assert.equal(new FromCjs().version, MANIFEST.version);
    });
});

// @requirement SC-PRIC-064 — The German tax adapter decides Germany, businesses abroad and small businesses
describe('a case the adapter does not decide is refused, saying why', () => {
    test('an issuer outside Germany, or one whose country is not configured', () => {
        assert.match(
            refusal(decide(origin('DE', true), { issuer: { country: 'AT', vatId: null } })),
            /is AT/,
        );
        assert.match(
            refusal(decide(origin('DE', true), { issuer: { country: null, vatId: null } })),
            /not configured/,
        );
    });

    test('a subscriber whose country is not known', () => {
        assert.match(refusal(decide(origin(null, true))), /country is not known/);
    });

    test('a consumer outside Germany, in the Union or beyond it', () => {
        assert.match(refusal(decide(origin('AT', false, true))), /consumer outside Germany/);
        assert.match(refusal(decide(origin('CH', false))), /consumer outside Germany/);
    });

    test('a subscriber outside Germany who has not said whether it is a business', () => {
        assert.match(refusal(decide(origin('AT', null, true))), /business is not stated/);
        assert.match(refusal(decide(origin('CH', null))), /business is not stated/);
    });

    test('a business elsewhere in the Union whose number is entered but not validated', () => {
        const unchecked = { ...origin('AT', true, true), validatedVatId: null };
        assert.match(refusal(decide(unchecked)), /without a validated VAT identification number/);
    });

    test('a reverse charge for an issuer without a VAT identification number, small business or not', () => {
        for (const smallBusiness of [false, true]) {
            const decided = decide(origin('AT', true, true), {
                issuer: { country: 'DE', vatId: null },
                smallBusiness,
            });
            assert.match(refusal(decided), /issuer has none/, String(smallBusiness));
        }
    });

    test('a validated number of another member state than the address, a German one included', () => {
        const withNumber = (country, vatId) => ({
            country,
            business: true,
            vatId,
            validatedVatId: vatId,
        });
        assert.match(
            refusal(decide(withNumber('AT', 'DE811234567'))),
            /one of DE, the billing address is in AT/,
        );
        assert.match(
            refusal(decide(withNumber('AT', 'FRXX123456789'))),
            /one of FR, the billing address is in AT/,
        );
        // Greece is EL on the number: GR there is another prefix, not the same state.
        assert.match(
            refusal(decide(withNumber('GR', 'GR123456789'))),
            /one of GR, the billing address is in GR/,
        );
    });

    test('a number of a member state with an address outside the Union, validated or only entered', () => {
        const validated = {
            country: 'CH',
            business: true,
            vatId: 'DE811234567',
            validatedVatId: 'DE811234567',
        };
        const entered = {
            country: 'CH',
            business: true,
            vatId: 'FRXX123456789',
            validatedVatId: null,
        };
        assert.match(
            refusal(decide(validated)),
            /one of DE, a member state, the billing address is in CH/,
        );
        assert.match(
            refusal(decide(entered)),
            /one of FR, a member state, the billing address is in CH/,
        );
        const swissNumber = {
            country: 'CH',
            business: true,
            vatId: 'CHE123456789',
            validatedVatId: null,
        };
        assert.deepEqual(decide(swissNumber), treatment('not-taxable', 0, NOT_TAXABLE));
    });

    test('a number is one of a member state by its prefix and the format of that state, not its first letters', () => {
        const outside = (vatId) => ({ country: 'CH', business: true, vatId, validatedVatId: null });
        // One number in each state's published format, Greece also as GR.
        const memberStateNumbers = [
            'ATU12345678',
            'BE0123456789',
            'BG123456789',
            'BG1234567890',
            'CY12345678L',
            'CZ12345678',
            'CZ1234567890',
            'DE123456789',
            'DK12345678',
            'EE123456789',
            'EL123456789',
            'GR123456789',
            'ESX1234567X',
            'ES12345678Z',
            'FI12345678',
            'FRXX123456789',
            'FR12123456789',
            'HR12345678901',
            'HU12345678',
            'IE1S12345L',
            'IE1234567WI',
            'IT12345678901',
            'LT123456789',
            'LT123456789012',
            'LU12345678',
            'LV12345678901',
            'MT12345678',
            'NL123456789B01',
            'PL1234567890',
            'PT123456789',
            'RO12',
            'RO1234567890',
            'SE123456789012',
            'SI12345678',
            'SK1234567890',
        ];
        for (const vatId of memberStateNumbers) {
            assert.match(refusal(decide(outside(vatId))), /a member state/, vatId);
        }
        // A member state's prefix in another shape: an identifier from outside the Union.
        const otherIdentifiers = [
            'LUM850101AB1',
            'DE12345678',
            'AT12345678',
            'NL123456789',
            'ITALIA123',
            'SE12345',
        ];
        for (const vatId of otherIdentifiers) {
            assert.deepEqual(
                decide(outside(vatId)),
                treatment('not-taxable', 0, NOT_TAXABLE),
                vatId,
            );
        }
        const mexican = {
            country: 'MX',
            business: true,
            vatId: 'LUM850101AB1',
            validatedVatId: null,
        };
        assert.deepEqual(decide(mexican), treatment('not-taxable', 0, NOT_TAXABLE));
    });

    test('a business in Monaco, which belongs to the French VAT territory', () => {
        assert.match(refusal(decide(origin('MC', true, true))), /French VAT territory/);
    });
});

/** A month ending at midnight Berlin time on `day`, or `extraMs` after it. */
function periodEndingAt(endIso, extraMs = 0) {
    const until = new Date(new Date(endIso).getTime() + extraMs);
    return { from: new Date(until.getTime() - 30 * 24 * 60 * 60 * 1000), until };
}

// @requirement SC-PRIC-064 — The German tax adapter decides Germany, businesses abroad and small businesses
describe("the rate is the one in force on the period's last day, in the installation's time zone", () => {
    const cases = [
        ['June 2020, ending at midnight Berlin time', '2020-06-30T22:00:00.000Z', 0, 19],
        ['one millisecond into 1 July', '2020-06-30T22:00:00.000Z', 1, 16],
        ['December 2020, ending at midnight Berlin time', '2020-12-31T23:00:00.000Z', 0, 16],
        ['one millisecond into 2021', '2020-12-31T23:00:00.000Z', 1, 19],
        ['one millisecond into 2007', '2006-12-31T23:00:00.000Z', 1, 19],
    ];
    test('each change, on its last day and the millisecond after', () => {
        for (const [name, end, extraMs, rate] of cases) {
            assert.deepEqual(
                decide(origin('DE', false), { period: periodEndingAt(end, extraMs) }),
                treatment('standard', rate, null),
                name,
            );
        }
    });

    test('a period ending before the first rate the adapter knows is refused', () => {
        const decided = decide(origin('DE', false), {
            period: periodEndingAt('2006-12-31T23:00:00.000Z'),
        });
        assert.match(refusal(decided), /No German rate is known for 2006-12-31/);
    });

    test('the same period ends on another day in another zone, and takes the rate of that day', () => {
        const juneInUtc = periodEndingAt('2020-07-01T00:00:00.000Z');
        assert.deepEqual(
            decide(origin('DE', false), { period: juneInUtc, timeZone: 'UTC' }),
            treatment('standard', 19, null),
        );
        assert.deepEqual(
            decide(origin('DE', false), { period: juneInUtc, timeZone: 'Europe/Berlin' }),
            treatment('standard', 16, null),
        );
    });

    test('a malformed period or zone is an error on every path, not only where a rate is looked up', () => {
        const empty = {
            from: new Date('2026-05-01T00:00:00.000Z'),
            until: new Date('2026-05-01T00:00:00.000Z'),
        };
        const paths = [
            ['small business', origin('DE', false), { smallBusiness: true }],
            ['reverse charge', origin('AT', true, true), {}],
            ['not taxable', origin('CH', true), {}],
            ['an issuer abroad', origin('DE', false), { issuer: { country: 'AT', vatId: null } }],
        ];
        for (const [name, subscriber, options] of paths) {
            assert.throws(
                () => decide(subscriber, { ...options, period: empty }),
                RangeError,
                name,
            );
            assert.throws(
                () => decide(subscriber, { ...options, timeZone: 'Mars/Olympus_Mons' }),
                RangeError,
                name,
            );
            assert.throws(
                () => decide(subscriber, { ...options, timeZone: undefined }),
                RangeError,
                name,
            );
        }
    });

    test('a period that does not end after it begins, or a zone nobody knows, is an error', () => {
        const instant = new Date('2026-05-01T00:00:00.000Z');
        assert.throws(
            () => decide(origin('DE', false), { period: { from: instant, until: instant } }),
            RangeError,
        );
        assert.throws(
            () => decide(origin('DE', false), { timeZone: 'Mars/Olympus_Mons' }),
            RangeError,
        );
    });
});
