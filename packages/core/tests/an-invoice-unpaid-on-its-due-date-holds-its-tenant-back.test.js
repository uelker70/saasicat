// When an invoice left unpaid holds its tenant back, and which reasons a run
// records and lifts so that the open ones are one per such invoice
// (`SC-PRIC-098`).

// @requirement SC-PRIC-098 — An invoice unpaid on its due date makes the tenant read-only until it is paid

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    overdueHoldChanges,
    owedWhenReplaced,
    reversalsStillTakenBack,
    unpaidInvoiceHoldsBack,
} from '../dist/index.js';

const SINCE = new Date('2026-03-01T00:00:00.000Z');

/** An open reason of `kind` on `tenantId`, about `reference`. */
const hold = (id, tenantId, reference, { kind = 'overdue', liftedAt = null } = {}) => ({
    id,
    tenantId,
    kind,
    reference,
    note: null,
    since: SINCE,
    recordedBy: 'job:platform:overdue-invoices',
    liftedAt,
    liftedBy: liftedAt ? 'job:platform:overdue-invoices' : null,
});

/** An attempt `status`, sent on `sentOn` where it was sent. */
const sent = (status, sentOn = '2026-03-01') => ({ status, sentOn });
const unsent = (status) => ({ status, sentOn: null });
/** An attempt of an invoice the one asked about replaced, come due on `dueOn` before that if it had. */
const carried = (status, dueOn) => ({ status, sentOn: '2026-02-01', dueOn });

describe('an open invoice holds its tenant back', () => {
    for (const [why, dueDate, today, attempts, holds] of [
        [
            'the day before its due date, nothing collecting it',
            '2026-03-01',
            '2026-02-28',
            [],
            false,
        ],
        [
            'the day before its due date, its card refused',
            '2026-03-01',
            '2026-02-28',
            [sent('FAILED', '2026-02-01')],
            false,
        ],
        ['on its due date, nothing collecting it', '2026-03-01', '2026-03-01', [], true],
        [
            'on its due date, its direct debit sent that day and waiting for the bank',
            '2026-03-01',
            '2026-03-01',
            [sent('PENDING')],
            false,
        ],
        [
            'on its due date, its collection sent that day and not yet answered',
            '2026-03-01',
            '2026-03-01',
            [sent('SUBMITTED')],
            false,
        ],
        [
            'on its due date, a collection sent before it and still waiting',
            '2026-03-01',
            '2026-03-01',
            [sent('PENDING', '2026-02-01')],
            false,
        ],
        [
            'after its due date, the debit sent on it still waiting for the bank',
            '2026-03-01',
            '2026-03-05',
            [sent('PENDING')],
            false,
        ],
        ['once its collection was refused', '2026-03-01', '2026-03-05', [sent('FAILED')], true],
        [
            'once its payment was taken back',
            '2026-03-01',
            '2026-03-20',
            [sent('SUCCEEDED'), sent('REVERSED')],
            true,
        ],
        [
            'started again after a refusal and waiting for the bank',
            '2026-03-01',
            '2026-03-06',
            [sent('FAILED'), sent('PENDING', '2026-03-05')],
            true,
        ],
        [
            'started again after a payment taken back and not yet answered',
            '2026-03-01',
            '2026-03-21',
            [sent('REVERSED'), sent('SUBMITTED', '2026-03-21')],
            true,
        ],
        [
            'with a payment started after its due date, nothing failed, still waiting',
            '2026-03-01',
            '2026-03-03',
            [sent('PENDING', '2026-03-02')],
            true,
        ],
        [
            'with a collection planned for a later day',
            '2026-03-01',
            '2026-03-01',
            [unsent('SCHEDULED')],
            true,
        ],
        [
            'with a plan withdrawn and nothing on its way',
            '2026-03-01',
            '2026-03-01',
            [unsent('WITHDRAWN')],
            true,
        ],
        [
            'with a plan withdrawn for a replacement sent on the due date',
            '2026-03-01',
            '2026-03-02',
            [unsent('WITHDRAWN'), sent('PENDING')],
            false,
        ],
        [
            'with a plan withdrawn for a replacement sent after the due date',
            '2026-03-01',
            '2026-03-03',
            [unsent('WITHDRAWN'), sent('PENDING', '2026-03-02')],
            true,
        ],
        [
            'paid in part, the rest collected by nothing',
            '2026-03-01',
            '2026-03-01',
            [sent('SUCCEEDED')],
            true,
        ],
        [
            'on New Year’s Day, due on the last day of the year',
            '2025-12-31',
            '2026-01-01',
            [],
            true,
        ],
        [
            'on the last day of the year, due on New Year’s Day',
            '2026-01-01',
            '2025-12-31',
            [],
            false,
        ],
        [
            'before its own due date, an invoice it replaced having come due and been refused',
            '2026-03-06',
            '2026-02-20',
            [carried('FAILED', '2026-02-15')],
            true,
        ],
        [
            'before its own due date, the payment of an invoice it replaced, come due, taken back',
            '2026-03-06',
            '2026-02-20',
            [carried('SUCCEEDED', '2026-02-15'), carried('REVERSED', '2026-02-15')],
            true,
        ],
        [
            'before its own due date, an invoice it replaced refused before that came due',
            '2026-03-06',
            '2026-02-20',
            [carried('FAILED', null)],
            false,
        ],
        [
            'on its own due date, an invoice it replaced refused before that came due',
            '2026-03-06',
            '2026-03-06',
            [carried('FAILED', null)],
            true,
        ],
    ]) {
        test(`${holds ? 'holds' : 'does not hold'} it ${why}`, () => {
            const own = attempts.map((attempt) => ({ dueOn: dueDate, ...attempt }));
            assert.equal(unpaidInvoiceHoldsBack(dueDate, own, today), holds);
        });
    }
});

