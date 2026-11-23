// `<app> installation status|mark`, as an operator runs it: to see whether the
// database belongs to the environment the command runs in, and to mark it as
// this environment's installation — the first time, and again with `--replace`
// after a backup was restored into another environment.
//
// The service deciding all of it is `@saasicat/nest`'s and is tested there;
// here it runs over the in-memory port the platform ships for tests, so that a
// test can tell what the command asked for before anything was written, what it
// printed, and which exit code a script sees.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { InstallationMarkService } from '@saasicat/nest';
import { FakeInstallationMarkRepository } from '@saasicat/nest/testing';

import {
    CliError,
    InstallationCliFlow,
    InstallationMarkCommand,
    InstallationStatusCommand,
} from '../dist/index.js';
import { cliErrorOf, printed, recordingContext } from './helpers/operator-cli.js';

const OPERATOR_TAG = 'cli:ops@example.com:deploy-host';
const EARLIER = new Date('2026-11-01T09:00:00Z');

/**
 * The flow over the platform's service, in an environment named `environment`,
 * on a database already marked as `standing` where one is given. Every write
 * to the store lands in `ctx.asked` beside what the command asked for, so the
 * order of the two can be read off one list.
 */
async function setUp({
    environment = 'prod',
    standing = null,
    testOperation = false,
    refuse = null,
} = {}) {
    const store = new FakeInstallationMarkRepository();
    if (standing) {
        await store.markIfUnmarked({
            identifier: standing,
            testOperation,
            markedAt: EARLIER,
            markedBy: 'cli:earlier@example.com:old-host',
        });
    }
    const ctx = recordingContext();
    const writes = {
        find: () => store.find(),
        async markIfUnmarked(mark) {
            ctx.asked.push(`write ${mark.identifier}`);
            return store.markIfUnmarked(mark);
        },
        async replace(current, mark) {
            ctx.asked.push(`replace ${current.identifier} with ${mark.identifier}`);
            return store.replace(current, mark);
        },
    };
    if (refuse) ctx[refuse] = refusing(ctx, refuse);
    const service = new InstallationMarkService(writes, environment, null);
    return { ctx, store, flow: new InstallationCliFlow(ctx, service) };
}

/** A step of the context that refuses, as a missing second factor or a declined confirmation does. */
function refusing(ctx, step) {
    return async () => {
        ctx.asked.push(`${step} refused`);
        throw new CliError('REFUSED', `${step} refused`, 1);
    };
}

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('installation mark', () => {
    test('asks for the second factor and the confirmation before it writes, and marks as the operator', async () => {
        const { flow, ctx, store } = await setUp();

        const outcome = await flow.mark('prod', { yes: true });

        assert.deepEqual(ctx.asked, [
            'identity',
            'super-admin',
            'second factor of user-ops',
            'confirmed with --yes',
            'write prod',
        ]);
        assert.equal(outcome.kind, 'marked');
        assert.deepEqual([outcome.mark.identifier, outcome.mark.markedBy], ['prod', OPERATOR_TAG]);
        assert.equal((await store.find()).identifier, 'prod');
        assert.deepEqual(ctx.logged, [], 'the service records the mark; the command adds nothing');
    });

    for (const step of ['requireMfa', 'ensureProductionConfirmation']) {
        test(`writes nothing where ${step} refuses`, async () => {
            const { flow, ctx, store } = await setUp({ refuse: step });

            const error = await cliErrorOf(() => flow.mark('prod', { yes: true }));

            assert.equal(error.code, 'REFUSED');
            assert.ok(!ctx.asked.some((asked) => asked.startsWith('write')), 'it wrote');
            assert.equal(await store.find(), null);
        });
    }

    test('refuses another installation’s mark without --replace, naming it, and replaces it with', async () => {
        const restored = await setUp({ environment: 'staging', standing: 'prod' });

        const error = await cliErrorOf(() => restored.flow.mark('staging', { yes: true }));
        assert.deepEqual(
            [error.code, error.exitCode],
            ['INSTALLATION_MARKED_OTHERWISE', 6],
            'a conflict, as every refusal of the platform that a script may branch on',
        );
        assert.match(error.message, /installation prod/);
        assert.equal((await restored.store.find()).identifier, 'prod');

        const outcome = await restored.flow.mark('staging', { yes: true, replace: true });
        assert.equal(outcome.kind, 'replaced');
        assert.deepEqual(restored.ctx.asked.slice(-3), [
            'second factor of user-ops',
            'confirmed with --yes',
            'replace prod with staging',
        ]);
        assert.equal((await restored.store.find()).identifier, 'staging');
    });

    test('refuses an identifier that is not this environment’s, and writes nothing', async () => {
        const { flow, ctx, store } = await setUp({ environment: 'prod' });

        const error = await cliErrorOf(() => flow.mark('staging', { yes: true, replace: true }));

        assert.deepEqual(
            [error.code, error.exitCode],
            ['INSTALLATION_IDENTIFIER_NOT_THIS_ENVIRONMENTS', 1],
        );
        assert.match(error.message, /staging .* \(prod\)/);
        assert.ok(!ctx.asked.some((asked) => /^(write|replace)/.test(asked)), 'it wrote');
        assert.equal(await store.find(), null);
    });

    test('prints what marking came to', async () => {
        const first = await setUp();
        const command = new InstallationMarkCommand(first.flow);

        const marked = await printed(command, { yes: true }, ['prod']);
        const again = await printed(command, { yes: true }, ['prod']);
        const restored = await setUp({ environment: 'staging', standing: 'prod' });
        const replaced = await printed(
            new InstallationMarkCommand(restored.flow),
            { yes: true, replace: true },
            ['staging'],
        );

        assert.equal(
            marked,
            'This database is marked as installation prod now, as a live operation.\n',
        );
        assert.match(
            again,
            /^This database was marked as installation prod already, as a live operation, on .* by cli:ops@example\.com:deploy-host; nothing was written\.\n$/,
        );
        assert.equal(
            replaced,
            'This database is marked as installation staging now, as a live operation, in place of the mark it carried.\n',
        );
    });
});

