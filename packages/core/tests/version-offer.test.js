// @requirement SC-SUB-020 — A newer version is offered, classified against the version bound

// A newer version is an offer, and what kind of offer decides how it can be
// taken. The rule is the operator's (saasicat#357, D3 to D6): judged against
// the version the subscription is bound to, a candidate that takes anything
// away — a feature, a quota — is taken at term end, whatever it costs; one
// that only costs more in some rhythm is taken at once and prorated; one that
// is nowhere worse is taken at once and free.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyVersionOffer } from '../dist/index.js';

/** The bound version of #357's worked example: Standard, 49 €, 5 users, 100 vehicles. */
const BOUND = {
    features: ['DASHBOARD', 'EXPORT'],
    quotas: { users: 5, vehicles: 100 },
    monthlyNet: '49.00',
    yearlyNet: '490.00',
};

const offer = (changes) => classifyVersionOffer(BOUND, { ...BOUND, ...changes });

describe("the worked examples of the operator's decision", () => {
    test('49 €, 5 users, 150 vehicles is an improvement', () => {
        assert.equal(offer({ quotas: { users: 5, vehicles: 150 } }).class, 'improvement');
    });

    test('59 €, 8 users, 200 vehicles is more for more', () => {
        const candidate = { monthlyNet: '59.00', quotas: { users: 8, vehicles: 200 } };
        assert.equal(offer(candidate).class, 'more-for-more');
    });

    test('45 €, 3 users, 200 vehicles takes something away, although it is cheaper', () => {
        const candidate = { monthlyNet: '45.00', quotas: { users: 3, vehicles: 200 } };
        assert.equal(offer(candidate).class, 'takes-something-away');
    });

    test('the same monthly price but a dearer yearly one is more for more', () => {
        assert.equal(offer({ yearlyNet: '520.00' }).class, 'more-for-more');
    });

    test('one feature less takes something away, everything else equal', () => {
        assert.equal(offer({ features: ['DASHBOARD'] }).class, 'takes-something-away');
    });
});

describe('prices', () => {
    test('equal in both rhythms, written differently, is no change', () => {
        assert.equal(offer({ monthlyNet: '49', yearlyNet: 490 }).class, 'same');
    });

    test('lower in one rhythm and equal in the other is an improvement', () => {
        assert.equal(offer({ monthlyNet: '48.99' }).class, 'improvement');
    });

    test('a cent more in one rhythm is more for more', () => {
        assert.equal(offer({ monthlyNet: '49.01' }).class, 'more-for-more');
    });

    test('a rhythm the candidate no longer sells counts against it', () => {
        assert.equal(offer({ yearlyNet: null }).class, 'more-for-more');
    });

    test('a rhythm the candidate sells and the bound version did not is an improvement', () => {
        const bound = { ...BOUND, yearlyNet: null };
        assert.equal(classifyVersionOffer(bound, BOUND).class, 'improvement');
    });

    test('dearer and a feature less takes something away: what is missing decides', () => {
        assert.equal(
            offer({ monthlyNet: '59.00', features: ['DASHBOARD'] }).class,
            'takes-something-away',
        );
    });
});

describe('quotas', () => {
    test('equal is no change', () => {
        assert.equal(offer({ quotas: { users: 5, vehicles: 100 } }).class, 'same');
    });

    test('one more is an improvement', () => {
        assert.equal(offer({ quotas: { users: 6, vehicles: 100 } }).class, 'improvement');
    });

    test('one less takes something away', () => {
        assert.equal(offer({ quotas: { users: 4, vehicles: 100 } }).class, 'takes-something-away');
    });

    test('unlimited instead of a number is an improvement', () => {
        assert.equal(offer({ quotas: { users: -1, vehicles: 100 } }).class, 'improvement');
    });

    test('a number instead of unlimited takes something away', () => {
        const bound = { ...BOUND, quotas: { users: -1, vehicles: 100 } };
        assert.equal(classifyVersionOffer(bound, BOUND).class, 'takes-something-away');
    });

    test('a quota the candidate no longer carries takes something away', () => {
        assert.equal(offer({ quotas: { users: 5 } }).class, 'takes-something-away');
    });
});

describe('features', () => {
    test('the same set in another order is no change', () => {
        assert.equal(offer({ features: ['EXPORT', 'DASHBOARD'] }).class, 'same');
    });

    test('one more is an improvement', () => {
        assert.equal(offer({ features: ['DASHBOARD', 'EXPORT', 'API'] }).class, 'improvement');
    });

    test('one swapped for another takes something away', () => {
        assert.equal(offer({ features: ['DASHBOARD', 'API'] }).class, 'takes-something-away');
    });
});

test('an offer states every difference, bound to candidate', () => {
    const { changes } = offer({ monthlyNet: '59.00', quotas: { users: 8, vehicles: 100 } });
    assert.deepEqual(
        changes.map((change) => [change.field, change.oldValue, change.newValue, change.direction]),
        [
            ['quotas.users', 5, 8, 'IMPROVEMENT'],
            ['monthlyNet', '49.00', '59.00', 'REGRESSION'],
        ],
    );
});
