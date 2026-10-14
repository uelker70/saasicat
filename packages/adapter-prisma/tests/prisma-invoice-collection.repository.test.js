// `PrismaInvoiceCollectionRepository` — what it asks the client for.
//
// The database semantics — one attempt open per invoice however many runs
// start or plan one, the turn on the invoice's row, a write that lands only on
// the state it names — are the contract's, and run against PostgreSQL in
// tests/integration/. What this holds is the translation: that an attempt is
// written in the invoice's turn after its attempts were read, and not where
// they refuse it; that a planned day reaches its `date` column as midnight
// UTC; and that every write that settles, takes on, announces or withdraws an
// attempt names the state it expects in its `WHERE`.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide
// @requirement SC-PRIC-080 — A failed collection is tried once more, and the subscriber is told of every failure

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaInvoiceCollectionRepository } from '../dist/index.js';

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
    amount: 58.31,
    currency: 'EUR',
    collectOn: '2026-03-01',
};

/** An attempt row as Prisma hands it back: a decimal amount, a `date` column as a `Date`. */
const rowOf = (overrides = {}) => ({
    id: 'attempt-1',
    invoiceId: 'invoice-1',
    attempt: 1,
    attemptKey: 'saasicat:collect:invoice-1:1',
    gatewayAccount: 'stripe-main',
    paymentMethodId: 'payment-method-1',
    paymentMethodType: 'card',
    customerRef: 'cus_1',
    paymentMethodRef: 'pm_1',
    invoiceNumber: 'AHP-2026-000123',
    amount: { toString: () => '58.31' },
    currency: 'EUR',
    status: 'SUBMITTED',
    paymentRef: null,
    failureReason: null,
    failureCode: null,
    submittedAt: AT,
    heldAt: AT,
    resolvedAt: null,
    collectOn: null,
    announcedAt: null,
    followedUpAt: null,
    ...overrides,
});

/**
 * A client that records every call. `earlier` is what the turn reads of the
 * invoice's attempts, `raw` what a raw query answers, `updated` how many rows
 * a conditional update reaches.
 */
function fakeClient({
    earlier = [],
    raw = [{ id: 'invoice-1' }],
    updated = 1,
    row = rowOf(),
} = {}) {
    const calls = [];
    const record = (name, answer) => async (args) => {
        calls.push([name, args]);
        return typeof answer === 'function' ? answer(args) : answer;
    };
    const client = {
        calls,
        subscriptionInvoiceCollection: {
            findMany: record('findMany', (args) => (args?.select?.attempt ? earlier : [row])),
            findUnique: record('findUnique', row),
            createManyAndReturn: record('createManyAndReturn', (args) => [
                rowOf({ ...args.data[0], amount: args.data[0].amount }),
            ]),
            updateMany: record('updateMany', { count: updated }),
        },
        async $queryRaw(strings, ...values) {
            calls.push(['$queryRaw', strings.join('?'), values]);
            return raw;
        },
        async $transaction(work) {
            calls.push(['$transaction']);
            return work(client);
        },
    };
    return client;
}

const callsOf = (client, name) => client.calls.filter(([called]) => called === name);

