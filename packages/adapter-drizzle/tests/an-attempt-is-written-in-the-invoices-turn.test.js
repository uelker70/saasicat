// What `DrizzleInvoiceCollectionRepository` asks the database, statement by
// statement, through Drizzle's own query builder and a transport that records
// what it would send.
//
// Whether the statements hold under concurrency is the persistence contract's
// to prove against PostgreSQL. These cases pin what can be read off the
// statements without one: that an attempt is started after the invoice's row
// is locked and its attempts read, that nothing is written where one is open,
// and that every write that settles or takes on an attempt names the state it
// expects.

// @requirement SC-PRIC-034 — A collection retried after an unanswered request never charges twice
// @requirement SC-PRIC-036 — What an invoice owes and how it is paid changes one step at a time

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
    amount: 58.31,
    currency: 'EUR',
    at: AT,
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
    '2026-02-01 05:20:00',
    '2026-02-01 05:20:00',
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

describe('starting an attempt', () => {
    const locked = [/for update/i, [['invoice-1']]];

    test('locks the invoice, reads its attempts, then writes the next one as submitted, without a conflict raised', async () => {
        const { repo, statements } = recordingDb([
            locked,
            [/^select .*from "subscription_invoice_collections"/i, [[1, 'FAILED']]],
            [/^insert into "subscription_invoice_collections"/i, [attemptRow(2)]],
        ]);

        const started = await repo.startAttempt(ATTEMPT);

        assert.deepEqual([started.attempt, started.status], [2, 'SUBMITTED']);
        assert.deepEqual(statements.map(kindOf), ['select', 'select', 'insert']);
        assert.match(statements[0].sql, /from "subscription_invoices".*for update/is);
        const insert = statements[2];
        assert.match(insert.sql, /on conflict do nothing/i);
        assert.ok(insert.params.includes('saasicat:collect:invoice-1:2'), insert.params.join());
        assert.ok(insert.params.includes('58.31'), 'the amount as two-place text');
    });

    for (const status of ['SUBMITTED', 'PENDING', 'SUCCEEDED']) {
        test(`writes nothing where an attempt is ${status.toLowerCase()}`, async () => {
            const { repo, statements } = recordingDb([
                locked,
                [/^select .*from "subscription_invoice_collections"/i, [[1, status]]],
            ]);

            assert.equal(await repo.startAttempt(ATTEMPT), null);
            assert.deepEqual(statements.map(kindOf), ['select', 'select']);
        });
    }

    test('answers no attempt where the insert met one, and refuses an invoice that does not exist', async () => {
        const conflicted = recordingDb([locked]);
        assert.equal(await conflicted.repo.startAttempt(ATTEMPT), null);

        const missing = recordingDb([]);
        await assert.rejects(missing.repo.startAttempt(ATTEMPT), /invoice-1 does not exist/);
        assert.deepEqual(missing.statements.map(kindOf), ['select']);
    });
});

describe('settling and taking on an attempt', () => {
    test('an outcome is written only to an attempt not settled, and says whether it was', async () => {
        const settled = recordingDb([[/^update/i, [['attempt-1']]]]);
        const already = recordingDb([]);

        assert.equal(
            await settled.repo.recordOutcome(
                'attempt-1',
                { status: 'succeeded', paymentRef: 'pi_1' },
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
        const [update] = settled.statements;
        assert.match(update.sql, /"status" in \(\$\d+, \$\d+\)/i);
        assert.ok(update.params.includes('SUBMITTED') && update.params.includes('PENDING'));
        assert.ok(update.params.includes('SUCCEEDED'));
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