describe('the reasons a run records and lifts', () => {
    test('an invoice that holds its tenant back without a reason gets one, on the tenant it names', () => {
        const changes = overdueHoldChanges([{ invoiceId: 'inv-1', tenantId: 't1' }], []);
        assert.deepEqual(changes, { record: [{ invoiceId: 'inv-1', tenantId: 't1' }], lift: [] });
    });

    test('an invoice that holds its tenant back already is left as it is', () => {
        const changes = overdueHoldChanges(
            [{ invoiceId: 'inv-1', tenantId: 't1' }],
            [hold('h1', 't1', 'inv-1')],
        );
        assert.deepEqual(changes, { record: [], lift: [] });
    });

    test('a reason whose invoice holds nobody back any more is lifted, and only that one', () => {
        const paid = hold('h1', 't1', 'inv-1');
        const changes = overdueHoldChanges(
            [{ invoiceId: 'inv-2', tenantId: 't1' }],
            [paid, hold('h2', 't1', 'inv-2')],
        );
        assert.deepEqual(changes, { record: [], lift: [paid] });
    });

    test('an invoice whose subscriber is live for another tenant now moves its reason there', () => {
        const before = hold('h1', 't1', 'inv-1');
        const changes = overdueHoldChanges([{ invoiceId: 'inv-1', tenantId: 't2' }], [before]);
        assert.deepEqual(changes, {
            record: [{ invoiceId: 'inv-1', tenantId: 't2' }],
            lift: [before],
        });
    });

    test('a reason of another kind is not this rule’s to lift, whatever it refers to', () => {
        const changes = overdueHoldChanges(
            [],
            [
                hold('h1', 't1', null, { kind: 'suspended' }),
                hold('h2', 't1', 'inv-1', { kind: 'ended' }),
                hold('h3', 't1', 'inv-1', { kind: 'deleting' }),
            ],
        );
        assert.deepEqual(changes, { record: [], lift: [] });
    });

    test('a reason of another kind about the same invoice does not stand in for one', () => {
        const changes = overdueHoldChanges(
            [{ invoiceId: 'inv-1', tenantId: 't1' }],
            [hold('h1', 't1', 'inv-1', { kind: 'ended' })],
        );
        assert.deepEqual(changes.record, [{ invoiceId: 'inv-1', tenantId: 't1' }]);
    });

    test('a reason lifted before is no reason: the invoice gets a new one, and nothing is lifted twice', () => {
        const lifted = hold('h1', 't1', 'inv-1', { liftedAt: SINCE });
        const changes = overdueHoldChanges([{ invoiceId: 'inv-1', tenantId: 't1' }], [lifted]);
        assert.deepEqual(changes, { record: [{ invoiceId: 'inv-1', tenantId: 't1' }], lift: [] });
    });

    test('an invoice listed twice is one reason', () => {
        const once = { invoiceId: 'inv-1', tenantId: 't1' };
        assert.deepEqual(overdueHoldChanges([once, { ...once }], []).record, [once]);
    });

    test('two invoices of one tenant are two reasons, so settling one leaves the other holding', () => {
        const first = hold('h1', 't1', 'inv-1');
        const second = hold('h2', 't1', 'inv-2');
        const changes = overdueHoldChanges(
            [{ invoiceId: 'inv-2', tenantId: 't1' }],
            [first, second],
        );
        assert.deepEqual(changes.lift, [first]);
        assert.deepEqual(changes.record, []);
    });
});

