// What the withdrawn-features page reads off a withdrawal, without a page:
// where it stands at a moment, and which typed amounts may be sent as
// reductions. The server checks the amounts again; these say which field is
// wrong before the second factor is asked for.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    canLiftFeatureWithdrawal,
    featureWithdrawalReachOf,
    featureWithdrawalStatusOf,
    featureWithdrawalTargetKeyOf,
    reductionsOf,
} from '../dist/index.js';

const NOW = new Date('2026-07-01T00:00:00.000Z');
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();

describe('where a withdrawal stands', () => {
    const cases = [
        ['announced for a moment ahead', { effectiveFrom: at(1), liftedFrom: null }, 'announced'],
        ['in effect from its moment on', { effectiveFrom: at(0), liftedFrom: null }, 'inEffect'],
        [
            'in effect while its lift is ahead',
            { effectiveFrom: at(-1), liftedFrom: at(1) },
            'inEffect',
        ],
        ['lifted from its lift on', { effectiveFrom: at(-1), liftedFrom: at(0) }, 'lifted'],
        ['lifted before its own date', { effectiveFrom: at(2), liftedFrom: at(1) }, 'lifted'],
        ['lifted at its own date', { effectiveFrom: at(1), liftedFrom: at(1) }, 'lifted'],
    ];
    for (const [name, row, status] of cases) {
        test(name, () => assert.equal(featureWithdrawalStatusOf(row, NOW), status));
    }

    test('is lifted once, and only while nobody has named a date', () => {
        assert.equal(canLiftFeatureWithdrawal({ liftedFrom: null }), true);
        assert.equal(canLiftFeatureWithdrawal({ liftedFrom: at(1) }), false);
    });
});

const PRO = {
    kind: 'plan',
    key: 'PRO',
    label: 'Pro',
    billingCycle: 'MONTHLY',
    lines: 2,
    lowestPriceNet: 49,
};
const PRO_YEARLY = { ...PRO, billingCycle: 'YEARLY', lowestPriceNet: 490 };
const EXPORT_PLUS = {
    kind: 'bundle',
    key: 'EXPORT_PLUS',
    label: 'Export plus',
    billingCycle: 'MONTHLY',
    lines: 1,
    lowestPriceNet: null,
};
const keyOf = featureWithdrawalTargetKeyOf;

describe('the reductions typed into the dialog', () => {
    test('one field per plan or add-on in a rhythm', () => {
        assert.notEqual(keyOf(PRO), keyOf(PRO_YEARLY));
        assert.notEqual(keyOf(PRO), keyOf({ ...PRO, kind: 'bundle' }));
    });

    test('an empty field names no reduction and nothing wrong', () => {
        for (const empty of [undefined, null, '']) {
            assert.deepEqual(reductionsOf([PRO], { [keyOf(PRO)]: empty }), {
                reductions: [],
                problems: {},
            });
        }
    });

    test('an amount is sent for its plan and rhythm, as a number', () => {
        assert.deepEqual(
            reductionsOf([PRO, PRO_YEARLY], { [keyOf(PRO)]: 5, [keyOf(PRO_YEARLY)]: '50' }),
            {
                reductions: [
                    { kind: 'plan', key: 'PRO', billingCycle: 'MONTHLY', amountNet: 5 },
                    { kind: 'plan', key: 'PRO', billingCycle: 'YEARLY', amountNet: 50 },
                ],
                problems: {},
            },
        );
    });

    const cases = [
        ['nothing', 0, 'notPositive'],
        ['a negative amount', -1, 'notPositive'],
        ['text that is no amount', 'five', 'notAnAmount'],
        ['a fraction of a cent', 1.005, 'tooPrecise'],
        ['one cent more than the lowest price', 49.01, 'exceedsPrice'],
    ];
    for (const [name, typed, problem] of cases) {
        test(`refuses ${name}, and sends none of it`, () => {
            assert.deepEqual(reductionsOf([PRO], { [keyOf(PRO)]: typed }), {
                reductions: [],
                problems: { [keyOf(PRO)]: problem },
            });
        });
    }

    test('takes an amount to the cent, up to the lowest price itself', () => {
        assert.deepEqual(
            reductionsOf([PRO], { [keyOf(PRO)]: 49 }).reductions.map((r) => r.amountNet),
            [49],
        );
        assert.deepEqual(
            reductionsOf([PRO], { [keyOf(PRO)]: 0.01 }).reductions.map((r) => r.amountNet),
            [0.01],
        );
    });

    test('caps nothing where no price is known', () => {
        assert.deepEqual(reductionsOf([EXPORT_PLUS], { [keyOf(EXPORT_PLUS)]: 1000 }).problems, {});
    });
});

test('what a preview reaches, as the dialog counts it', () => {
    const line = {
        line: 'plan',
        key: 'PRO',
        label: 'Pro',
        subscriptionBundleId: null,
        billingCycle: 'MONTHLY',
        priceNet: 49,
    };
    assert.deepEqual(
        featureWithdrawalReachOf({
            reached: [
                { subscriptionId: 's-1', lines: [line], specialTerms: false },
                { subscriptionId: 's-2', lines: [], specialTerms: true },
            ],
            skipped: [{ subscriptionId: 's-3', reason: 'ends-before' }],
        }),
        { subscriptions: 2, specialTermsOnly: 1, endingBefore: 1 },
    );
});
