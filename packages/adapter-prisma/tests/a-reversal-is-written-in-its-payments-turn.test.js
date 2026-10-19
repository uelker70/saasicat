// `PrismaSubscriberPaymentRepository` and its reversals and cases, over a
// memory client whose unique keys are read from fragment 24.
//
// The database semantics — two reports of one reversal at once applying it
// once, a refund's case opened once however often the refund is reported — are
// the contract's, and run against PostgreSQL in tests/integration/. What this
// holds is the translation: that a reversal takes the turn of the chain of
// every invoice its payment settles, by the chains' first invoices in one
// order, then the subscriber's credits, then its own row; that a report writes only what grew since the one before; that what it
// takes and gives back reaches the credit entries, the settlements and its own
// row with the reversal named; and that a give-back, a refund's failure and the
// operator each close exactly the cases they name.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide
// @requirement SC-PRIC-084 — A returned debit or a chargeback is recorded, and what the payment settled opens again
// @requirement SC-PRIC-086 — A dispute won takes its reversal back, and what was paid meanwhile becomes a credit
// @requirement SC-ADM-033 — The operator reconciles what no credit matched, and closes each case with a note
// @requirement SC-PRIC-087 — A credit left for the same invoice covers what a reversal would open again

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CASE_CLOSED_REFUND_ENDED,
    CASE_CLOSED_REVERSAL_GIVEN_BACK,
    GIVING_BACK_CREDIT_ENTRY_KINDS,
} from '@saasicat/core';
import { PrismaSubscriberPaymentRepository } from '../dist/index.js';
import { memoryPrisma, rawOf, writesTo } from './support/memory-prisma.js';

const PAID_AT = new Date('2026-02-01T05:20:00.000Z');
const REVERSED_AT = new Date('2026-02-20T09:00:00.000Z');
const GIVEN_BACK_AT = new Date('2026-04-02T09:00:00.000Z');

/** An invoice nothing corrected: the first of a chain of its own. */
const invoiceRow = (id, totalGross) => ({
    id,
    subscriberId: 'subscriber-1',
    tenantId: 'tenant-1',
    totalGross,
    currency: 'EUR',
    chainId: id,
    chainStep: 0,
});

const paymentOf = (gatewayRef, amount, at = PAID_AT) => ({
    invoiceId: 'invoice-1',
    collectionId: `attempt-${gatewayRef}`,
    gatewayAccount: 'stripe-main',
    provider: 'stripe',
    gatewayRef,
    amount,
    currency: 'EUR',
    at,
});

/**
 * A client holding invoice-1 of 80, paid with 100 by `pi_1`: 80 settle it and
 * 20 are left as a credit. The statements of the payment are cleared.
 */
async function paid() {
    const client = memoryPrisma({
        tables: { subscriptionInvoice: [invoiceRow('invoice-1', '80.00')] },
    });
    const repo = new PrismaSubscriberPaymentRepository(client);
    const { payment, credit } = await repo.recordPayment(paymentOf('pi_1', 100));
    client.statements.length = 0;
    return { client, repo, payment, credit };
}

/** The dispute `du_1` of `pi_1`, as the gateway reports it in total. */
const dispute = (withdrawn, reinstated = 0, at = REVERSED_AT) => ({
    gatewayAccount: 'stripe-main',
    gatewayRef: 'du_1',
    paymentRef: 'pi_1',
    currency: 'EUR',
    withdrawn,
    reinstated,
    at,
});

const payoutOf = (creditId, amount) => ({
    creditId,
    amount,
    reference: 'TRF-1',
    paidOn: '2026-02-10',
    note: null,
    recordedBy: 'operator-1',
    at: PAID_AT,
});

/** What `client` wrote to `delegate`, as kind and amount; a column's decimal text read as a number. */
const kindsWritten = (client, delegate) =>
    writesTo(client, delegate).map(([, { data }]) => [data.kind, Number(data.amount)]);

const amountsOf = (row, ...columns) => columns.map((column) => Number(row[column]));

