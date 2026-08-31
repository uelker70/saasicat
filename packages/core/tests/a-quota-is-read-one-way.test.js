// @requirement SC-PLAN-025 — Every quota a version carries counts as a limit that can be lowered

// One reading of a quota, for three callers that used to disagree.
//
// `plan-mapping` dropped every non-number, so a legacy `{"users": "100"}`
// reached the version diff as *absent* and replacing it with 50 read as an
// improvement. The adapters cast the column straight through, so the same value
// reached enforcement as a string — and `"-1"` is the one that costs, because
// unlimited is `=== -1` there, so an unlimited quota became a limit that
// refused everything. `subscription-contract-mapping` dropped it too, taking an
// allowance somebody bought out of their own contract.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { readQuotaRecord, readQuotaValue } from '../dist/index.js';

describe('a quota is read the same way everywhere', () => {
    test('a number is itself', () => {
        assert.equal(readQuotaValue(5), 5);
        assert.equal(readQuotaValue(0), 0);
        assert.equal(readQuotaValue(-1), -1);
    });

    test('a number written as a string is that number', () => {
        assert.equal(readQuotaValue('100'), 100);
        assert.equal(readQuotaValue('-1'), -1);
        assert.equal(readQuotaValue('0'), 0);
        assert.equal(readQuotaValue(' 42 '), 42);
    });

    test('anything that is not a finite number reads as nothing', () => {
        for (const value of ['unbegrenzt', '', '   ', null, undefined, {}, [], true, 'NaN']) {
            assert.equal(readQuotaValue(value), null, JSON.stringify(value) ?? String(value));
        }
    });

    test('and so does a number too large to be one', () => {
        // `Number('1e999')` is Infinity, which beats every allowance there is
        // and is not a JSON value either.
        assert.equal(readQuotaValue('1e999'), null);
        assert.equal(readQuotaValue(Infinity), null);
        assert.equal(readQuotaValue(Number.NaN), null);
    });

    test('a record keeps what it can read and leaves out what it cannot', () => {
        assert.deepEqual(readQuotaRecord({ a: 5, b: '10', c: 'many', d: '-1' }), {
            a: 5,
            b: 10,
            d: -1,
        });
    });

    test('and anything that is not a record reads as an empty one', () => {
        for (const value of [null, undefined, [], 'x', 7]) {
            assert.deepEqual(readQuotaRecord(value), {});
        }
    });

    test('a key inherited from the prototype is not a quota', () => {
        assert.deepEqual(readQuotaRecord(Object.create({ users: 5 })), {});
    });
});
