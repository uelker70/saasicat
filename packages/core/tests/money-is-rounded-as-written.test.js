// @requirement SC-PRIC-061 — A derived amount is rounded the way a person computing it by hand rounds

// Money is computed from the decimals it was written as and rounded once, half
// away from zero. The reference below never reads a decimal: it works on whole
// cents and hundredths of a per cent as integers, so it cannot share the
// scanner's mistakes, and every case it covers is one where the true result
// lies exactly on, or next to, a half cent.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    computeIncludedVat,
    grossFromNet,
    netFromGross,
    percentOf,
    prorate,
    roundToCents,
    sumToCents,
    toCents,
} from '../dist/index.js';

/** `numerator / denominator` in whole numbers, a half away from zero. */
function reference(numerator, denominator) {
    const sign = Math.sign(numerator) * Math.sign(denominator) || 1;
    const n = Math.abs(numerator);
    const d = Math.abs(denominator);
    const quotient = Math.floor(n / d);
    return sign * ((n % d) * 2 >= d ? quotient + 1 : quotient);
}

describe('the cases a binary double gets wrong', () => {
    for (const [what, actual, expected] of [
        ['5 % of 20.10', () => percentOf(20.1, 5), 1.01],
        ['25 % of 9.54', () => percentOf(9.54, 25), 2.39],
        ['11.50 net at 19 %', () => grossFromNet(11.5, 19), 13.69],
        ['13.50 net at 19 %', () => grossFromNet(13.5, 19), 16.07],
    ]) {
        test(what, () => assert.equal(actual(), expected));
    }
});

describe('a half cent', () => {
    test('rounds up', () => assert.equal(roundToCents(1.005), 1.01));
    test('and the value just below it rounds down', () => assert.equal(roundToCents(1.0049), 1));
    test('a credit rounds away from zero, mirrored', () =>
        assert.equal(roundToCents(-1.005), -1.01));
    test('zero stays zero', () => assert.equal(percentOf(0, 19), 0));
});

describe('against whole-number arithmetic', () => {
    // Every price in cents up to 100 € against every percentage in steps of a
    // quarter — 40 000 prices by 400 rates would be slow, so the rates step
    // through the ones a promo code or a tax table uses, and the prices through
    // every cent.
    const rates = [0.25, 1, 5, 7, 7.7, 12.5, 19, 25, 33.33, 50, 99.99];

    test('a percentage of a price', () => {
        for (let price = 0; price <= 10_000; price += 1) {
            for (const rate of rates) {
                const hundredths = Math.round(rate * 100);
                assert.equal(
                    toCents(percentOf(price / 100, rate)),
                    reference(price * hundredths, 10_000),
                    `${rate} % of ${price / 100}`,
                );
            }
        }
    });

    test('gross from net, net from gross, and the tax a gross amount holds', () => {
        for (let price = 0; price <= 10_000; price += 7) {
            for (const rate of [5, 7, 7.7, 19, 20]) {
                const hundredths = Math.round(rate * 100);
                assert.equal(
                    toCents(grossFromNet(price / 100, rate)),
                    reference(price * (10_000 + hundredths), 10_000),
                );
                assert.equal(
                    toCents(netFromGross(price / 100, rate)),
                    reference(price * 10_000, 10_000 + hundredths),
                );
                assert.equal(
                    toCents(computeIncludedVat(price / 100, rate)),
                    reference(price * hundredths, 10_000 + hundredths),
                );
            }
        }
    });

    test('a share of a price for part of a period', () => {
        for (let price = 0; price <= 5_000; price += 3) {
            for (const [part, whole] of [
                [1, 2],
                [15, 30],
                [1, 31],
                [29, 365],
                [0, 30],
                [30, 30],
            ]) {
                assert.equal(
                    toCents(prorate(price / 100, part, whole)),
                    reference(price * part, whole),
                    `${part}/${whole} of ${price / 100}`,
                );
            }
        }
    });
});

describe('a sum, and a difference', () => {
    test('is taken from the decimals, not from their binary difference', () => {
        // 29.9 − 7.475 is 22.425; in binary it is 22.424999…
        assert.equal(sumToCents(29.9, -7.475), 22.43);
    });

    test('of any number of cent amounts is their sum in cents', () => {
        for (let a = 0; a <= 3_000; a += 7) {
            for (const b of [-1999, -1, 0, 1, 10, 333, 4_999]) {
                for (const c of [0, 5, 1_001]) {
                    assert.equal(toCents(sumToCents(a / 100, b / 100, c / 100)), a + b + c);
                }
            }
        }
    });

    test('of nothing is 0', () => assert.equal(sumToCents(), 0));
});

describe('an amount that is not a number of any kind', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
        test(`${value} is refused rather than rounded`, () => {
            assert.throws(() => roundToCents(value), RangeError);
        });
    }
});
