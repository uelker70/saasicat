// What the invoice register spans and what its invoices add up to: the months
// an operator asks for, read in the installation's zone, and the sums an
// advisor reports from — per month, currency, tax treatment and rate.

// @requirement SC-ADM-042 — An operator lists the invoices of chosen months, summed per tax treatment and rate

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    INVOICE_ERROR_CODES,
    INVOICE_REGISTER_MAX_MONTHS,
    invoiceRegisterSpanOf,
    invoiceRegisterTotalsOf,
    isCalendarMonth,
} from '../dist/index.js';

const TODAY = '2026-10-26';

describe('the months a view spans', () => {
    for (const [asked, from, until] of [
        [{}, '2026-10', '2026-10'],
        [{ from: '2026-03' }, '2026-03', '2026-03'],
        [{ until: '2026-03' }, '2026-03', '2026-03'],
        [{ from: '2026-03', until: '2026-03' }, '2026-03', '2026-03'],
    ]) {
        test(`${JSON.stringify(asked)} spans ${from} to ${until}`, () => {
            const { span, refusal } = invoiceRegisterSpanOf(asked, TODAY);
            assert.equal(refusal, null);
            assert.deepEqual([span.from, span.until, span.months], [from, until, [from]]);
        });
    }

    test('the current month is the one today falls on, from its first day to its last', () => {
        const { span } = invoiceRegisterSpanOf({}, '2026-11-01');
        assert.deepEqual(span.days, { from: '2026-11-01', until: '2026-11-30' });
    });

    test('a span across the turn of the year lists December before January', () => {
        const { span } = invoiceRegisterSpanOf({ from: '2025-12', until: '2026-01' }, TODAY);
        assert.deepEqual(span.months, ['2025-12', '2026-01']);
        assert.deepEqual(span.days, { from: '2025-12-01', until: '2026-01-31' });
    });

    for (const [month, last] of [
        ['2026-02', '2026-02-28'],
        ['2028-02', '2028-02-29'],
        ['2100-02', '2100-02-28'],
        ['2026-04', '2026-04-30'],
        ['2026-12', '2026-12-31'],
    ]) {
        test(`${month} ends on ${last}`, () => {
            assert.equal(invoiceRegisterSpanOf({ from: month }, TODAY).span.days.until, last);
        });
    }

    test(`${INVOICE_REGISTER_MAX_MONTHS} months are one view`, () => {
        const { span } = invoiceRegisterSpanOf({ from: '2026-01', until: '2026-12' }, TODAY);
        assert.equal(span.months.length, INVOICE_REGISTER_MAX_MONTHS);
    });

    test('one month more is refused, naming how many were asked', () => {
        assert.deepEqual(invoiceRegisterSpanOf({ from: '2026-01', until: '2027-01' }, TODAY), {
            span: null,
            refusal: {
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_REGISTER_RANGE_TOO_LONG,
                params: { from: '2026-01', until: '2027-01', months: 13, max: 12 },
            },
        });
    });

    test('a span of centuries is refused as one more month is', () => {
        const { refusal } = invoiceRegisterSpanOf({ from: '1000-01', until: '9999-12' }, TODAY);
        assert.equal(
            refusal.code,
            INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_REGISTER_RANGE_TOO_LONG,
        );
        assert.equal(refusal.params.months, (9999 - 1000 + 1) * 12);
    });

    for (const [from, until] of [
        ['2026-03', '2026-02'],
        ['2026-01', '2025-12'],
    ]) {
        test(`${from} to ${until} is refused as reversed`, () => {
            assert.deepEqual(invoiceRegisterSpanOf({ from, until }, TODAY).refusal, {
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_REGISTER_RANGE_REVERSED,
                params: { from, until },
            });
        });
    }

    for (const text of ['2026-13', '2026-00', '2026-1', '0999-12', '26-01', '']) {
        test(`${JSON.stringify(text)} is no month to span`, () => {
            assert.throws(() => invoiceRegisterSpanOf({ from: text }, TODAY), RangeError);
        });
    }
});

describe('what a month is', () => {
    for (const [text, month] of [
        ['1000-01', true],
        ['9999-12', true],
        ['2026-10', true],
        ['0999-12', false],
        ['2026-00', false],
        ['2026-13', false],
        ['2026-1', false],
        [' 2026-01', false],
        ['2026-01 ', false],
        ['2026-01\n', false],
        ['2026-01-01', false],
        ['2026/01', false],
    ]) {
        test(`${JSON.stringify(text)} ${month ? 'is' : 'is not'} one`, () => {
            assert.equal(isCalendarMonth(text), month);
        });
    }
});

const STANDARD = 'standard';
const spanOf = (from, until) => invoiceRegisterSpanOf({ from, until }, TODAY).span;
const issued = (issueDate, kind, taxes, currency = 'EUR') => ({ issueDate, currency, kind, taxes });
const total = (currency, kind, rate, net, tax, gross) => ({
    currency,
    kind,
    rate,
    net,
    tax,
    gross,
});