describe('what a replaced invoice still owed when it was replaced', () => {
    const CANCELLED_AT = new Date('2026-02-20T09:00:00.000Z');
    const replacedBy = { cancellationId: 'c-1', cancelledAt: CANCELLED_AT };
    const settled = (kind, amount, recordedAt, cancellationId = null) => ({
        kind,
        amount,
        recordedAt: new Date(recordedAt),
        cancellationId,
    });

    test('is its total where nothing settled it', () => {
        assert.equal(owedWhenReplaced(119, [], replacedBy), 119);
    });

    test('is nothing where a payment settled it before, a refusal before that made good', () => {
        assert.equal(
            owedWhenReplaced(
                119,
                [settled('PAYMENT', 119, '2026-02-08T06:00:00.000Z')],
                replacedBy,
            ),
            0,
        );
    });

    test('is what a reversal before the cancellation took back again', () => {
        assert.equal(
            owedWhenReplaced(
                119,
                [
                    settled('PAYMENT', 119, '2026-02-08T06:00:00.000Z'),
                    settled('REVERSAL', 119, '2026-02-12T06:00:00.000Z'),
                ],
                replacedBy,
            ),
            119,
        );
    });

    test('leaves out the shares the cancellation moved, and what came after it', () => {
        assert.equal(
            owedWhenReplaced(
                119,
                [
                    settled('PAYMENT', 119, '2026-02-08T06:00:00.000Z'),
                    settled('MOVED_OUT', 119, CANCELLED_AT.toISOString(), 'c-1'),
                    settled('REVERSAL', 119, '2026-02-25T06:00:00.000Z'),
                ],
                replacedBy,
            ),
            0,
        );
    });

    test('counts in cents, not in binary fractions', () => {
        assert.equal(
            owedWhenReplaced(
                0.3,
                [
                    settled('PAYMENT', 0.1, '2026-02-08T06:00:00.000Z'),
                    settled('PAYMENT', 0.2, '2026-02-09T06:00:00.000Z'),
                ],
                replacedBy,
            ),
            0,
        );
    });
});

describe('the reversals that still take a payment back', () => {
    const reversal = (kind, amount, id = 'du-1') => ({ kind, amount, reversal: { id } });

    test('are none, with nothing reversed', () => {
        assert.deepEqual(
            reversalsStillTakenBack([{ kind: 'PAYMENT', amount: 119, reversal: null }]),
            [],
        );
    });

    test('are the reversal that took it back', () => {
        assert.deepEqual(reversalsStillTakenBack([reversal('REVERSAL', 119)]), ['du-1']);
    });

    test('are none once the gateway gave that reversal back in full, on whichever invoice', () => {
        assert.deepEqual(
            reversalsStillTakenBack([reversal('REVERSAL', 119), reversal('REINSTATEMENT', 119)]),
            [],
        );
    });

    test('are the reversal given back in part', () => {
        assert.deepEqual(
            reversalsStillTakenBack([reversal('REVERSAL', 119), reversal('REINSTATEMENT', 100)]),
            ['du-1'],
        );
    });

    test('are the one of two reversals not given back', () => {
        assert.deepEqual(
            reversalsStillTakenBack([
                reversal('REVERSAL', 50, 'du-1'),
                reversal('REINSTATEMENT', 50, 'du-1'),
                reversal('REVERSAL', 69, 'du-2'),
            ]),
            ['du-2'],
        );
    });

    test('count in cents, not in binary fractions', () => {
        assert.deepEqual(
            reversalsStillTakenBack([
                reversal('REVERSAL', 0.3),
                reversal('REINSTATEMENT', 0.1),
                reversal('REINSTATEMENT', 0.2),
            ]),
            [],
        );
    });
});
