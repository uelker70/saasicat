// The charge mapping both adapters share.
//
// Two things are worth pinning: a row's closed columns are checked rather than
// cast on the way in, and an amount goes out as the two-place decimal it was
// rounded to — never rounded a second time on the way.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { subscriberChargeColumns, toSubscriberChargeRecord } from '../dist/index.js';

const START = new Date('2026-01-01T00:00:00.000Z');
const END = new Date('2026-02-01T00:00:00.000Z');

function row(overrides = {}) {
    return {
        id: 'charge-1',
        subscriberId: 'subscriber-1',
        tenantId: 'tenant-1',
        subscriptionId: 'sub-1',
        contractId: 'contract-1',
        contractLineItemId: 'line-1',
        origin: 'renewal',
        source: 'plan',
        sourceRef: 'sub-1',
        periodStart: START,
        periodEnd: END,
        currency: 'EUR',
        amountNet: '19.90',
        bookedAt: START,
        createdAt: START,
        ...overrides,
    };
}

function charge(overrides = {}) {
    const { id: _id, createdAt: _createdAt, ...rest } = toSubscriberChargeRecord(row());
    return { ...rest, ...overrides };
}

describe('a charge row becomes a record', () => {
    test('every column is carried over, and the amount becomes a number', () => {
        assert.deepEqual(toSubscriberChargeRecord(row()), { ...row(), amountNet: 19.9 });
    });

    test('a Prisma Decimal reads the same as a numeric string', () => {
        const decimal = { toString: () => '-3.98', valueOf: () => -3.98 };
        assert.equal(toSubscriberChargeRecord(row({ amountNet: decimal })).amountNet, -3.98);
    });

    for (const [column, value] of [
        ['origin', 'refund'],
        ['origin', 'RENEWAL'],
        ['source', 'tax'],
    ]) {
        test(`a ${column} of '${value}' stops the read, naming the row and the column`, () => {
            assert.throws(
                () => toSubscriberChargeRecord(row({ [column]: value })),
                (error) =>
                    error.message.includes(
                        `subscriber_ledger_entries row 'charge-1' holds ${column} '${value}'`,
                    ),
            );
        });
    }
});

// @requirement SC-PRIC-018 — Rounding happens once, when a charge is written
describe('a charge is written as the figure it was rounded to', () => {
    test('as a two-place decimal string, negative for a discount', () => {
        assert.equal(subscriberChargeColumns(charge()).amountNet, '19.90');
        assert.equal(subscriberChargeColumns(charge({ amountNet: -3.98 })).amountNet, '-3.98');
    });

    test('a sum float arithmetic leaves a hair off a cent is still that cent', () => {
        assert.equal(subscriberChargeColumns(charge({ amountNet: 0.1 + 0.2 })).amountNet, '0.30');
    });

    test('an amount that is not a whole number of cents is refused, not rounded again', () => {
        assert.throws(
            () => subscriberChargeColumns(charge({ amountNet: 19.995 })),
            /19\.995 is not a whole number of cents/,
        );
    });

    test('nothing the caller added beside the charge is written', () => {
        const columns = subscriberChargeColumns({ ...charge(), note: 'written by hand' });
        assert.equal('note' in columns, false);
    });
});