// @requirement SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own
describe('installation status', () => {
    test('says for each verdict what it means and what changes it, as text and as JSON', async () => {
        const unmarked = await setUp();
        const matches = await setUp({ standing: 'prod' });
        const differs = await setUp({ environment: 'staging', standing: 'prod' });

        const lines = [];
        for (const { flow } of [unmarked, matches, differs]) {
            lines.push(await printed(new InstallationStatusCommand(flow)));
        }
        const json = await printed(new InstallationStatusCommand(differs.flow), {
            output: 'json',
        });

        assert.deepEqual(lines, [
            'This database carries no installation mark, so nothing is deleted in it. ' +
                'Mark it as this environment’s with `<app> installation mark prod`. ' +
                'Without a mark it is a live operation.\n',
            'This database is marked as installation prod, the one this environment names. ' +
                'It is marked as a live operation.\n',
            'This database is marked as installation prod, but this environment names staging, ' +
                'so nothing is deleted in it. If a backup was restored into this environment, ' +
                'mark it again with `<app> installation mark staging --replace`. ' +
                'It is marked as a live operation.\n',
        ]);
        assert.deepEqual(JSON.parse(json), {
            kind: 'differs',
            expected: 'staging',
            marked: 'prod',
            operation: 'live',
        });
        assert.deepEqual(matches.ctx.asked, [], 'reading the mark asks for nobody');
    });
});

describe('installation mark --operation', () => {
    test('marks a new database as a test operation, and says so', async () => {
        const { flow, store } = await setUp({ environment: 'INT' });

        const said = await printed(
            new InstallationMarkCommand(flow),
            { yes: true, operation: 'test' },
            ['INT'],
        );

        assert.equal(
            said,
            'This database is marked as installation INT now, as a test operation.\n',
        );
        assert.equal((await store.find()).testOperation, true);
    });

    test('with --replace, replaces production’s mark and makes the copy a test operation', async () => {
        const { flow, ctx, store } = await setUp({ environment: 'INT', standing: 'PROD' });

        const outcome = await flow.mark('INT', { yes: true, replace: true, operation: 'test' });

        assert.equal(outcome.kind, 'replaced');
        assert.equal(ctx.asked.at(-1), 'replace PROD with INT');
        assert.deepEqual(
            [(await store.find()).identifier, (await store.find()).testOperation],
            ['INT', true],
        );
    });

    test('with --replace alone, keeps the operation the database has', async () => {
        const { flow, store } = await setUp({
            environment: 'INT',
            standing: 'OLD-INT',
            testOperation: true,
        });

        await flow.mark('INT', { yes: true, replace: true });

        assert.equal((await store.find()).testOperation, true);
    });

    test('changes the operation of this environment’s mark, and says from what', async () => {
        const { flow, store } = await setUp({ environment: 'INT', standing: 'INT' });

        const said = await printed(
            new InstallationMarkCommand(flow),
            { yes: true, operation: 'test' },
            ['INT'],
        );

        assert.equal(
            said,
            'This database, installation INT, is marked as a test operation now, in place of a live operation.\n',
        );
        assert.equal((await store.find()).testOperation, true);
    });

    test('refuses any other value before it asks for anybody, and writes nothing', async () => {
        const { flow, ctx, store } = await setUp({ environment: 'INT' });

        for (const operation of ['production', 'Test', '']) {
            const error = await cliErrorOf(() => flow.mark('INT', { yes: true, operation }));
            assert.deepEqual([error.code, error.exitCode], ['INSTALLATION_OPERATION_INVALID', 1]);
            assert.match(error.message, /--operation takes test or live/);
        }
        assert.deepEqual(ctx.asked, []);
        assert.equal(await store.find(), null);
    });

    test('the status names a test operation', async () => {
        const { flow } = await setUp({ environment: 'INT', standing: 'INT', testOperation: true });

        const said = await printed(new InstallationStatusCommand(flow));
        const json = await printed(new InstallationStatusCommand(flow), { output: 'json' });

        assert.equal(
            said,
            'This database is marked as installation INT, the one this environment names. ' +
                'It is marked as a test operation.\n',
        );
        assert.deepEqual(JSON.parse(json), {
            kind: 'matches',
            identifier: 'INT',
            operation: 'test',
        });
    });
});
