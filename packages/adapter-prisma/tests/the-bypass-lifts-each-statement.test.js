// @requirement SC-COMP-019 — Under row-level security, the Prisma bundle lifts it for cross-tenant work

// What the extension sends for a statement, without a database: the setting
// and the statement in one batch inside the bypass, the statement alone
// outside it, nothing extra inside a transaction the runner lifted, and a
// refusal inside one it did not. The integration suite proves the same
// against a forced policy; this proves it where no database runs.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaRlsBypass, PrismaTransactionRunner } from '../dist/index.js';

/** A client that records what reaches it, and hands the extension its hook. */
function recordingClient() {
    const sent = [];
    const raw = [];
    const client = {
        sent,
        raw,
        hook: null,
        $extends(extension) {
            client.hook = extension.query.$allOperations;
            // A new client every time, as Prisma's is.
            return Object.create(client);
        },
        $executeRaw(strings, ...values) {
            raw.push(strings.join('?'));
            return { sql: strings.join('?'), values };
        },
        async $transaction(work) {
            if (typeof work === 'function') {
                sent.push('begin');
                return work(client);
            }
            sent.push(['batch', ...work.map((statement) => statement.sql ?? statement)]);
            return work.map((statement) => statement.result ?? statement);
        },
    };
    return client;
}

/** A statement the way Prisma hands it to the extension. */
function statementOn(client, name) {
    return client.hook({
        args: name,
        query: (args) => {
            client.sent.push(args);
            return { sql: args, result: `${args}:done` };
        },
    });
}

describe('each statement', () => {
    test('runs as it is outside the bypass', async () => {
        const client = recordingClient();
        new PrismaRlsBypass().extend(client);

        await statementOn(client, 'count');

        assert.deepEqual(client.sent, ['count']);
    });

    test('runs in one batch with the setting inside the bypass', async () => {
        const client = recordingClient();
        const rls = new PrismaRlsBypass('app.other');
        rls.extend(client);

        const result = await rls.port.runWithBypass(() => statementOn(client, 'count'));

        const [batch] = client.sent.filter(Array.isArray);
        assert.deepEqual(batch, ['batch', 'SELECT set_config(?, ?, true)', 'count']);
        assert.equal(result, 'count:done');
    });

    test('is extended once per client, however often asked', () => {
        const client = recordingClient();
        const rls = new PrismaRlsBypass();

        assert.equal(rls.extend(client), rls.extend(client));
    });
});

describe('an interactive transaction on the lifted client', () => {
    /** Opens a transaction with `open` inside the bypass and runs one statement in it. */
    async function liftedThrough(open) {
        const client = recordingClient();
        const rls = new PrismaRlsBypass();
        const lifted = rls.extend(client);
        await rls.port.runWithBypass(() =>
            open(lifted)(async () => {
                await statementOn(client, 'update');
            }),
        );
        return client;
    }

    /** The setting first, then the statement as it is: no batch of its own inside the transaction. */
    function assertLiftedOnce(client) {
        assert.equal(client.sent[0], 'begin');
        assert.deepEqual(client.raw, ['SELECT set_config(?, ?, true)']);
        assert.equal(client.sent.filter(Array.isArray).length, 0, 'no batch inside it');
        assert.ok(client.sent.includes('update'));
    }

    test("opened by the platform's runner inside the bypass is lifted for its length", async () => {
        const client = await liftedThrough(
            (lifted) => (work) => new PrismaTransactionRunner(lifted).run(work),
        );
        assertLiftedOnce(client);
    });

    test('opened by a repository on its own inside the bypass is lifted for its length', async () => {
        const client = await liftedThrough((lifted) => (work) => lifted.$transaction(work));
        assertLiftedOnce(client);
    });

    test('opened outside the bypass refuses a statement that enters it', async () => {
        const client = recordingClient();
        const rls = new PrismaRlsBypass();
        const runner = new PrismaTransactionRunner(rls.extend(client));

        await assert.rejects(
            () => runner.run(() => rls.port.runWithBypass(() => statementOn(client, 'update'))),
            /inside a transaction opened outside it/,
        );
        assert.deepEqual(client.raw, [], 'no setting was made');
        assert.ok(!client.sent.includes('update'), 'the statement never ran');
    });
});