describe('a reversal', () => {
    test('takes the turn of every invoice its payment settles, in one order, then the credits, then its own row', async () => {
        const { client, repo, payment } = await paid();
        // A settlement of the same payment on an invoice whose id sorts first.
        client.rows('subscriptionInvoice').push(invoiceRow('invoice-0', '0.00'));
        client.rows('subscriptionInvoiceSettlement').push({
            id: 'settlement-0',
            invoiceId: 'invoice-0',
            paymentId: payment.id,
            kind: 'PAYMENT',
            amount: '0.00',
            reversalId: null,
            recordedAt: PAID_AT,
        });

        await repo.recordReversal(dispute(5));

        const locks = rawOf(client).filter((sql) => sql.includes('FOR UPDATE'));
        assert.deepEqual(
            locks.map((sql) => sql.split('"')[3]),
            [
                'subscription_invoices',
                'subscription_invoices',
                'subscriber_credits',
                'subscriber_reversals',
            ],
        );
        const lockedInvoices = client.statements
            .filter(
                ([kind, sql]) => kind === '$queryRaw' && sql.includes('"subscription_invoices"'),
            )
            .map(([, , values]) => values[0]);
        assert.deepEqual(lockedInvoices, ['invoice-0', 'invoice-1']);
        assert.equal(client.statements[0][0], '$transaction');
    });

    test('takes the open credit first, then opens the invoice, and writes its totals on its row', async () => {
        const { client, repo, credit } = await paid();

        const recorded = await repo.recordReversal(dispute(50));

        assert.equal(recorded.outcome, 'recorded');
        assert.deepEqual(recorded.withdrawal.credits, [{ creditId: credit.id, amount: 20 }]);
        assert.deepEqual(recorded.withdrawal.invoices, [{ invoiceId: 'invoice-1', amount: 30 }]);
        assert.equal(recorded.withdrawal.unmatched, 0);
        assert.equal(recorded.reinstatement, null);
        assert.deepEqual(kindsWritten(client, 'subscriberCreditEntry'), [['REVERSAL', 20]]);
        assert.deepEqual(kindsWritten(client, 'subscriptionInvoiceSettlement'), [['REVERSAL', 30]]);
        const [reversal] = client.rows('subscriberReversal');
        for (const [, { data }] of [
            ...writesTo(client, 'subscriberCreditEntry'),
            ...writesTo(client, 'subscriptionInvoiceSettlement'),
        ]) {
            assert.equal(data.reversalId, reversal.id);
        }
        assert.deepEqual(amountsOf(reversal, 'amount', 'fromCredit', 'reinstated'), [50, 20, 0]);
        assert.equal(await repo.owedBy('invoice-1'), 30);
    });

    test('reported again unchanged, writes nothing but the row it skips', async () => {
        const { client, repo } = await paid();
        await repo.recordReversal(dispute(50));
        client.statements.length = 0;

        const again = await repo.recordReversal(dispute(50));

        assert.equal(again.outcome, 'unchanged');
        assert.equal(again.reversal.amount, 50);
        assert.deepEqual(writesTo(client, 'subscriberCreditEntry'), []);
        assert.deepEqual(writesTo(client, 'subscriptionInvoiceSettlement'), []);
        assert.deepEqual(
            writesTo(client, 'subscriberReversal').map(([method, args]) => [
                method,
                args.skipDuplicates,
            ]),
            [['createMany', true]],
        );
        assert.equal(client.rows('subscriberReversal').length, 1);
    });

    test('grown since the last report, writes only what grew', async () => {
        const { client, repo, credit } = await paid();
        await repo.recordReversal(dispute(15));
        client.statements.length = 0;

        const grown = await repo.recordReversal(dispute(25));

        assert.deepEqual(grown.withdrawal.credits, [{ creditId: credit.id, amount: 5 }]);
        assert.deepEqual(grown.withdrawal.invoices, [{ invoiceId: 'invoice-1', amount: 5 }]);
        assert.deepEqual(kindsWritten(client, 'subscriberCreditEntry'), [['REVERSAL', 5]]);
        const [reversal] = client.rows('subscriberReversal');
        assert.deepEqual(amountsOf(reversal, 'amount', 'fromCredit'), [25, 20]);
    });

    test('meeting a credit already paid out and going beyond the payment, opens one case', async () => {
        const { client, repo, payment, credit } = await paid();
        await repo.recordPayout(payoutOf(credit.id, 20));

        const recorded = await repo.recordReversal(dispute(110));

        assert.deepEqual(recorded.withdrawal.credits, []);
        assert.deepEqual(recorded.withdrawal.invoices, [{ invoiceId: 'invoice-1', amount: 80 }]);
        assert.equal(recorded.withdrawal.unmatched, 30);
        const [opened] = client.rows('subscriberReconciliationCase');
        assert.deepEqual(recorded.withdrawal.case, {
            ...recorded.withdrawal.case,
            id: opened.id,
            kind: 'REVERSAL_UNMATCHED',
            amount: 30,
        });
        assert.deepEqual(
            [opened.paymentId, opened.reversalId, opened.refundId, opened.gatewayRef],
            [payment.id, recorded.reversal.id, null, 'du_1'],
        );
    });

    test('takes a credit another payment for the same invoice left before it opens the invoice', async () => {
        const { client, repo, credit } = await paid();
        const late = await repo.recordPayment(paymentOf('pi_2', 30, REVERSED_AT));
        client.statements.length = 0;

        const recorded = await repo.recordReversal(dispute(50));

        assert.deepEqual(recorded.withdrawal.credits, [{ creditId: credit.id, amount: 20 }]);
        assert.deepEqual(recorded.withdrawal.covering, [{ creditId: late.credit.id, amount: 30 }]);
        assert.deepEqual(recorded.withdrawal.invoices, []);
        assert.deepEqual(
            writesTo(client, 'subscriberCreditEntry').map(([, { data }]) => [
                data.creditId,
                data.kind,
                Number(data.amount),
            ]),
            [
                [credit.id, 'REVERSAL', 20],
                [late.credit.id, 'REVERSAL', 30],
            ],
        );
        assert.deepEqual(writesTo(client, 'subscriptionInvoiceSettlement'), []);
        assert.equal(await repo.owedBy('invoice-1'), 0);
    });

    test('of a payment this installation does not hold, writes nothing', async () => {
        const { client, repo } = await paid();

        assert.deepEqual(await repo.recordReversal({ ...dispute(10), paymentRef: 'pi_other' }), {
            outcome: 'unknown-payment',
        });
        assert.deepEqual(rawOf(client), []);
        assert.equal(client.rows('subscriberReversal').length, 0);
    });

    test('in another currency than its payment, is refused before anything is held', async () => {
        const { client, repo } = await paid();

        await assert.rejects(repo.recordReversal({ ...dispute(10), currency: 'USD' }), /is in USD/);
        assert.deepEqual(rawOf(client), []);
    });

    test('held under its reference against another payment, is refused', async () => {
        const { client, repo } = await paid();
        client.rows('subscriberReversal').push({
            id: 'reversal-elsewhere',
            subscriberId: 'subscriber-1',
            tenantId: 'tenant-1',
            paymentId: 'payment-elsewhere',
            gatewayAccount: 'stripe-main',
            gatewayRef: 'du_1',
            amount: '0.00',
            currency: 'EUR',
            fromCredit: '0.00',
            reinstated: '0.00',
            reinstatedToCases: '0.00',
            recordedAt: PAID_AT,
            reinstatedAt: null,
        });

        await assert.rejects(
            repo.recordReversal(dispute(10)),
            /recorded against payment payment-elsewhere/,
        );
        assert.deepEqual(writesTo(client, 'subscriberCreditEntry'), []);
    });
});

