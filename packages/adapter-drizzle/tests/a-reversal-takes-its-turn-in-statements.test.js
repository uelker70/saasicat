// What `DrizzleSubscriberPaymentRepository` asks the database for a reversal
// and for the cases to reconcile, statement by statement, through Drizzle's
// own query builder and a transport that records what it would send.
//
// What a reversal writes and gives back, and that two reports at once apply it
// once, is the persistence contract's to prove against PostgreSQL. These cases
// pin what can be read off the statements without one: the turn a reversal
// takes — the chain of every invoice its payment settles, by the chains' first
// invoices in one order, then the subscriber's credits, then its own row —
// before it reads what to take; that
// nothing is held for a payment it does not know or a currency it does not
// share; and that a case is closed only where it is still open.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide
// @requirement SC-PRIC-084 — A returned debit or a chargeback is recorded, and what the payment settled opens again
// @requirement SC-ADM-033 — The operator reconciles what no credit matched, and closes each case with a note

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pg-proxy';

import { GIVING_BACK_CREDIT_ENTRY_KINDS } from '@saasicat/core';
import { DrizzleSubscriberPaymentRepository, saasicatSchema } from '../dist/index.js';

const AT = new Date('2026-02-20T09:00:00.000Z');

/** A row of `table` as the driver hands it back: its columns' values in the table's order. */
const rowOf = (table, values) =>
    Object.keys(getTableColumns(table)).map((column) => values[column] ?? null);

const PAYMENT = rowOf(saasicatSchema.subscriberPayments, {
    id: 'payment-1',
    subscriberId: 'subscriber-1',
    tenantId: 'tenant-1',
    invoiceId: 'invoice-1',
    collectionId: 'attempt-1',
    gatewayAccount: 'stripe-main',
    provider: 'stripe',
    gatewayRef: 'pi_1',
    amount: '100.00',
    currency: 'EUR',
    recordedAt: '2026-02-01 05:20:00',
});

const reversalRow = (paymentId) =>
    rowOf(saasicatSchema.subscriberReversals, {
        id: 'reversal-1',
        subscriberId: 'subscriber-1',
        tenantId: 'tenant-1',
        paymentId,
        gatewayAccount: 'stripe-main',
        gatewayRef: 'du_1',
        amount: '50.00',
        currency: 'EUR',
        fromCredit: '20.00',
        reinstated: '0.00',
        recordedAt: '2026-02-20 09:00:00',
    });

const caseRow = (id, closed = {}) =>
    rowOf(saasicatSchema.subscriberReconciliationCases, {
        id,
        subscriberId: 'subscriber-1',
        tenantId: 'tenant-1',
        kind: 'REFUND_UNMATCHED',
        amount: '10.00',
        currency: 'EUR',
        paymentId: 'payment-1',
        refundId: `refund-${id}`,
        gatewayAccount: 'stripe-main',
        gatewayRef: `re_${id}`,
        recordedAt: '2026-03-01 09:00:00',
        ...closed,
    });

/** The dispute `du_1` of `pi_1`, as the gateway reports it in total. */
const dispute = (overrides = {}) => ({
    gatewayAccount: 'stripe-main',
    gatewayRef: 'du_1',
    paymentRef: 'pi_1',
    currency: 'EUR',
    withdrawn: 50,
    reinstated: 0,
    at: AT,
    ...overrides,
});

/**
 * A database that records every statement and answers from `script`: the first
 * entry whose pattern the statement matches gives its rows. A transaction runs
 * on the same recorder — the statements are what is asked, not how it is
 * isolated.
 */
function recordingDb(script = []) {
    const statements = [];
    const db = drizzle(async (sql, params, method) => {
        statements.push({ sql, params, method });
        const answer = script.find(([pattern]) => pattern.test(sql));
        return { rows: answer ? answer[1] : [] };
    });
    db.transaction = async (work) => work(db);
    return { statements, repo: new DrizzleSubscriberPaymentRepository(db) };
}

