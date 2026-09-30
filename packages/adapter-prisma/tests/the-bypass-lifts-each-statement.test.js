// @requirement SC-COMP-019 — Under row-level security, the Prisma bundle lifts it for cross-tenant work

// What the extension sends for a statement, without a database. Prisma tells
// a query extension where a statement runs — on the client, in an interactive
// transaction by its id, or in a batch — and the fake below does the same.
// The integration suite proves the same rules against a forced policy; this
// proves them where no database runs.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaRlsBypass, PrismaTransactionRunner } from '../dist/index.js';

const SETTING = 'SELECT set_config(?, ?, true)';

/**
 * A client that records what reaches it. The base client sends as it is; the
 * client `$extends` returns, and every transaction opened on it, hand their
 * statements to the extension first, as Prisma's do.
 */
function recordingClient() {
    const sent = [];
    let hook = null;
    let transactions = 0;

    /** A statement as Prisma builds it: nothing runs until it is awaited. */
    const lazy = (run) => ({ then: (resolve, reject) => run().then(resolve, reject) });
    const record = (name, where) => async () => {
        sent.push(where ? `${name}@${where.kind}` : name);
        return `${name}:done`;
    };

    /** A statement on the extended client, or on a transaction of it. */
    const extendedOn = (where) => {
        const send = (name) =>
            lazy(() =>
                hook({
                    args: name,
                    query: () => lazy(record(name, where)),
                    __internalParams: where ? { transaction: where } : {},
                }),
            );
        return { statement: send, $executeRaw: (strings) => send(strings.join('?')) };
    };

    const client = {
        sent,
        $executeRaw: (strings) => lazy(record(strings.join('?'))),
        $extends(extension) {
            hook = extension.query.$allOperations;
            // A new client every time, as Prisma's is. `inBatch` builds the
            // statements a batch runs, which Prisma reports as the batch's.
            return Object.assign(Object.create(client), extendedOn(undefined), {
                inBatch: extendedOn({ kind: 'batch', id: 'batch-1' }),
            });
        },
        async $transaction(work) {
            if (typeof work === 'function') {
                transactions += 1;
                sent.push('begin');
                return work(extendedOn({ kind: 'itx', id: `tx-${transactions}` }));
            }
            sent.push('batch');
            return Promise.all(work);
        },
    };
    return client;
}

describe('a statement on the client', () => {
    test('runs as it is outside the bypass', async () => {
        const client = recordingClient();
        const lifted = new PrismaRlsBypass().extend(client);

        await lifted.statement('count');

        assert.deepEqual(client.sent, ['count']);
    });

    test('runs in one batch with the setting inside the bypass', async () => {
        const client = recordingClient();
        const rls = new PrismaRlsBypass();
        const lifted = rls.extend(client);

        const result = await rls.port.runWithBypass(() => lifted.statement('count'));

        assert.deepEqual(client.sent, ['batch', SETTING, 'count']);
        assert.equal(result, 'count:done');
    });

    test('is extended once per client, however often asked', () => {
        const client = recordingClient();
        const rls = new PrismaRlsBypass();

        assert.equal(rls.extend(client), rls.extend(client));
    });
});

describe('an interactive transaction on the lifted client', () => {
    /** Opens a transaction with `open` inside the bypass and runs one statement on it. */
    async function liftedThrough(open) {
        const client = recordingClient();
        const rls = new PrismaRlsBypass();
        const lifted = rls.extend(client);
        await rls.port.runWithBypass(() =>
            open(lifted)(async (tx) => {
                await tx.statement('update');
            }),
        );
        return client;
    }

    test("opened by the platform's runner inside the bypass takes the setting, and its statements run on it", async () => {
        const client = await liftedThrough(
            (lifted) => (work) => new PrismaTransactionRunner(lifted).run(work),
        );
        assert.deepEqual(client.sent, ['begin', `${SETTING}@itx`, 'update@itx']);
    });

    test('opened by a repository on its own inside the bypass takes the setting, and its statements run on it', async () => {
        const client = await liftedThrough((lifted) => (work) => lifted.$transaction(work));
        assert.deepEqual(client.sent, ['begin', `${SETTING}@itx`, 'update@itx']);
    });

    test('a statement on the client itself from inside it goes out in a batch of its own', async () => {
        const client = recordingClient();
        const rls = new PrismaRlsBypass();
        const lifted = rls.extend(client);

        await rls.port.runWithBypass(() =>
            lifted.$transaction(async () => {
                await lifted.statement('count');
            }),
        );

        assert.deepEqual(client.sent, ['begin', `${SETTING}@itx`, 'batch', SETTING, 'count']);
    });

    test('opened outside the bypass refuses a statement of it that enters the bypass', async () => {
        const client = recordingClient();
        const rls = new PrismaRlsBypass();
        const runner = new PrismaTransactionRunner(rls.extend(client));

        await assert.rejects(
            () => runner.run((tx) => rls.port.runWithBypass(() => tx.statement('update'))),
            /inside a transaction opened outside it/,
        );
        assert.deepEqual(client.sent, ['begin'], 'no setting, and the statement never ran');
    });
});

describe('a batch', () => {
    test('opened on the lifted client inside the bypass carries the setting at its head, and its statements run in it', async () => {
        const client = recordingClient();
        const rls = new PrismaRlsBypass();
        const lifted = rls.extend(client);

        const results = await rls.port.runWithBypass(() =>
            lifted.$transaction([lifted.inBatch.statement('a'), lifted.inBatch.statement('b')]),
        );

        assert.deepEqual(results, ['a:done', 'b:done']);
        assert.deepEqual(client.sent, ['batch', SETTING, 'a@batch', 'b@batch']);
    });

    test('opened on another client refuses a lifted statement inside the bypass', async () => {
        const client = recordingClient();
        const rls = new PrismaRlsBypass();
        const lifted = rls.extend(client);

        await assert.rejects(
            () =>
                rls.port.runWithBypass(() => client.$transaction([lifted.inBatch.statement('a')])),
            /batch opened on another client/,
        );
        assert.deepEqual(client.sent, ['batch'], 'no setting, and the statement never ran');
    });
});

describe('a client that does not say where a statement runs', () => {
    test('is refused inside the bypass rather than guessed at', async () => {
        const client = recordingClient();
        let hook;
        client.$extends = (extension) => {
            hook = extension.query.$allOperations;
            return Object.create(client);
        };
        const rls = new PrismaRlsBypass();
        rls.extend(client);

        await assert.rejects(
            () =>
                rls.port.runWithBypass(() =>
                    hook({ args: 'count', query: async () => 'count:done' }),
                ),
            /does not tell a query extension which transaction/,
        );
        assert.deepEqual(client.sent, [], 'nothing was sent');
    });
});
