// The charge mapping both adapters share.
//
// Two things are worth pinning: a row's closed columns are checked rather than
// cast on the way in, and an amount goes out as the two-place decimal it was
// rounded to — never rounded a second time on the way.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    counterEntryOf,
    subscriberChargeColumns,
    toSubscriberChargeRecord,
} from '../dist/index.js';

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
        correctsChargeId: null,
        correctedInvoiceId: null,
        correctionReason: null,
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
        const { correctsChargeId, correctedInvoiceId, correctionReason, ...columns } = row();
        assert.deepEqual(
            [correctsChargeId, correctedInvoiceId, correctionReason],
            [null, null, null],
        );
        assert.deepEqual(toSubscriberChargeRecord(row()), {
            ...columns,
            amountNet: 19.9,
            correction: null,
        });
    });

    // @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
    test('the difference an add-on switch adds is read back as such', () => {
        const record = toSubscriberChargeRecord(row({ origin: 'bundleChange', source: 'bundle' }));

        assert.equal(record.origin, 'bundleChange');
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

const CORRECTED_AT = new Date('2026-03-20T09:00:00.000Z');
const PARTS = { chargeId: 'charge-1', invoiceId: 'invoice-1', reason: 'Not owed.' };

/** A correction row naming what `PARTS` names, with `overrides` on top. */
const correctionRow = (overrides = {}) =>
    row({
        id: 'charge-2',
        origin: 'correction',
        sourceRef: 'invoice-1/charge-1',
        amountNet: '-19.90',
        correctsChargeId: PARTS.chargeId,
        correctedInvoiceId: PARTS.invoiceId,
        correctionReason: PARTS.reason,
        ...overrides,
    });

// @requirement SC-PRIC-020 — A charge, once written, is never edited
describe('a counter-entry', () => {
    test('takes what it corrects off the charge, under its contract line, source and period', () => {
        const corrected = toSubscriberChargeRecord(row());

        assert.deepEqual(
            counterEntryOf(corrected, {
                invoiceId: 'invoice-1',
                by: 9.95,
                reason: 'Not owed.',
                bookedAt: CORRECTED_AT,
            }),
            {
                subscriberId: 'subscriber-1',
                tenantId: 'tenant-1',
                subscriptionId: 'sub-1',
                contractId: 'contract-1',
                contractLineItemId: 'line-1',
                origin: 'correction',
                source: 'plan',
                sourceRef: 'invoice-1/charge-1',
                periodStart: START,
                periodEnd: END,
                currency: 'EUR',
                amountNet: -9.95,
                bookedAt: CORRECTED_AT,
                correction: PARTS,
            },
        );
    });

    test('takes the smallest amount there is, a cent, and nothing that is not taken off', () => {
        const corrected = toSubscriberChargeRecord(row());
        const by = (amount) => () =>
            counterEntryOf(corrected, {
                invoiceId: 'invoice-1',
                by: amount,
                reason: 'Not owed.',
                bookedAt: CORRECTED_AT,
            });

        assert.equal(by(0.01)().amountNet, -0.01);
        assert.throws(by(0), /takes a positive amount off, not 0/);
        assert.throws(by(-1), /takes a positive amount off, not -1/);
    });

    test('is never written for a correction, but for the charge it corrects', () => {
        const correction = toSubscriberChargeRecord(correctionRow());

        assert.throws(
            () =>
                counterEntryOf(correction, {
                    invoiceId: 'invoice-3',
                    by: 1,
                    reason: 'Not owed.',
                    bookedAt: CORRECTED_AT,
                }),
            /Charge charge-2 is a correction itself/,
        );
    });

    test('reads back with what it corrects, and is written with it', () => {
        const record = toSubscriberChargeRecord(correctionRow());

        assert.deepEqual(
            [record.origin, record.amountNet, record.correction],
            ['correction', -19.9, PARTS],
        );
        const { id: _id, createdAt: _createdAt, ...charge } = record;
        const columns = subscriberChargeColumns(charge);
        assert.deepEqual(
            [
                columns.correctsChargeId,
                columns.correctedInvoiceId,
                columns.correctionReason,
                columns.sourceRef,
            ],
            ['charge-1', 'invoice-1', 'Not owed.', 'invoice-1/charge-1'],
        );
    });

    for (const [missing, overrides] of [
        ['the charge it corrects', { correctsChargeId: null }],
        ['the invoice it stood on', { correctedInvoiceId: null }],
        ['the reason', { correctionReason: null }],
    ]) {
        test(`read without ${missing}, stops the read naming the row`, () => {
            assert.throws(
                () => toSubscriberChargeRecord(correctionRow(overrides)),
                /subscriber_ledger_entries row 'charge-2' is a correction charge naming 2 of the three parts/,
            );
        });
    }

    test('read on another charge, a part of a correction stops the read naming the row', () => {
        assert.throws(
            () => toSubscriberChargeRecord(row({ correctionReason: 'Not owed.' })),
            /subscriber_ledger_entries row 'charge-1' is a renewal charge naming 1 of the three parts/,
        );
    });

    for (const [why, write] of [
        [
            'a correction without what it corrects',
            () => charge({ origin: 'correction', correction: null }),
        ],
        ['another charge with a correction', () => charge({ correction: PARTS })],
        [
            'a correction with a blank reason',
            () =>
                charge({
                    origin: 'correction',
                    sourceRef: 'invoice-1/charge-1',
                    correction: { ...PARTS, reason: '  ' },
                }),
        ],
        [
            'a correction under another sourceRef',
            () => charge({ origin: 'correction', sourceRef: 'sub-1', correction: PARTS }),
        ],
    ]) {
        test(`${why} is not written`, () => {
            assert.throws(() => subscriberChargeColumns(write()));
        });
    }
});
