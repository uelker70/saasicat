// @requirement SC-COMP-007 — A change that would otherwise be silent breaks the integrator's build instead

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
        assert.doesNotMatch(
            stdout,
            /notAdopted:/,
            'a model the persistence bundle cannot leave out is not offered as one it can',
        );
    });

    // @requirement SC-COMP-016 — What the schema check calls not adopted, the persistence bundle can be told
    test('a model the persistence bundle can leave out is handed over as the option to pass', async () => {
        const { stdout, code } = await check(
            await fragment('13-subscriber.prisma'),
            '--fragments=12,13',
        );
        assert.equal(code, 0, stdout);
        assert.match(stdout, /notAdopted: \['AppliedSettings', 'SettingsChange'\]/);
    });
});

/** Every shipped fragment, as one schema: what an application that adopted all of them carries. */
async function everyFragment() {
    const require = createRequire(import.meta.url);
    const dir = join(dirname(require.resolve('@saasicat/spec')), 'prisma-fragments');
    const files = (await readdir(dir)).filter((file) => file.endsWith('.prisma')).sort();
    const sources = await Promise.all(files.map((file) => readFile(join(dir, file), 'utf8')));
    return sources.join('\n');
}

/** `schema` with the `model` blocks of `models` taken out, as a schema that never adopted them. */
function without(schema, ...models) {
    const lines = schema.split('\n');
    const kept = [];
    let skipping = false;
    for (const line of lines) {
        if (!skipping && models.some((model) => line.startsWith(`model ${model} {`))) {
            skipping = true;
            continue;
        }
        if (skipping) {
            if (line.startsWith('}')) skipping = false;
            continue;
        }
        kept.push(line);
    }
    return kept.join('\n');
}

/** The lines of the section `heading` opens, up to the blank line that ends it. */
function section(stdout, heading) {
    const start = stdout.indexOf(heading);
    if (start === -1) return undefined;
    const end = stdout.indexOf('\n\n', start);
    return stdout.slice(start, end === -1 ? undefined : end);
}

/** The rule a needed model's line names, and the lines under it, trimmed. */
function entryOf(needed, model) {
    const lines = needed.split('\n');
    const at = lines.findIndex((line) => line.trim().split(/\s+/)[0] === model);
    assert.ok(at !== -1, `${model} is named`);
    const under = [];
    for (const line of lines.slice(at + 1)) {
        if (!line.startsWith(' '.repeat(33))) break;
        under.push(line.trim());
    }
    return [lines[at].trim().split(/\s+/)[1], ...under];
}

const SERVING_TENANTS = [
    'SubscriptionNotice',
    'TenantAccessHold',
    'SubscriptionEnd',
    'SubscriptionEndAnnouncement',
    'TenantExportDownload',
];