describe('what the invoices add up to', () => {
    test('every month of the span is there, one without invoices with no sums', () => {
        assert.deepEqual(invoiceRegisterTotalsOf(spanOf('2026-01', '2026-03'), []), {
            from: '2026-01',
            until: '2026-03',
            months: [
                { month: '2026-01', totals: [] },
                { month: '2026-02', totals: [] },
                { month: '2026-03', totals: [] },
            ],
            range: [],
        });
    });

    test('an invoice adds to its month and to the span, its gross its net plus its tax', () => {
        const totals = invoiceRegisterTotalsOf(spanOf('2026-01', '2026-02'), [
            issued('2026-02-28', STANDARD, [{ rate: 19, net: 100, tax: 19 }]),
        ]);
        assert.deepEqual(totals.months[0].totals, []);
        assert.deepEqual(totals.months[1].totals, [total('EUR', STANDARD, 19, 100, 19, 119)]);
        assert.deepEqual(totals.range, [total('EUR', STANDARD, 19, 100, 19, 119)]);
    });

    test('two rates are two sums, the lower rate first', () => {
        const totals = invoiceRegisterTotalsOf(spanOf('2026-01', '2026-01'), [
            issued('2026-01-05', STANDARD, [
                { rate: 19, net: 50, tax: 9.5 },
                { rate: 7, net: 20, tax: 1.4 },
            ]),
            issued('2026-01-06', STANDARD, [{ rate: 19, net: 10, tax: 1.9 }]),
        ]);
        assert.deepEqual(totals.range, [
            total('EUR', STANDARD, 7, 20, 1.4, 21.4),
            total('EUR', STANDARD, 19, 60, 11.4, 71.4),
        ]);
    });

    test('0 % exempt and 0 % under the reverse charge are reported apart, in the order the treatments are named', () => {
        const totals = invoiceRegisterTotalsOf(spanOf('2026-01', '2026-01'), [
            issued('2026-01-05', 'reverse-charge', [{ rate: 0, net: 300, tax: 0 }]),
            issued('2026-01-06', 'exempt', [{ rate: 0, net: 40, tax: 0 }]),
            issued('2026-01-07', 'small-business', [{ rate: 0, net: 5, tax: 0 }]),
            issued('2026-01-08', STANDARD, [{ rate: 19, net: 10, tax: 1.9 }]),
        ]);
        assert.deepEqual(
            totals.range.map((each) => [each.kind, each.rate, each.net]),
            [
                [STANDARD, 19, 10],
                ['exempt', 0, 40],
                ['reverse-charge', 0, 300],
                ['small-business', 0, 5],
            ],
        );
    });

    test('a cancellation takes off in its own month what the invoice it cancels added in its month', () => {
        const totals = invoiceRegisterTotalsOf(spanOf('2026-01', '2026-02'), [
            issued('2026-01-31', STANDARD, [{ rate: 19, net: 100, tax: 19 }]),
            issued('2026-02-01', STANDARD, [{ rate: 19, net: -100, tax: -19 }]),
            issued('2026-02-01', STANDARD, [{ rate: 19, net: 80, tax: 15.2 }]),
        ]);
        assert.deepEqual(totals.months, [
            { month: '2026-01', totals: [total('EUR', STANDARD, 19, 100, 19, 119)] },
            { month: '2026-02', totals: [total('EUR', STANDARD, 19, -20, -3.8, -23.8)] },
        ]);
        assert.deepEqual(totals.range, [total('EUR', STANDARD, 19, 80, 15.2, 95.2)]);
    });

    test('a month a cancellation empties keeps its sum at nothing rather than dropping it', () => {
        const totals = invoiceRegisterTotalsOf(spanOf('2026-01', '2026-01'), [
            issued('2026-01-10', STANDARD, [{ rate: 19, net: 100, tax: 19 }]),
            issued('2026-01-11', STANDARD, [{ rate: 19, net: -100, tax: -19 }]),
        ]);
        assert.deepEqual(totals.range, [total('EUR', STANDARD, 19, 0, 0, 0)]);
    });

    test('two currencies are never added together', () => {
        const totals = invoiceRegisterTotalsOf(spanOf('2026-01', '2026-01'), [
            issued('2026-01-10', STANDARD, [{ rate: 19, net: 100, tax: 19 }], 'EUR'),
            issued('2026-01-11', STANDARD, [{ rate: 8.1, net: 100, tax: 8.1 }], 'CHF'),
        ]);
        assert.deepEqual(
            totals.range.map((each) => [each.currency, each.net]),
            [
                ['CHF', 100],
                ['EUR', 100],
            ],
        );
    });

    test('amounts are added in whole cents, as an advisor adds them', () => {
        const totals = invoiceRegisterTotalsOf(spanOf('2026-01', '2026-01'), [
            issued('2026-01-10', STANDARD, [{ rate: 19, net: 0.1, tax: 0.02 }]),
            issued('2026-01-11', STANDARD, [{ rate: 19, net: 0.2, tax: 0.04 }]),
        ]);
        assert.deepEqual(totals.range, [total('EUR', STANDARD, 19, 0.3, 0.06, 0.36)]);
    });

    test('an invoice dated outside the span is refused rather than left out', () => {
        assert.throws(
            () =>
                invoiceRegisterTotalsOf(spanOf('2026-01', '2026-01'), [
                    issued('2026-02-01', STANDARD, [{ rate: 19, net: 1, tax: 0.19 }]),
                ]),
            /outside 2026-01 to 2026-01/,
        );
    });
});