describe('a reversal given back', () => {
    test('in full, gives back what it took of the credit, settles the invoice again, and only once', async () => {
        const { client, repo, credit } = await paid();
        await repo.recordReversal(dispute(50));
        client.statements.length = 0;

        const given = await repo.recordReversal(dispute(50, 50, GIVEN_BACK_AT));

        assert.equal(given.withdrawal, null);
        assert.deepEqual(given.reinstatement, {
            closedCases: [],
            credits: [{ creditId: credit.id, amount: 20 }],
            invoices: [{ invoiceId: 'invoice-1', amount: 30 }],
            credit: null,
        });
        assert.deepEqual(kindsWritten(client, 'subscriberCreditEntry'), [
            ['REVERSAL_TAKEN_BACK', 20],
        ]);
        assert.deepEqual(kindsWritten(client, 'subscriptionInvoiceSettlement'), [
            ['REINSTATEMENT', 30],
        ]);
        const [reversal] = client.rows('subscriberReversal');
        assert.deepEqual([Number(reversal.reinstated), reversal.reinstatedAt], [50, GIVEN_BACK_AT]);
        assert.equal(await repo.owedBy('invoice-1'), 0);

        client.statements.length = 0;
        assert.equal(
            (await repo.recordReversal(dispute(50, 50, GIVEN_BACK_AT))).outcome,
            'unchanged',
        );
        assert.deepEqual(writesTo(client, 'subscriptionInvoiceSettlement'), []);
    });

    test('closes the case it opened first, as SaaSiCat and saying why', async () => {
        const { client, repo, credit } = await paid();
        await repo.recordPayout(payoutOf(credit.id, 20));
        await repo.recordReversal(dispute(110));
        client.statements.length = 0;

        const given = await repo.recordReversal(dispute(110, 30, GIVEN_BACK_AT));

        const [closed] = client.rows('subscriberReconciliationCase');
        assert.deepEqual(
            [closed.closedAt, closed.closedBy, closed.note],
            [GIVEN_BACK_AT, null, CASE_CLOSED_REVERSAL_GIVEN_BACK],
        );
        assert.deepEqual(
            given.reinstatement.closedCases.map((each) => [each.id, each.note]),
            [[closed.id, CASE_CLOSED_REVERSAL_GIVEN_BACK]],
        );
        assert.deepEqual(given.reinstatement.invoices, []);
        assert.deepEqual(writesTo(client, 'subscriptionInvoiceSettlement'), []);
    });

    test('after the invoice was paid again, leaves what it no longer owes as a credit from the reversal', async () => {
        const { client, repo, payment } = await paid();
        await repo.recordReversal(dispute(50));
        await repo.recordPayment(paymentOf('pi_2', 30, REVERSED_AT));
        client.statements.length = 0;

        const given = await repo.recordReversal(dispute(50, 50, GIVEN_BACK_AT));

        assert.deepEqual(given.reinstatement.invoices, []);
        assert.equal(given.reinstatement.credit.amount, 30);
        const fromReversal = client
            .rows('subscriberCredit')
            .filter((each) => each.originReversalId === given.reversal.id);
        assert.deepEqual(
            fromReversal.map((each) => [
                Number(each.amount),
                each.originPaymentId,
                each.subscriberId,
            ]),
            [[30, null, payment.subscriberId]],
        );
    });
});