// @requirement SC-COMP-021 — The schema check names apart what an application serving tenants cannot run without
describe('the models a start serving tenants needs', () => {
    test('missing, are named apart with the rule that refuses the start, and not as a decision', async () => {
        const { stdout, code } = await check(without(await everyFragment(), ...SERVING_TENANTS));
        assert.equal(code, 0, stdout);

        const needed = section(stdout, 'Needed wherever tenantBilling is on (5):');
        assert.ok(needed, stdout);
        assert.match(needed, /SubscriptionNotice\s+subscription-notices\.requires-record/);
        assert.match(needed, /TenantAccessHold\s+tenant-access\.requires-holds-port/);
        assert.match(needed, /SubscriptionEnd\s+subscription-ends\.requires-store/);
        assert.match(needed, /SubscriptionEndAnnouncement\s+subscription-ends\.requires-store/);
        assert.match(needed, /TenantExportDownload\s+subscription-ends\.requires-store/);
        assert.match(needed, /--serves-tenants says tenantBilling is on and fails/);

        assert.equal(section(stdout, 'Not adopted'), undefined, 'none of them is "not an error"');
        // The one the bundle can leave out is offered only under the condition it holds in.
        assert.match(
            needed,
            /Where no option named for them is on, the bundle can leave out:\n\s+notAdopted: \['SubscriptionNotice'\]$/,
        );
    });

    test('missing, name beside tenantBilling every other option that needs them', async () => {
        const { stdout } = await check(without(await everyFragment(), ...SERVING_TENANTS));
        const needed = section(stdout, 'Needed wherever tenantBilling is on (5):');
        assert.deepEqual(entryOf(needed, 'TenantAccessHold'), [
            'tenant-access.requires-holds-port',
            'also wherever adminResources is on',
        ]);
        assert.ok(
            !entryOf(needed, 'SubscriptionNotice').some((line) => line.startsWith('also')),
            'tenant billing alone needs the notices',
        );
    });

    test('missing, name the option the start takes in their place, where it takes one', async () => {
        const { stdout } = await check(without(await everyFragment(), ...SERVING_TENANTS));
        const needed = section(stdout, 'Needed wherever tenantBilling is on (5):');
        assert.deepEqual(entryOf(needed, 'SubscriptionNotice'), [
            'subscription-notices.requires-record',
            'or your own through tenantBilling.notices.record',
        ]);
        assert.deepEqual(entryOf(needed, 'SubscriptionEnd'), [
            'subscription-ends.requires-store',
            'or your own through tenantBilling.subscriptionEnds.store',
        ]);
        assert.ok(
            !entryOf(needed, 'TenantAccessHold').some((line) => line.startsWith('or ')),
            'the holds have no option of their own',
        );
    });

    test('beside models the bundle can do without, are kept out of the line to pass on', async () => {
        const { stdout, code } = await check(
            without(
                await everyFragment(),
                ...SERVING_TENANTS,
                'VersionRetirement',
                'PromoCodeHold',
            ),
        );
        assert.equal(code, 0, stdout);

        const notAdopted = section(stdout, 'Not adopted (2): PromoCodeHold, VersionRetirement');
        assert.ok(notAdopted, stdout);
        assert.match(notAdopted, /Not an error/);
        assert.match(notAdopted, /notAdopted: \['PromoCodeHold', 'VersionRetirement'\]$/);
        const words = new Set(notAdopted.split(/[^A-Za-z]+/));
        for (const model of SERVING_TENANTS) assert.ok(!words.has(model), model);
    });

    test('all present, with only models the bundle can do without missing, have no section', async () => {
        const { stdout, code } = await check(
            without(await everyFragment(), 'VersionRetirement', 'PromoCodeHold'),
            '--serves-tenants',
        );
        assert.equal(code, 0, stdout);
        assert.equal(section(stdout, 'Needed'), undefined, stdout);
        assert.match(stdout, /Not adopted \(2\)/);
    });

    test('with everything adopted, neither section is printed', async () => {
        const { stdout, code } = await check(await everyFragment());
        assert.equal(code, 0, stdout);
        assert.equal(section(stdout, 'Needed'), undefined, stdout);
        assert.equal(section(stdout, 'Not adopted'), undefined, stdout);
        assert.match(stdout, /✓ No drift/);
    });
});

// @requirement SC-COMP-021 — The schema check names apart what an application serving tenants cannot run without
describe('--serves-tenants', () => {
    test('fails the check on a missing model a start serving tenants needs, naming it', async () => {
        const { stdout, code } = await check(
            without(await everyFragment(), 'TenantAccessHold'),
            '--serves-tenants',
        );
        assert.equal(code, 1, stdout);
        const needed = section(stdout, '✗ Needed to serve tenants (1):');
        assert.ok(needed, stdout);
        assert.match(needed, /TenantAccessHold\s+tenant-access\.requires-holds-port/);
        assert.doesNotMatch(needed, /notAdopted:/, 'the condition it offers is known not to hold');
        assert.match(stdout, /✗ Drift found[^\n]*\n {2}Add the models serving tenants needs/);
    });

    test('says it cannot see a record kept through the option a line names', async () => {
        const { stdout, code } = await check(
            without(await everyFragment(), 'SubscriptionNotice'),
            '--serves-tenants',
        );
        assert.equal(code, 1, stdout);
        const needed = section(stdout, '✗ Needed to serve tenants (1):');
        assert.match(needed, /or your own through tenantBilling\.notices\.record/);
        assert.match(
            needed,
            /unless you keep one through the option its line names: the\s+check reads only the schema, and fails on that one all the same/,
        );
    });

    test('without it, the same schema passes', async () => {
        const { stdout, code } = await check(without(await everyFragment(), 'TenantAccessHold'));
        assert.equal(code, 0, stdout);
        assert.match(stdout, /✓ No drift/);
    });

    test('with everything a start serving tenants needs, passes', async () => {
        const { stdout, code } = await check(await everyFragment(), '--serves-tenants');
        assert.equal(code, 0, stdout);
        assert.match(stdout, /✓ No drift/);
    });

    test('given a value, is refused rather than read as off', async () => {
        const { code } = await check(await everyFragment(), '--serves-tenants=yes');
        assert.equal(code, 1);
    });
});
