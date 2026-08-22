// Tests for @saasicat/nest/promo — calculator + math.
// Pure-function tests; no DB, no NestJS DI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addCycles,
    buildLabel,
    computeDiscountGross,
    computeDiscountedGross,
    computeIncludedVat,
    computeRegularStartsAt,
    grossFromNet,
    round2,
} from '../dist/promo/index.js';

// ──────────────────────────────────────────────────────────────────
// Math
// ──────────────────────────────────────────────────────────────────

test('round2 rounds to two decimal places', () => {
    assert.equal(round2(1.234), 1.23);
    assert.equal(round2(1.235), 1.24);
    assert.equal(round2(0.1 + 0.2), 0.3);
    // round2 uses Math.round(n*100)/100 — FP edge cases like 1.005 (which is
    // internally 1.00499…) round down. This matches the original implementation.
    assert.equal(round2(1.005), 1);
});

test('grossFromNet adds VAT', () => {
    assert.equal(grossFromNet(100, 19), 119);
    assert.equal(grossFromNet(24.9, 19), 29.63);
});

test('computeIncludedVat extracts VAT from gross', () => {
    assert.equal(computeIncludedVat(119, 19), 19);
    assert.equal(computeIncludedVat(29.63, 19), 4.73);
});

// ──────────────────────────────────────────────────────────────────
// Calculator: discounts
// ──────────────────────────────────────────────────────────────────

test('computeDiscountGross PERCENT 25%', () => {
    const result = computeDiscountGross({ gross: 100 }, { valueType: 'PERCENT', value: 25 });
    assert.equal(result, 25);
});

test('computeDiscountGross ABSOLUTE 30 EUR', () => {
    const result = computeDiscountGross({ gross: 100 }, { valueType: 'ABSOLUTE', value: 30 });
    assert.equal(result, 30);
});

test('computeDiscountGross accepts a Prisma decimal string', () => {
    // Prisma returns a decimal as a string — Number(string) must work.
    const result = computeDiscountGross({ gross: 100 }, { valueType: 'PERCENT', value: '25' });
    assert.equal(result, 25);
});

test('computeDiscountedGross subtracts', () => {
    assert.equal(computeDiscountedGross(100, 25), 75);
    assert.equal(computeDiscountedGross(50, 12.5), 37.5);
    // FP edge case: 29.9 - 7.475 would mathematically be 22.425, but FP yields ~22.4249…,
    // so round2 → 22.42. We accept this because the original logic
    // behaves identically.
    assert.equal(computeDiscountedGross(29.9, 7.475), 22.42);
});

// ──────────────────────────────────────────────────────────────────
// Calculator: date math
// ──────────────────────────────────────────────────────────────────

// Check date components in local time — the calculator functions use
// setMonth/setFullYear (local time), as in the original template. This keeps the
// tests timezone- and DST-stable.
function expectLocalDate(actual, year, monthIndex, day) {
    assert.equal(actual.getFullYear(), year);
    assert.equal(actual.getMonth(), monthIndex);
    assert.equal(actual.getDate(), day);
}

test('addCycles MONTHLY +3', () => {
    const start = new Date(2026, 0, 15, 12, 0, 0); // 2026-01-15 local
    const result = addCycles(start, 'MONTHLY', 3);
    expectLocalDate(result, 2026, 3, 15);
});

test('addCycles YEARLY +2', () => {
    const start = new Date(2026, 0, 15, 12, 0, 0);
    const result = addCycles(start, 'YEARLY', 2);
    expectLocalDate(result, 2028, 0, 15);
});

test('computeRegularStartsAt ONCE → one period', () => {
    const start = new Date(2026, 0, 15, 12, 0, 0);
    const result = computeRegularStartsAt(start, 'MONTHLY', 'ONCE', null);
    expectLocalDate(result, 2026, 1, 15);
});