describe('writing an invoice’s next attempt', () => {
    test('the first is started in the invoice’s turn after its attempts were read', async () => {
        const client = fakeClient();
        const repo = new PrismaInvoiceCollectionRepository(client);

        const started = await repo.startAttempt(ATTEMPT);

        assert.deepEqual(
            client.calls.map(([name]) => name),
            ['$transaction', '$queryRaw', 'findMany', 'createManyAndReturn'],
        );
        assert.match(callsOf(client, '$queryRaw')[0][1], /FOR UPDATE/);
        const [[, insert]] = callsOf(client, 'createManyAndReturn');
        assert.equal(insert.skipDuplicates, true);
        assert.deepEqual(
            [insert.data[0].attempt, insert.data[0].status, insert.data[0].collectOn],
            [1, 'SUBMITTED', null],
        );
        assert.equal(started.status, 'SUBMITTED');
    });

    test('no first attempt is started where the invoice has one, and nothing is written', async () => {
        const client = fakeClient({ earlier: [{ attempt: 1, status: 'FAILED' }] });

        assert.equal(
            await new PrismaInvoiceCollectionRepository(client).startAttempt(ATTEMPT),
            null,
        );
        assert.equal(callsOf(client, 'createManyAndReturn').length, 0);
    });

    test('a planned one is written for its day, the day as midnight UTC, on the caller’s transaction', async () => {
        const client = fakeClient({ earlier: [{ attempt: 1, status: 'FAILED' }] });

        const planned = await new PrismaInvoiceCollectionRepository(client).plan(PLAN, client);

        assert.equal(callsOf(client, '$transaction').length, 0);
        const [[, insert]] = callsOf(client, 'createManyAndReturn');
        assert.deepEqual(
            [insert.data[0].attempt, insert.data[0].status, insert.data[0].submittedAt],
            [2, 'SCHEDULED', null],
        );
        assert.deepEqual(insert.data[0].collectOn, new Date('2026-03-01T00:00:00.000Z'));
        assert.equal(planned.collectOn, '2026-03-01');
    });

    test('no planned one is written after another attempt than the one it follows', async () => {
        const client = fakeClient({
            earlier: [
                { attempt: 1, status: 'FAILED' },
                { attempt: 2, status: 'FAILED' },
            ],
        });

        assert.equal(await new PrismaInvoiceCollectionRepository(client).plan(PLAN), null);
        assert.equal(callsOf(client, 'createManyAndReturn').length, 0);
    });

    test('an invoice that does not exist is refused', async () => {
        const client = fakeClient({ raw: [] });

        await assert.rejects(
            new PrismaInvoiceCollectionRepository(client).startAttempt(ATTEMPT),
            /Invoice invoice-1 does not exist/,
        );
    });
});

describe('a write that names the state it expects', () => {
    for (const [what, call, where, data, answer] of [
        [
            'an outcome lands on an attempt not settled',
            (repo) =>
                repo.recordOutcome('attempt-1', { status: 'pending', paymentRef: 'pi_1' }, AT),
            { id: 'attempt-1', status: { in: ['SUBMITTED', 'PENDING'] } },
            { status: 'PENDING', paymentRef: 'pi_1', resolvedAt: null },
            true,
        ],
        [
            'a hold lands only where the last one is older than the lease',
            (repo) => repo.hold('attempt-1', AT, AT),
            { id: 'attempt-1', status: { in: ['SUBMITTED', 'PENDING'] }, heldAt: { lt: AT } },
            { heldAt: AT },
            true,
        ],
        [
            'an announcement lands on a planned attempt not announced yet',
            (repo) => repo.announce('attempt-2', '2026-03-01', AT),
            { id: 'attempt-2', status: 'SCHEDULED', announcedAt: null },
            { collectOn: new Date('2026-03-01T00:00:00.000Z'), announcedAt: AT },
            true,
        ],
        [
            'a withdrawal lands on a planned attempt',
            (repo) => repo.withdraw('attempt-2', AT),
            { id: 'attempt-2', status: 'SCHEDULED' },
            { status: 'WITHDRAWN', resolvedAt: AT },
            true,
        ],
        [
            'a follow-up lands on a failure not followed up',
            (repo) => repo.markFollowedUp('attempt-1', AT),
            { id: 'attempt-1', status: 'FAILED', followedUpAt: null },
            { followedUpAt: AT },
            true,
        ],
    ]) {
        test(what, async () => {
            const client = fakeClient();
            const missed = fakeClient({ updated: 0 });

            assert.equal(await call(new PrismaInvoiceCollectionRepository(client)), answer);
            assert.equal(await call(new PrismaInvoiceCollectionRepository(missed)), false);
            const [[, update]] = callsOf(client, 'updateMany');
            assert.deepEqual(update.where, where);
            for (const [column, value] of Object.entries(data)) {
                assert.deepEqual(update.data[column], value, column);
            }
        });
    }

    test('a planned attempt is taken up as sent, or withdrawn, in the invoice’s turn', async () => {
        for (const take of [
            (repo) => repo.submitPlanned('attempt-2', AT),
            (repo) => repo.withdraw('attempt-2', AT),
        ]) {
            const client = fakeClient();

            await take(new PrismaInvoiceCollectionRepository(client));

            assert.deepEqual(
                client.calls.slice(0, 3).map(([name]) => name),
                ['$transaction', '$queryRaw', 'updateMany'],
            );
            const [[, lock, values]] = callsOf(client, '$queryRaw');
            assert.match(lock, /FROM "subscription_invoices"[\s\S]*FOR UPDATE/);
            assert.deepEqual(values, ['attempt-2']);
        }
    });

    test('a planned attempt is taken up as sent once, and read back as written', async () => {
        const client = fakeClient({ row: rowOf({ id: 'attempt-2', attempt: 2 }) });
        const gone = fakeClient({ updated: 0 });

        const sent = await new PrismaInvoiceCollectionRepository(client).submitPlanned(
            'attempt-2',
            AT,
        );

        const [[, update]] = callsOf(client, 'updateMany');
        assert.deepEqual(update.where, { id: 'attempt-2', status: 'SCHEDULED' });
        assert.deepEqual(update.data, { status: 'SUBMITTED', submittedAt: AT, heldAt: AT });
        assert.deepEqual([sent.status, sent.submittedAt], ['SUBMITTED', AT]);
        assert.equal(
            await new PrismaInvoiceCollectionRepository(gone).submitPlanned('attempt-2', AT),
            null,
        );
        assert.equal(callsOf(gone, 'findUnique').length, 0);
    });
});

