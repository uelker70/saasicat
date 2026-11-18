import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addOnPriceBeside, isOfferedWithEveryPlan } from '../dist/client/index.js';

// What an add-on of the public catalogue costs beside the plan a prospect has
// chosen. The catalogue names a price per plan, as the contract for that plan
// takes it; the add-on's own price is only shown, marked as depending on the
// plan, while no plan is chosen.

/** One plan's entry; a rhythm left out is not sold beside it. */
function entry(planKey, monthlyNet, yearlyNet = null) {
    return {
        planKey,
        monthlyNet,
        yearlyNet,
        discountedMonthlyNet: null,
        discountedYearlyNet: null,
    };
}

// "More storage" from #525: 10.00 on its own, 15.00 beside BASIC.
const STORAGE = {
    monthlyNet: 10,
    yearlyNet: 100,
    planPrices: [entry('BASIC', 15, 150), entry('PRO', 10, 100)],
};

// @requirement SC-BUN-019 — What an add-on costs depends on the plan beside it and the rhythm it is billed in
describe('an add-on beside a chosen plan', () => {
    test("costs the plan's price, not its own", () => {
        assert.deepEqual(addOnPriceBeside(STORAGE, 'BASIC', 'MONTHLY'), {
            kind: 'priced',
            net: 15,
        });
        assert.deepEqual(addOnPriceBeside(STORAGE, 'BASIC', 'YEARLY'), {
            kind: 'priced',
            net: 150,
        });
        assert.deepEqual(addOnPriceBeside(STORAGE, 'PRO', 'MONTHLY'), { kind: 'priced', net: 10 });
    });

    test('with no price in the rhythm is not sold in it, rather than free', () => {
        const monthlyBesideBasic = { ...STORAGE, planPrices: [entry('BASIC', 15)] };
        assert.deepEqual(addOnPriceBeside(monthlyBesideBasic, 'BASIC', 'YEARLY'), {
            kind: 'not-in-cycle',
        });
    });

    test('without an entry for the plan cannot be had with it', () => {
        const basicOnly = { monthlyNet: null, yearlyNet: null, planPrices: [entry('BASIC', 15)] };
        assert.deepEqual(addOnPriceBeside(basicOnly, 'PRO', 'MONTHLY'), { kind: 'not-with-plan' });
    });

    test('priced only through one plan is priced beside that plan', () => {
        const basicOnly = { monthlyNet: null, yearlyNet: null, planPrices: [entry('BASIC', 15)] };
        assert.deepEqual(addOnPriceBeside(basicOnly, 'BASIC', 'MONTHLY'), {
            kind: 'priced',
            net: 15,
        });
    });
});

// @requirement SC-BUN-019 — What an add-on costs depends on the plan beside it and the rhythm it is billed in
describe('an add-on while no plan is chosen', () => {
    test('shows its own price, marked as depending on the plan', () => {
        assert.deepEqual(addOnPriceBeside(STORAGE, null, 'MONTHLY'), {
            kind: 'depends-on-plan',
            baseNet: 10,
        });
    });

    test('priced only through a plan depends on the plan, with no figure of its own', () => {
        const basicOnly = { monthlyNet: null, yearlyNet: null, planPrices: [entry('BASIC', 15)] };
        assert.deepEqual(addOnPriceBeside(basicOnly, null, 'MONTHLY'), {
            kind: 'depends-on-plan',
            baseNet: null,
        });
    });

    test('that no plan sells in the rhythm is not sold in it, whatever its own price says', () => {
        const monthlyEverywhere = {
            ...STORAGE,
            planPrices: [entry('BASIC', 15), entry('PRO', 10)],
        };
        assert.deepEqual(addOnPriceBeside(monthlyEverywhere, null, 'YEARLY'), {
            kind: 'not-in-cycle',
        });
    });

    test('that no plan can have is not offered', () => {
        const nowhere = { monthlyNet: 10, yearlyNet: 100, planPrices: [] };
        assert.deepEqual(addOnPriceBeside(nowhere, null, 'MONTHLY'), { kind: 'not-with-plan' });
    });
});

describe('an add-on offered with every plan', () => {
    test('has an entry for each of them', () => {
        assert.equal(isOfferedWithEveryPlan(STORAGE, ['BASIC', 'PRO']), true);
    });

    test('is not, when one plan has none', () => {
        const basicOnly = { monthlyNet: null, yearlyNet: null, planPrices: [entry('BASIC', 15)] };
        assert.equal(isOfferedWithEveryPlan(basicOnly, ['BASIC', 'PRO']), false);
    });
});