/** A case as fragment 24 holds it. */
const caseRow = (id, recordedAt, overrides = {}) => ({
    id,
    subscriberId: 'subscriber-1',
    tenantId: 'tenant-1',
    kind: 'REFUND_UNMATCHED',
    amount: '10.00',
    currency: 'EUR',
    paymentId: 'payment-1',
    refundId: `refund-${id}`,
    reversalId: null,
    gatewayAccount: 'stripe-main',
    gatewayRef: `re_${id}`,
    recordedAt,
    closedAt: null,
    closedBy: null,
    note: null,
    ...overrides,
});

describe('the cases to reconcile', () => {
    const day = (n) => new Date(`2026-03-0${n}T09:00:00.000Z`);
    const seeded = () => {
        const client = memoryPrisma({
            tables: {
                subscriberReconciliationCase: [
                    caseRow('case-c', day(3)),
                    caseRow('case-a', day(1)),
                    caseRow('case-b', day(1)),
                    caseRow('case-d', day(4), { subscriberId: 'subscriber-2' }),
                    caseRow('case-e', day(2), {
                        closedAt: day(5),
                        closedBy: 'operator-1',
                        note: 'Paid back by transfer.',
                    }),
                ],
            },
        });
        return { client, repo: new PrismaSubscriberPaymentRepository(client) };
    };
    const idsOf = (cases) => cases.map((each) => each.id);

    test('are read open or closed, the oldest first, a page after the case it names', async () => {
        const { repo } = seeded();

        assert.deepEqual(idsOf(await repo.listCases({ state: 'open' }, { limit: 2 })), [
            'case-a',
            'case-b',
        ]);
        assert.deepEqual(
            idsOf(await repo.listCases({ state: 'open' }, { limit: 2, after: 'case-b' })),
            ['case-c', 'case-d'],
        );
        assert.deepEqual(idsOf(await repo.listCases({ state: 'closed' }, { limit: 10 })), [
            'case-e',
        ]);
        assert.deepEqual(
            idsOf(
                await repo.listCases(
                    { state: 'open', subscriberId: 'subscriber-2' },
                    { limit: 10 },
                ),
            ),
            ['case-d'],
        );
    });

    test('one is closed with the operator’s note once, and an unknown one is answered as such', async () => {
        const { client, repo } = seeded();
        const close = { caseId: 'case-a', note: 'Recovered.', closedBy: 'operator-1', at: day(6) };

        const closed = await repo.closeCase(close);
        const again = await repo.closeCase({ ...close, note: 'Again.' });

        assert.equal(closed.outcome, 'closed');
        assert.deepEqual(
            [closed.case.closedBy, closed.case.note, closed.case.closedAt],
            ['operator-1', 'Recovered.', day(6)],
        );
        assert.equal(again.outcome, 'already-closed');
        assert.equal(again.case.note, 'Recovered.');
        assert.deepEqual(
            writesTo(client, 'subscriberReconciliationCase').map(([, args]) => args.where),
            [
                { id: 'case-a', closedAt: null },
                { id: 'case-a', closedAt: null },
            ],
        );
        assert.deepEqual(await repo.closeCase({ ...close, caseId: 'case-unknown' }), {
            outcome: 'unknown-case',
        });
    });

    test('a refund’s part no credit takes opens one, once, and its failure closes it', async () => {
        const { client, repo, credit } = await paid();
        const refund = {
            gatewayAccount: 'stripe-main',
            gatewayRef: 're_1',
            paymentRef: 'pi_1',
            amount: 30,
            currency: 'EUR',
            status: 'SUCCEEDED',
            at: REVERSED_AT,
        };

        const recorded = await repo.recordRefund(refund);
        const again = await repo.recordRefund(refund);
        const failed = await repo.recordRefund({ ...refund, status: 'FAILED', at: GIVEN_BACK_AT });

        assert.deepEqual(recorded.parts, [{ creditId: credit.id, amount: 20 }]);
        assert.equal(recorded.unmatched, 10);
        assert.deepEqual([recorded.case.kind, recorded.case.amount], ['REFUND_UNMATCHED', 10]);
        assert.equal(again.outcome, 'unchanged');
        assert.equal(client.rows('subscriberReconciliationCase').length, 1);
        assert.equal(failed.outcome, 'given-back');
        assert.deepEqual(
            failed.closedCases.map((each) => [each.id, each.note, each.closedBy]),
            [[recorded.case.id, CASE_CLOSED_REFUND_ENDED, null]],
        );
    });
});