test('computeRegularStartsAt MONTHS 6', () => {
    const start = new Date(2026, 0, 15, 12, 0, 0);
    const result = computeRegularStartsAt(start, 'YEARLY', 'MONTHS', 6);
    expectLocalDate(result, 2026, 6, 15);
});

test('computeRegularStartsAt BILLING_CYCLES 2 (YEARLY)', () => {
    const start = new Date(2026, 0, 15, 12, 0, 0);
    const result = computeRegularStartsAt(start, 'YEARLY', 'BILLING_CYCLES', 2);
    expectLocalDate(result, 2028, 0, 15);
});

// ──────────────────────────────────────────────────────────────────
// Calculator: Labels
// ──────────────────────────────────────────────────────────────────

test('buildLabel ONCE PERCENT', () => {
    const label = buildLabel(
        { valueType: 'PERCENT', value: 25, durationType: 'ONCE', durationValue: null },
        'MONTHLY',
    );
    assert.equal(label, '25 % once');
});

test('buildLabel MONTHS 6 ABSOLUTE', () => {
    const label = buildLabel(
        { valueType: 'ABSOLUTE', value: 5, durationType: 'MONTHS', durationValue: 6 },
        'MONTHLY',
    );
    assert.equal(label, '5,00 € for 6 months');
});

test('buildLabel BILLING_CYCLES 1 YEARLY → "for the first year"', () => {
    const label = buildLabel(
        { valueType: 'PERCENT', value: 10, durationType: 'BILLING_CYCLES', durationValue: 1 },
        'YEARLY',
    );
    assert.equal(label, '10 % for the first year');
});

test('buildLabel MONTHS 1 → singular', () => {
    const label = buildLabel(
        { valueType: 'PERCENT', value: 25, durationType: 'MONTHS', durationValue: 1 },
        'MONTHLY',
    );
    assert.equal(label, '25 % for the first month');
});

// ──────────────────────────────────────────────────────────────────
// Calculator: label locale + currency
// ──────────────────────────────────────────────────────────────────

// The label travels over the wire (promo preview `label`), so the output of
// the argument-free call is a contract, down to the bytes. Grouping, decimal
// separator, symbol and the plain space in front of it are all pinned here.
test('buildLabel without options keeps the de-DE/EUR output it always had', () => {
    const absolute = buildLabel(
        { valueType: 'ABSOLUTE', value: 1234.56, durationType: 'MONTHS', durationValue: 1 },
        'MONTHLY',
    );
    assert.equal(absolute, '1.234,56 € for the first month');

    const percent = buildLabel(
        { valueType: 'PERCENT', value: 12.5, durationType: 'ONCE', durationValue: null },
        'MONTHLY',
    );
    assert.equal(percent, '12,5 % once');
});

test('buildLabel formats the amount in the given locale', () => {
    const label = buildLabel(
        { valueType: 'ABSOLUTE', value: 1234.56, durationType: 'MONTHS', durationValue: 1 },
        'MONTHLY',
        { locale: 'en-US' },
    );
    assert.equal(label, '€1,234.56 for the first month');
});

test('buildLabel formats the percentage in the given locale', () => {
    // English writes `25%` closed up, German `25 %` — the spacing is the
    // locale's decision, not this function's.
    const label = buildLabel(
        { valueType: 'PERCENT', value: 25, durationType: 'ONCE', durationValue: null },
        'MONTHLY',
        { locale: 'en-US' },
    );
    assert.equal(label, '25% once');
});

test('buildLabel uses the given currency, symbol and decimals', () => {
    assert.equal(
        buildLabel(
            { valueType: 'ABSOLUTE', value: 30, durationType: 'ONCE', durationValue: null },
            'MONTHLY',
            { locale: 'en-US', currency: 'USD' },
        ),
        '$30.00 once',
    );
    // The minor-unit count belongs to the currency: yen have none.
    assert.equal(
        buildLabel(
            { valueType: 'ABSOLUTE', value: 3000, durationType: 'ONCE', durationValue: null },
            'MONTHLY',
            { locale: 'en-US', currency: 'JPY' },
        ),
        '¥3,000 once',
    );
});

