// The charge mapping both adapters share.
//
// Two things are worth pinning: a row's closed columns are checked rather than
// cast on the way in, and an amount goes out as the two-place decimal it was
// rounded to — never rounded a second time on the way.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    assertCorrectionsFitTheirCharges,
    correctedChargeIdsOf,
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

    const by =
        (amount, corrected = toSubscriberChargeRecord(row())) =>
        () =>
            counterEntryOf(corrected, {
                invoiceId: 'invoice-1',
                by: amount,
                reason: 'Not owed.',
                bookedAt: CORRECTED_AT,
            });

    test('takes off a cent at least and what the charge asks at most', () => {
        assert.equal(by(0.01)().amountNet, -0.01);
        assert.equal(by(19.9)().amountNet, -19.9);
    });

    for (const amount of [0, -1, 0.004, 19.91]) {
        test(`takes off nothing else, not ${amount}`, () => {
            assert.throws(by(amount), (error) =>
                error.message.endsWith(`above 0 and at most the 19.9 it asks, not ${amount}.`),
            );
        });
    }

    for (const [what, amountNet] of [
        ['a discount', '-3.98'],
        ['a charge of nothing', '0.00'],
    ]) {
        test(`is never written for ${what}, which is not corrected downwards`, () => {
            assert.throws(
                by(1, toSubscriberChargeRecord(row({ source: 'discount', amountNet }))),
                /only a charge that asks for an amount is corrected, and only downwards/,
            );
        });
    }

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

    for (const [what, overrides] of [
        ['an amount of nothing', { amountNet: '0.00' }],
        ['an amount added', { amountNet: '19.90' }],
        ['a reason of blanks', { correctionReason: '   ' }],
    ]) {
        test(`read with ${what}, stops the read naming the row`, () => {
            assert.throws(
                () => toSubscriberChargeRecord(correctionRow(overrides)),
                /subscriber_ledger_entries row 'charge-2' is a correction of .* takes a positive amount off and says why/,
            );
        });
    }

    test('read on another charge, a part of a correction stops the read naming the row', () => {
        assert.throws(
            () => toSubscriberChargeRecord(row({ correctionReason: 'Not owed.' })),
            /subscriber_ledger_entries row 'charge-1' is a renewal charge naming 1 of the three parts/,
        );
    });

    /** A correction that would be written, with `overrides` on top. */
    const correctionCharge = (overrides = {}) =>
        charge({
            origin: 'correction',
            sourceRef: 'invoice-1/charge-1',
            amountNet: -19.9,
            correction: PARTS,
            ...overrides,
        });

    test('one that takes an amount off and says why is written, a cent among them', () => {
        assert.equal(subscriberChargeColumns(correctionCharge()).amountNet, '-19.90');
        assert.equal(
            subscriberChargeColumns(correctionCharge({ amountNet: -0.01 })).amountNet,
            '-0.01',
        );
    });

    for (const [why, write, refusal] of [
        [
            'a correction without what it corrects',
            () => charge({ origin: 'correction', correction: null }),
            /A correction charge is written without a correction/,
        ],
        [
            'another charge with a correction',
            () => charge({ correction: PARTS }),
            /A renewal charge is written with a correction/,
        ],
        [
            'a correction with a blank reason',
            () => correctionCharge({ correction: { ...PARTS, reason: '  ' } }),
            /is not written: a correction takes a positive amount off and says why/,
        ],
        [
            'a correction of nothing',
            () => correctionCharge({ amountNet: 0 }),
            /of 0 for the reason 'Not owed.' is not written/,
        ],
        [
            'a correction that adds',
            () => correctionCharge({ amountNet: 0.01 }),
            /of 0.01 for the reason 'Not owed.' is not written/,
        ],
        [
            'a correction a hair of float arithmetic below nothing, which is stored as -0.00',
            () => correctionCharge({ amountNet: -1e-9 }),
            /of -1e-9 for the reason 'Not owed.' is not written/,
        ],
        [
            'a correction under another sourceRef',
            () => correctionCharge({ sourceRef: 'sub-1' }),
            /carries sourceRef 'sub-1'/,
        ],
    ]) {
        test(`${why} is not written`, () => {
            assert.throws(() => subscriberChargeColumns(write()), refusal);
        });
    }
});

// @requirement SC-PRIC-020 — A charge, once written, is never edited
describe('a correction is held to the charge it names, as the store read it', () => {
    const corrected = toSubscriberChargeRecord(row());
    const counterEntry = counterEntryOf(corrected, {
        invoiceId: 'invoice-1',
        by: 9.95,
        reason: 'Not owed.',
        bookedAt: CORRECTED_AT,
    });
    /** A correction of `chargeId` on `invoiceId`, standing where `counterEntry` stands. */
    const naming = (chargeId, invoiceId = 'invoice-3') => ({
        ...counterEntry,
        sourceRef: `${invoiceId}/${chargeId}`,
        correction: { chargeId, invoiceId, reason: 'Not owed.' },
    });

    test('names each charge corrected once, and nothing for a charge that corrects nothing', () => {
        assert.deepEqual(correctedChargeIdsOf([charge(), counterEntry, naming('charge-1')]), [
            'charge-1',
        ]);
        assert.deepEqual(correctedChargeIdsOf([charge()]), []);
    });

    test('one counterEntryOf made of it fits, beside a charge that corrects nothing', () => {
        assert.doesNotThrow(() =>
            assertCorrectionsFitTheirCharges([charge(), counterEntry], [corrected]),
        );
    });

    for (const [where, column, value] of [
        ['another account', 'subscriberId', 'subscriber-2'],
        ['another tenant', 'tenantId', 'tenant-2'],
        ['another subscription', 'subscriptionId', 'sub-2'],
        ['another contract', 'contractId', 'contract-2'],
        ['another contract line', 'contractLineItemId', 'line-2'],
        ['another source', 'source', 'bundle'],
        ['another period', 'periodStart', END],
        ['another currency', 'currency', 'CHF'],
    ]) {
        test(`one standing in ${where} is refused, naming what differs`, () => {
            assert.throws(
                () =>
                    assertCorrectionsFitTheirCharges(
                        [{ ...counterEntry, [column]: value }],
                        [corrected],
                    ),
                (error) =>
                    error.message.includes(
                        `charge charge-1 does not stand where that charge stands: ${column} differs.`,
                    ),
            );
        });
    }

    test('one taking off more than the charge asks is refused', () => {
        assert.throws(
            () =>
                assertCorrectionsFitTheirCharges(
                    [{ ...counterEntry, amountNet: -19.91 }],
                    [corrected],
                ),
            /at most the 19\.9 it asks, not 19\.91\./,
        );
    });

    test('one naming a correction, or a discount, is refused', () => {
        const correction = toSubscriberChargeRecord(correctionRow());
        const discount = toSubscriberChargeRecord(
            row({ id: 'charge-3', source: 'discount', amountNet: '-3.98' }),
        );

        assert.throws(
            () => assertCorrectionsFitTheirCharges([naming('charge-2')], [correction]),
            /Charge charge-2 is a correction itself/,
        );
        assert.throws(
            () => assertCorrectionsFitTheirCharges([naming('charge-3')], [discount]),
            /Charge charge-3 asks for -3\.98; only a charge that asks for an amount is corrected/,
        );
    });

    test('one naming a charge the store did not find is left to the foreign key', () => {
        assert.doesNotThrow(() => assertCorrectionsFitTheirCharges([counterEntry], []));
    });
});