describe('reading', () => {
    test('the invoices due and the invoices another payment method can collect are raw queries', async () => {
        const client = fakeClient({ raw: [{ id: 'invoice-1' }, { id: 7 }] });
        const repo = new PrismaInvoiceCollectionRepository(client);

        assert.deepEqual(await repo.listDue('2026-02-15', { limit: 10 }), ['invoice-1']);
        assert.deepEqual(await repo.listCollectableAgain({ limit: 10, after: 'invoice-0' }), [
            'invoice-1',
        ]);

        const [due, again] = callsOf(client, '$queryRaw');
        assert.match(due[1], /NOT EXISTS/);
        assert.ok(due[2].includes('2026-02-15'));
        assert.match(again[1], /JOIN "subscriber_payment_methods" m/);
        assert.match(again[1], /max\(o\."attempt"\)/);
        assert.match(again[1], /c\."followedUpAt" IS NOT NULL/);
        assert.match(again[1], /m\."id" <> c\."paymentMethodId"/);
        assert.ok(again[2].includes('invoice-0'));
    });

    test('the failed attempts not followed up are listed by id', async () => {
        const client = fakeClient();

        await new PrismaInvoiceCollectionRepository(client).listToFollowUp({
            limit: 10,
            after: 'attempt-0',
        });

        const [[, listed]] = callsOf(client, 'findMany');
        assert.deepEqual(listed.where, {
            id: { gt: 'attempt-0' },
            status: 'FAILED',
            followedUpAt: null,
        });
    });

    test('the planned and the unsettled attempts are listed by id, page by page', async () => {
        const client = fakeClient();
        const repo = new PrismaInvoiceCollectionRepository(client);

        await repo.listPlanned({ limit: 10, after: 'attempt-0' });
        await repo.listUnsettled({ submittedBefore: AT, pendingBefore: AT }, { limit: 10 });

        const [[, planned], [, unsettled]] = callsOf(client, 'findMany');
        assert.deepEqual(planned.where, { id: { gt: 'attempt-0' }, status: 'SCHEDULED' });
        assert.deepEqual(unsettled.where.OR, [
            { status: 'SUBMITTED', heldAt: { lt: AT } },
            { status: 'PENDING', heldAt: { lt: AT } },
        ]);
    });

    test('an attempt, an invoice’s attempts and the accounts in use read back as records', async () => {
        const client = fakeClient();
        const repo = new PrismaInvoiceCollectionRepository(client);

        assert.equal((await repo.findById('attempt-1')).amount, 58.31);
        assert.deepEqual(
            (await repo.listByInvoice('invoice-1')).map((each) => each.attemptKey),
            ['saasicat:collect:invoice-1:1'],
        );
        await repo.accountsInUse();
        const accounts = callsOf(client, 'findMany').at(-1)[1];
        assert.deepEqual(accounts.where, { status: { in: ['SUBMITTED', 'PENDING'] } });
    });
});