describe('what the credits and invoices read', () => {
    test('what each invoice owes is read in three statements, and nothing is asked for none', async () => {
        const { client, repo } = await paid();
        client.rows('subscriptionInvoice').push(invoiceRow('invoice-2', '58.31'));

        assert.deepEqual(await repo.owedByInvoices([]), []);
        assert.deepEqual(client.statements, []);
        assert.deepEqual(await repo.owedByInvoices(['invoice-1', 'invoice-2']), [
            { invoiceId: 'invoice-1', owed: 0 },
            { invoiceId: 'invoice-2', owed: 58.31 },
        ]);
        assert.equal(client.statements.length, 3);
        // A cancelled invoice owes nothing, whatever it states.
        client.rows('subscriptionInvoiceCancellation').push({
            id: 'cancellation-1',
            cancelledInvoiceId: 'invoice-2',
            cancellationInvoiceId: 'invoice-3',
            replacementInvoiceId: null,
        });
        assert.deepEqual(await repo.owedByInvoices(['invoice-2']), [
            { invoiceId: 'invoice-2', owed: 0 },
        ]);
    });

    test('a reversal is found by its id, and none by another', async () => {
        const { repo } = await paid();
        const { reversal } = await repo.recordReversal(dispute(5));

        assert.deepEqual(await repo.findReversalById(reversal.id), reversal);
        assert.equal(await repo.findReversalById('reversal-unknown'), null);
    });

    test('the accounts holding credits are asked with the kinds that give back, and read as texts', async () => {
        const client = memoryPrisma({
            raw: () => [{ account: 'stripe-a' }, { account: 'stripe-b' }],
        });

        const accounts = await new PrismaSubscriberPaymentRepository(
            client,
        ).accountsHoldingCredits();

        assert.deepEqual(accounts, ['stripe-a', 'stripe-b']);
        const [[, sql, values]] = client.statements;
        assert.match(sql, /"originReversalId"/);
        assert.deepEqual(values, [[...GIVING_BACK_CREDIT_ENTRY_KINDS]]);
    });

    test('an invoice that owes less than nothing becomes a credit of its own, once', async () => {
        const client = memoryPrisma({
            tables: {
                subscriptionInvoice: [
                    invoiceRow('invoice-credit', '-12.50'),
                    invoiceRow('invoice-1', '80.00'),
                ],
            },
        });
        const repo = new PrismaSubscriberPaymentRepository(client);

        const credit = await repo.creditInvoice('invoice-credit', PAID_AT);

        assert.deepEqual(
            [credit.amount, credit.origin],
            [12.5, { kind: 'invoice', invoiceId: 'invoice-credit' }],
        );
        assert.equal(await repo.creditInvoice('invoice-credit', PAID_AT), null);
        assert.equal(await repo.creditInvoice('invoice-1', PAID_AT), null);
    });
});
