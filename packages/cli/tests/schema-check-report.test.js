// @requirement SC-COMP-007 — A change that would otherwise be silent breaks the integrator's build instead

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../bin/saasicat.js', import.meta.url));

// What the report says, not what the check decided.
//
// The two are separate and used to disagree: a field was reported as missing
// while the block its type names was listed on the same screen as "not an
// error". Only one of those could be acted on. `checkSchema` no longer produces
// that pair for a model — but the printer builds its own list, so the agreement
// has to be read off the output rather than off the report object.
//
// A child process for that reason: the printing lives in `bin/saasicat.js`, and
// a unit test of `checkSchema` cannot see it.

let workspace;

before(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'saasicat-check-report-'));
});

after(async () => {
    await rm(workspace, { recursive: true, force: true });
});

/** Runs the check, and gives back its output whether it exits 0 or 1. */
async function check(schema, ...args) {
    const file = join(workspace, `${Math.random().toString(36).slice(2)}.prisma`);
    await writeFile(file, schema, 'utf8');
    try {
        const { stdout } = await run(process.execPath, [
            CLI,
            'schema',
            'check',
            `--prisma-schema=${file}`,
            ...args,
        ]);
        return { stdout, code: 0 };
    } catch (error) {
        return { stdout: error.stdout ?? '', code: error.code };
    }
}

async function fragment(name) {
    const require = createRequire(import.meta.url);
    const dir = join(dirname(require.resolve('@saasicat/spec')), 'prisma-fragments');
    return readFile(join(dir, name), 'utf8');
}

describe('the check never prints two answers to one question', () => {
    test('an enum a reported field names is not also listed as not adopted', async () => {
        // A consumer who took `PendingRegistration` and left its enum behind has
        // one thing to do — copy the enum — and the field says so. Listing the
        // enum as "not an error" beside it would say the opposite, on the screen
        // where the exit code is 1.
        const source = await fragment('09-pending-registration.prisma');
        const withoutEnum = source
            .replace(/enum RegistrationStatus \{[^}]*\}/, '')
            .split('\n')
            .filter((line) => !/\bRegistrationStatus\b/.test(line))
            .join('\n');

        const { stdout, code } = await check(withoutEnum, '--fragments=09');
        assert.equal(code, 1, stdout);
        assert.match(stdout, /PendingRegistration\.status/);
        assert.doesNotMatch(
            stdout,
            /Not adopted[^\n]*RegistrationStatus/,
            'the enum is reported as drift and as a decision in the same run',
        );
    });

    test('and a model nothing reported still is', async () => {
        // The other half: the line is not simply gone. A fragment left out whole
        // is a decision, and the run that says so exits 0.
        const { stdout, code } = await check(
            await fragment('13-subscriber.prisma'),
            '--fragments=13,14',
        );
        assert.equal(code, 0, stdout);
        assert.match(stdout, /Not adopted[^\n]*SubscriberPaymentMethod/);
        assert.match(stdout, /Not an error/);
    });
});
