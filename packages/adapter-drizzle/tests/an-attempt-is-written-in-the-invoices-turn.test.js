// What `DrizzleInvoiceCollectionRepository` asks the database, statement by
// statement, through Drizzle's own query builder and a transport that records
// what it would send.
//
// Whether the statements hold under concurrency is the persistence contract's
// to prove against PostgreSQL. These cases pin what can be read off the
// statements without one: that an attempt is started or planned after the row
// of its invoice's chain's first invoice is locked and its attempts read, that
// nothing is written where they or another invoice of the chain refuse it, and
// that every write that settles, takes on, announces or withdraws an attempt
// names the state it expects.

// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice
// @requirement SC-PRIC-036 — What an invoice owes and how it is paid changes one step at a time
// @requirement SC-PRIC-080 — A failed collection is tried once more, and the subscriber is told of every failure

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/pg-proxy';

import { DrizzleInvoiceCollectionRepository } from '../dist/index.js';

const AT = new Date('2026-02-01T05:20:00.000Z');

/** An attempt as a run starts it. */
const ATTEMPT = {
    invoiceId: 'invoice-1',
    gatewayAccount: 'stripe-main',
    paymentMethodId: 'payment-method-1',
    paymentMethodType: 'card',
    customerRef: 'cus_1',
    paymentMethodRef: 'pm_1',
    invoiceNumber: 'AHP-2026-000123',
    currency: 'EUR',
    at: AT,
};

/** An attempt as a run plans it, after the invoice's first. */
const PLAN = {
    invoiceId: 'invoice-1',
    after: 1,
    gatewayAccount: 'stripe-main',
    paymentMethodId: 'payment-method-1',
    paymentMethodType: 'sepa_debit',
    customerRef: 'cus_1',
    paymentMethodRef: 'pm_1',
    invoiceNumber: 'AHP-2026-000123',
    currency: 'EUR',
    collectOn: '2026-03-01',
};

/** An attempt row as the driver hands it back, in the table's column order. */
const attemptRow = (attempt = 1, status = 'SUBMITTED') => [
    `attempt-${attempt}`,
    'invoice-1',
    attempt,
    `saasicat:collect:invoice-1:${attempt}`,
    'stripe-main',
    'payment-method-1',
    'card',
    'cus_1',
    'pm_1',
    'AHP-2026-000123',
    '58.31',
    'EUR',
    status,
    null,
    null,
    null,
    ...(status === 'SCHEDULED' ? [null, null] : ['2026-02-01 05:20:00', '2026-02-01 05:20:00']),
    null,
    status === 'SCHEDULED' ? '2026-03-01' : null,
    null,
    null,
];

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
    return { db, statements, repo: new DrizzleInvoiceCollectionRepository(db) };
}

const kindOf = ({ sql }) => sql.trim().split(/\s/, 1)[0].toLowerCase();

/**
 * The invoice's turn reads what it still owes — its total less what is
 * settled, as text —, which the attempt is written for.
 */