test('buildLabel ignores the currency for percentage codes', () => {
    const label = buildLabel(
        { valueType: 'PERCENT', value: 25, durationType: 'ONCE', durationValue: null },
        'MONTHLY',
        { locale: 'de-DE', currency: 'JPY' },
    );
    assert.equal(label, '25 % once');
});

test('buildLabel keeps non-breaking spaces out of the label', () => {
    // ICU spaces the unit — and in some locales the thousands — with U+00A0
    // and, since ICU 72, with U+202F. An invisible character that changes with
    // the runtime's ICU version has no business on the wire, so no label in
    // any locale may carry one.
    const locales = ['de-DE', 'en-US', 'fr-FR', 'de-CH'];
    const currencies = ['EUR', 'USD', 'CHF'];
    for (const locale of locales) {
        for (const currency of currencies) {
            for (const valueType of ['ABSOLUTE', 'PERCENT']) {
                const label = buildLabel(
                    { valueType, value: 1234.5, durationType: 'ONCE', durationValue: null },
                    'MONTHLY',
                    { locale, currency },
                );
                assert.ok(
                    !/[\u00A0\u202F]/.test(label),
                    `non-breaking space in ${valueType} label for ${locale}/${currency}: ${JSON.stringify(label)}`,
                );
            }
        }
    }
});

const ONCE = { valueType: 'ABSOLUTE', value: 30, durationType: 'ONCE', durationValue: null };
const label = (options) => buildLabel(ONCE, 'MONTHLY', options);

test('buildLabel rejects an unusable locale instead of guessing one', () => {
    // Malformed: `Intl` rejects this by itself.
    assert.throws(() => label({ locale: 'de_DE' }), RangeError);

    // Well formed and unknown: `Intl` does NOT reject it — it resolves to the
    // runtime default and formats an amount in a language nobody chose. That is
    // what a typed tag actually looks like when it is wrong, so it is the case
    // worth a check.
    assert.equal(new Intl.NumberFormat('zz-ZZ').resolvedOptions().locale, 'en-US');
    assert.throws(() => label({ locale: 'zz-ZZ' }), RangeError);
});

test('but an unknown region on a known language is not unusable', () => {
    // Where the check stops, stated so it is a decision and not an oversight:
    // `supportedLocalesOf` accepts a known language with a region it does not
    // know, and the fallback stays inside that language. A typo there costs a
    // separator, not a language.
    assert.deepEqual(Intl.NumberFormat.supportedLocalesOf(['de-ED']), ['de-ED']);
    assert.equal(label({ locale: 'de-ED' }), '30,00 € once');
});

test('buildLabel does not police the currency, and says why', () => {
    // `Intl` renders a three-letter code it does not know as itself — wrong but
    // visible, where a wrong locale is silent. And the only enumeration
    // available cannot tell a made-up code from an assigned one it omits:
    assert.equal(Intl.supportedValuesOf('currency').includes('XAU'), false);
    assert.match(
        new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'XAU' })
            .format(30)
            .replace(/[\u00A0\u202F]/g, ' '),
        /^30,00 XAU$/,
    );
    // XAU is gold. Checking against that list would reject it to catch a typo
    // the operator can already see.
    assert.equal(label({ currency: 'XAU' }), '30,00 XAU once');
    // A real code still works, including one with no minor units.
    assert.equal(label({ locale: 'ja-JP', currency: 'JPY' }), '￥30 once');
});

test('and a percentage ignores the currency, as its option says', () => {
    assert.equal(
        buildLabel(
            { valueType: 'PERCENT', value: 25, durationType: 'ONCE', durationValue: null },
            'MONTHLY',
            { currency: 'XAU' },
        ),
        '25 % once',
    );
});