/** What a statement does, to which table, and whether it holds the rows it reads. */
const shapeOf = ({ sql }) => {
    const kind = sql.trim().split(/\s/, 1)[0].toLowerCase();
    const marker = kind === 'insert' ? 'into "' : 'from "';
    const start = sql.indexOf(marker) + marker.length;
    const held = sql.toLowerCase().endsWith(' for update') ? ' held' : '';
    return `${kind} ${sql.slice(start, sql.indexOf('"', start))}${held}`;
};

describe('a reversal', () => {
    test('takes the turn of every invoice its payment settles, in one order, then the credits, then its own row', async () => {
        const { repo, statements } = recordingDb([
            [/from "subscriber_payments"/i, [PAYMENT]],
            [
                /^select "invoiceId" from "subscription_invoice_settlements"/i,
                [['invoice-1'], ['invoice-0']],
            ],
            // Each invoice begins its own chain.
            [/^select "chainId" from "subscription_invoices"/i, [['invoice-1'], ['invoice-0']]],
            [
                /from "subscription_invoices"/i,
                [['invoice-x', 'subscriber-1', 'tenant-1', '80.00', 'EUR']],
            ],
            [/from "subscriber_reversals"/i, [reversalRow('payment-1')]],
        ]);

        // Reported as it was recorded: nothing grew, so nothing is written.
        const recorded = await repo.recordReversal(dispute());

        assert.equal(recorded.outcome, 'unchanged');
        assert.deepEqual(statements.map(shapeOf), [
            'select subscriber_payments',
            'select subscription_invoice_settlements',
            'select subscription_invoices',
            'select subscription_invoices held',
            'select subscription_invoices held',
            'select subscriber_credits held',
            'insert subscriber_reversals',
            'select subscriber_reversals held',
        ]);
        assert.deepEqual(
            [statements[3].params[0], statements[4].params[0]],
            ['invoice-0', 'invoice-1'],
        );
        assert.ok(statements[5].sql.includes('order by "subscriber_credits"."id"'));
        assert.match(statements[6].sql, /on conflict do nothing/i);
    });

    test('of a payment this installation does not hold, holds and writes nothing', async () => {
        const { repo, statements } = recordingDb();

        assert.deepEqual(await repo.recordReversal(dispute()), { outcome: 'unknown-payment' });
        assert.deepEqual(statements.map(shapeOf), ['select subscriber_payments']);
    });

    test('in another currency than its payment, is refused before anything is held', async () => {
        const { repo, statements } = recordingDb([[/from "subscriber_payments"/i, [PAYMENT]]]);

        await assert.rejects(repo.recordReversal(dispute({ currency: 'USD' })), /is in USD/);
        assert.equal(statements.length, 1);
    });

    test('held under its reference against another payment, is refused', async () => {
        const { repo } = recordingDb([
            [/from "subscriber_payments"/i, [PAYMENT]],
            [
                /from "subscription_invoices"/i,
                [['invoice-1', 'subscriber-1', 'tenant-1', '80.00', 'EUR']],
            ],
            [/from "subscriber_reversals"/i, [reversalRow('payment-elsewhere')]],
        ]);

        await assert.rejects(
            repo.recordReversal(dispute()),
            /recorded against payment payment-elsewhere/,
        );
    });

    test('is found by its id, and none by another', async () => {
        const found = recordingDb([[/from "subscriber_reversals"/i, [reversalRow('payment-1')]]]);
        const none = recordingDb();

        assert.deepEqual(
            [(await found.repo.findReversalById('reversal-1')).amount, found.statements[0].params],
            [50, ['reversal-1']],
        );
        assert.equal(await none.repo.findReversalById('reversal-unknown'), null);
    });
});