const owing = [/coalesce\(\(/i, [['23.68']]];

/** The chain the invoice belongs to: its own, as an invoice nothing corrected begins one. */
const chainOf = [/^select "chainId" from "subscription_invoices"/i, [['invoice-1']]];

/** The turn of the invoice's chain: its first invoice's row, locked. */
const locked = [/from "subscription_invoices".*for update/is, [['invoice-1']]];

/** The invoice's own attempts, as its turn reads them. */
const attemptsRead = /^select "attempt", "status" from "subscription_invoice_collections"/i;

/** The attempts of the other invoices of its chain that would hold it back. */
const chainAttemptsRead = /from "subscription_invoice_collections" "chain_attempts"/i;

describe('starting an attempt', () => {
    test('locks the invoice, reads its attempts, then writes the first one as submitted, without a conflict raised', async () => {
        const { repo, statements } = recordingDb([
            chainOf,
            locked,
            owing,
            [/^insert into "subscription_invoice_collections"/i, [attemptRow(1)]],
        ]);

        const started = await repo.startAttempt(ATTEMPT);

        assert.deepEqual([started.attempt, started.status], [1, 'SUBMITTED']);
        assert.deepEqual(statements.map(kindOf), [
            'select',
            'select',
            'select',
            'select',
            'select',
            'insert',
        ]);
        assert.match(statements[1].sql, /from "subscription_invoices".*for update/is);
        assert.match(statements[2].sql, /"subscription_invoice_settlements"/i, 'what it owes');
        assert.match(statements[2].sql, /"subscription_invoice_cancellations"/i, 'cancelled');
        assert.match(statements[3].sql, attemptsRead);
        assert.match(statements[4].sql, chainAttemptsRead);
        const insert = statements[5];
        assert.match(insert.sql, /on conflict do nothing/i);
        assert.ok(insert.params.includes('saasicat:collect:invoice-1:1'), insert.params.join());
        assert.ok(
            insert.params.includes('23.68'),
            'for what the invoice owes in its turn, as two-place text',
        );
    });

    for (const status of [
        'SCHEDULED',
        'SUBMITTED',
        'PENDING',
        'SUCCEEDED',
        'FAILED',
        'WITHDRAWN',
    ]) {
        test(`writes no first attempt where one is ${status.toLowerCase()}`, async () => {
            const { repo, statements } = recordingDb([
                chainOf,
                locked,
                owing,
                [attemptsRead, [[1, status]]],
            ]);

            assert.equal(await repo.startAttempt(ATTEMPT), null);
            assert.deepEqual(statements.map(kindOf), ['select', 'select', 'select', 'select']);
        });
    }

    test('writes none where another invoice of its chain holds it back', async () => {
        const { repo, statements } = recordingDb([
            chainOf,
            locked,
            owing,
            [chainAttemptsRead, [['attempt-9']]],
        ]);

        assert.equal(await repo.startAttempt(ATTEMPT), null);
        assert.equal(statements.map(kindOf).at(-1), 'select', 'nothing written');
        const held = statements.at(-1);
        assert.match(held.sql, chainAttemptsRead);
        for (const value of ['invoice-1', 'payment-method-1', 'REVERSED', 'SUBMITTED', 'PENDING']) {
            assert.ok(held.params.includes(value), `${value} in ${held.params.join()}`);
        }
    });

    test('answers no attempt where the insert met one, and refuses an invoice that does not exist', async () => {
        const conflicted = recordingDb([chainOf, locked, owing]);
        assert.equal(await conflicted.repo.startAttempt(ATTEMPT), null);
        assert.equal(conflicted.statements.map(kindOf).at(-1), 'insert');

        const missing = recordingDb([]);
        await assert.rejects(missing.repo.startAttempt(ATTEMPT), /invoice-1 does not exist/);
        assert.deepEqual(missing.statements.map(kindOf), ['select']);
    });

    test('writes none for an invoice that owes nothing, reading no attempt', async () => {
        const { repo, statements } = recordingDb([chainOf, locked]);

        assert.equal(await repo.startAttempt(ATTEMPT), null);
        assert.deepEqual(statements.map(kindOf), ['select', 'select', 'select']);
    });
});

describe('planning an attempt', () => {
    test('locks the invoice, reads its attempts, then writes the next one as planned for its day', async () => {
        const { repo, statements } = recordingDb([
            chainOf,
            locked,
            owing,
            [attemptsRead, [[1, 'FAILED']]],
            [/^insert into "subscription_invoice_collections"/i, [attemptRow(2, 'SCHEDULED')]],
        ]);

        const planned = await repo.plan(PLAN);

        assert.deepEqual(
            [planned.attempt, planned.status, planned.collectOn, planned.submittedAt],
            [2, 'SCHEDULED', '2026-03-01', null],
        );
        assert.deepEqual(statements.map(kindOf), [
            'select',
            'select',
            'select',
            'select',
            'select',
            'insert',
        ]);
        assert.match(statements[1].sql, /for update/i);
        assert.ok(statements[5].params.includes('SCHEDULED'));
        assert.ok(statements[5].params.includes('2026-03-01'));
    });

    test('writes nothing where another attempt came after the one it follows', async () => {
        const { repo, statements } = recordingDb([
            chainOf,
            locked,
            owing,
            [
                attemptsRead,
                [
                    [1, 'FAILED'],
                    [2, 'FAILED'],
                ],
            ],
        ]);

        assert.equal(await repo.plan(PLAN), null);
        assert.deepEqual(statements.map(kindOf), ['select', 'select', 'select', 'select']);
    });

    test('an announcement is written only to a planned attempt not announced yet', async () => {
        const { repo, statements } = recordingDb([[/^update/i, [['attempt-2']]]]);

        assert.equal(await repo.announce('attempt-2', '2026-03-01', AT), true);
        const [update] = statements;
        assert.match(update.sql, /"announcedAt" is null/i);
        assert.ok(update.params.includes('SCHEDULED') && update.params.includes('2026-03-01'));
    });

    test('a planned attempt is taken up as sent, or withdrawn, in the invoice’s turn and only while it is planned', async () => {
        const ofInvoice = [
            /^select "invoiceId" from "subscription_invoice_collections"/i,
            [['invoice-1']],
        ];
        const taken = recordingDb([
            ofInvoice,
            chainOf,
            locked,
            owing,
            [/^update/i, [attemptRow(2, 'SUBMITTED')]],
        ]);
        const paid = recordingDb([ofInvoice, [/^update/i, [attemptRow(2, 'SUBMITTED')]]]);
        const gone = recordingDb([]);
        const withdrawn = recordingDb([ofInvoice, chainOf, locked, [/^update/i, [['attempt-2']]]]);

        const sent = await taken.repo.submitPlanned('attempt-2', AT);
        assert.deepEqual([sent.status, sent.submittedAt], ['SUBMITTED', AT]);
        assert.equal(await gone.repo.submitPlanned('attempt-2', AT), null);
        assert.equal(
            await paid.repo.submitPlanned('attempt-2', AT),
            null,
            'sent for a paid invoice',
        );
        assert.ok(!paid.statements.some(({ sql }) => /^update/i.test(sql)));
        assert.equal(await withdrawn.repo.withdraw('attempt-2', AT), true);
        assert.equal(await gone.repo.withdraw('attempt-2', AT), false);
        for (const { statements } of [taken, withdrawn]) {
            const [ofAttempt, turn, update] = [statements[0], statements[2], statements.at(-1)];
            assert.ok(ofAttempt.params.includes('attempt-2'));
            assert.match(turn.sql, /from "subscription_invoices".*for update/is);
            assert.ok(turn.params.includes('invoice-1'), 'the chain of the attempt’s invoice');
            assert.match(update.sql, /^update .*"status" = \$\d+/is);
            assert.ok(update.params.includes('SCHEDULED'));
        }
        assert.deepEqual(taken.statements.map(kindOf), [
            'select',
            'select',
            'select',
            'select',
            'select',
            'update',
        ]);
    });

    test('what follows a failure is recorded only once, and only for a failure', async () => {
        const marked = recordingDb([[/^update/i, [['attempt-1']]]]);
        const already = recordingDb([]);

        assert.equal(await marked.repo.markFollowedUp('attempt-1', AT), true);
        assert.equal(await already.repo.markFollowedUp('attempt-1', AT), false);
        assert.match(marked.statements[0].sql, /"followedUpAt" is null/i);
        assert.ok(marked.statements[0].params.includes('FAILED'));
    });
});

describe('settling and taking on an attempt', () => {
    test('an outcome is written only to an attempt not settled, and says whether it was', async () => {
        const settled = recordingDb([
            [/^select "invoiceId" from "subscription_invoice_collections"/i, [['invoice-1']]],
            chainOf,
            locked,
            [/^update/i, [['attempt-1']]],
        ]);
        const already = recordingDb([]);

        assert.equal(
            await settled.repo.recordOutcome(
                'attempt-1',
                { status: 'succeeded', paymentRef: 'pi_1', amountCents: 5831, currency: 'EUR' },
                AT,
            ),
            true,
        );
        assert.equal(
            await already.repo.recordOutcome(
                'attempt-1',
                { status: 'pending', paymentRef: 'pi_1' },
                AT,
            ),
            false,
        );
        // A success is the money arriving: it takes the turn of the invoice's
        // chain first, as a late success for a failed attempt has to.
        const [turn, update] = settled.statements.slice(2);
        assert.match(turn.sql, /for update/i);
        assert.match(update.sql, /"status" in \(\$\d+, \$\d+\)/i);
        assert.ok(update.params.includes('SUBMITTED') && update.params.includes('PENDING'));
        assert.ok(update.params.includes('SUCCEEDED'));
        assert.match(already.statements[0].sql, /^update/i, 'anything else takes no turn');
    });

    test('a hold is taken only where the last one is older than the lease', async () => {
        const taken = recordingDb([[/^update/i, [['attempt-1']]]]);
        const held = recordingDb([]);
        const before = new Date('2026-02-01T05:05:00.000Z');

        assert.equal(await taken.repo.hold('attempt-1', before, AT), true);
        assert.equal(await held.repo.hold('attempt-1', before, AT), false);
        assert.match(taken.statements[0].sql, /"heldAt" < \$\d+/);
    });
});

describe('reading', () => {
    test('the invoices due are mailed, with a payment, on or before their date, and without an attempt', async () => {
        const { repo, statements } = recordingDb([[/^select/i, [['invoice-1'], ['invoice-2']]]]);

        const due = await repo.listDue('2026-02-15', { limit: 2, after: 'invoice-0' });

        assert.deepEqual(due, ['invoice-1', 'invoice-2']);
        const [select] = statements;
        assert.match(select.sql, /"deliveredAt" is not null/i);
        assert.match(select.sql, /"payment" is not null/i);
        assert.match(select.sql, /not exists/i);
        assert.ok(select.params.includes('2026-02-15'));
    });

    test('the attempts not settled are the submitted ones past the lease and the pending ones past the hour', async () => {
        const { repo, statements } = recordingDb([[/^select/i, [['attempt-1']]]]);

        const open = await repo.listUnsettled(
            { submittedBefore: AT, pendingBefore: AT },
            { limit: 10 },
        );

        assert.deepEqual(open, ['attempt-1']);
        assert.ok(statements[0].params.includes('SUBMITTED'));
        assert.ok(statements[0].params.includes('PENDING'));
    });

    test('the planned attempts are listed by id', async () => {
        const { repo, statements } = recordingDb([[/^select/i, [['attempt-2']]]]);

        assert.deepEqual(await repo.listPlanned({ limit: 10, after: 'attempt-1' }), ['attempt-2']);
        assert.ok(statements[0].params.includes('SCHEDULED'));
        assert.ok(statements[0].params.includes('attempt-1'));
    });

    test('the failed attempts not followed up are listed by id', async () => {
        const { repo, statements } = recordingDb([[/^select/i, [['attempt-1']]]]);

        assert.deepEqual(await repo.listToFollowUp({ limit: 10, after: 'attempt-0' }), [
            'attempt-1',
        ]);
        const [select] = statements;
        assert.match(select.sql, /"followedUpAt" is null/i);
        assert.ok(select.params.includes('FAILED') && select.params.includes('attempt-0'));
    });

    test('the invoices another payment method can collect are read by their last attempt and the one in use', async () => {
        const { repo, statements } = recordingDb([[/^select/i, [['invoice-1']]]]);

        assert.deepEqual(await repo.listCollectableAgain({ limit: 10 }), ['invoice-1']);
        const [select] = statements;
        assert.match(select.sql, /join "subscriber_payment_methods"/i);
        assert.match(
            select.sql,
            /select max\("attempt"\) from "subscription_invoice_collections" "others"/i,
        );
        assert.match(select.sql, /"followedUpAt" is not null/i);
        assert.match(
            select.sql,
            /"subscriber_payment_methods"\."id" <> "subscription_invoice_collections"\."paymentMethodId"/i,
        );
        for (const value of ['ACTIVE', 'WITHDRAWN', 'FAILED']) {
            assert.ok(select.params.includes(value), value);
        }
    });

    test('the accounts in use are those of attempts not settled, each once', async () => {
        const { repo, statements } = recordingDb([
            [/^select distinct/i, [['stripe-main'], ['stripe-old']]],
        ]);

        assert.deepEqual(await repo.accountsInUse(), ['stripe-main', 'stripe-old']);
        assert.ok(statements[0].params.includes('SUBMITTED'));
        assert.ok(statements[0].params.includes('PENDING'));
    });

    test('an attempt reads back as a record, by id and with its invoice’s others, the first first', async () => {
        const one = recordingDb([[/^select/i, [attemptRow(1, 'FAILED')]]]);
        const none = recordingDb([]);
        const all = recordingDb([[/^select/i, [attemptRow(1, 'FAILED'), attemptRow(2)]]]);

        const found = await one.repo.findById('attempt-1');
        const listed = await all.repo.listByInvoice('invoice-1');

        assert.deepEqual(
            [found.attemptKey, found.amount, found.status, found.submittedAt],
            ['saasicat:collect:invoice-1:1', 58.31, 'FAILED', AT],
        );
        assert.equal(await none.repo.findById('attempt-9'), null);
        assert.deepEqual(
            listed.map((attempt) => attempt.attempt),
            [1, 2],
        );
        assert.match(all.statements[0].sql, /order by .*"attempt"/i);
    });
});