describe('the cases to reconcile', () => {
    test('the open ones are read the oldest first, a page at a time, for one subscriber where named', async () => {
        const { repo, statements } = recordingDb([
            [/from "subscriber_reconciliation_cases"/i, [caseRow('case-a')]],
        ]);

        const page = await repo.listCases(
            { state: 'open', subscriberId: 'subscriber-1' },
            { limit: 2, after: 'case-0' },
        );

        assert.deepEqual(
            page.map((each) => each.id),
            ['case-a'],
        );
        const [after, read] = statements;
        assert.deepEqual(after.params, ['case-0']);
        assert.match(read.sql, /"closedAt" is null/i);
        assert.ok(
            read.sql.includes(
                'order by "subscriber_reconciliation_cases"."recordedAt" asc, ' +
                    '"subscriber_reconciliation_cases"."id" asc limit',
            ),
            read.sql,
        );
        assert.ok(read.params.includes('subscriber-1'), read.params.join());
        assert.ok(read.params.includes(2), 'the page size');
    });

    test('the closed ones are read without a cursor in one statement', async () => {
        const { repo, statements } = recordingDb();

        assert.deepEqual(await repo.listCases({ state: 'closed' }, { limit: 50 }), []);
        assert.equal(statements.length, 1);
        assert.match(statements[0].sql, /"closedAt" is not null/i);
    });

    test('one is closed only where it is still open, and one closed before or unknown is answered as such', async () => {
        const close = { caseId: 'case-a', note: 'Recovered.', closedBy: 'operator-1', at: AT };
        const closedNow = {
            closedAt: '2026-02-20 09:00:00',
            closedBy: 'operator-1',
            note: 'Recovered.',
        };
        const open = recordingDb([
            [/^update "subscriber_reconciliation_cases"/i, [caseRow('case-a', closedNow)]],
        ]);
        const before = recordingDb([
            [/^select .*from "subscriber_reconciliation_cases"/i, [caseRow('case-a', closedNow)]],
        ]);
        const unknown = recordingDb();

        const closed = await open.repo.closeCase(close);
        const again = await before.repo.closeCase(close);

        assert.deepEqual([closed.outcome, closed.case.note], ['closed', 'Recovered.']);
        assert.match(
            open.statements[0].sql,
            /where \("subscriber_reconciliation_cases"\."id" = \$\d+ and "subscriber_reconciliation_cases"\."closedAt" is null\)/i,
        );
        assert.ok(open.statements[0].params.includes('operator-1'));
        assert.deepEqual([again.outcome, before.statements.length], ['already-closed', 2]);
        assert.deepEqual(await unknown.repo.closeCase(close), { outcome: 'unknown-case' });
    });
});

describe('what the credits and invoices read', () => {
    test('what each invoice owes is read in three statements, and nothing is asked for none', async () => {
        const script = [
            [
                /from "subscription_invoices"/i,
                [
                    ['invoice-1', '80.00'],
                    ['invoice-2', '58.31'],
                ],
            ],
            [
                /from "subscription_invoice_settlements"/i,
                [['settlement-1', 'invoice-1', 'PAYMENT', '80.00']],
            ],
        ];
        const { repo, statements } = recordingDb(script);
        // The cancellation of invoice-2: a cancelled invoice owes nothing.
        const cancelled = recordingDb([
            [/from "subscription_invoice_cancellations"/i, [['invoice-2', 'invoice-3']]],
            ...script,
        ]);

        assert.deepEqual(await repo.owedByInvoices([]), []);
        assert.equal(statements.length, 0);
        assert.deepEqual(await repo.owedByInvoices(['invoice-1', 'invoice-2']), [
            { invoiceId: 'invoice-1', owed: 0 },
            { invoiceId: 'invoice-2', owed: 58.31 },
        ]);
        assert.equal(statements.length, 3);
        assert.match(statements[2].sql, /from "subscription_invoice_cancellations"/i);
        assert.deepEqual(await cancelled.repo.owedByInvoices(['invoice-1', 'invoice-2']), [
            { invoiceId: 'invoice-1', owed: 0 },
            { invoiceId: 'invoice-2', owed: 0 },
        ]);
    });

    test('the accounts holding credits are asked with the kinds that give back', async () => {
        const { repo, statements } = recordingDb([
            [/^select distinct/i, [['stripe-a'], ['stripe-b']]],
        ]);

        assert.deepEqual(await repo.accountsHoldingCredits(), ['stripe-a', 'stripe-b']);
        assert.match(statements[0].sql, /"originReversalId"/);
        for (const kind of GIVING_BACK_CREDIT_ENTRY_KINDS) {
            assert.ok(statements[0].params.includes(kind), `${kind} is not passed`);
        }
    });
});
