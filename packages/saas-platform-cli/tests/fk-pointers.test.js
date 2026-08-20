import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { assertModelsExist, enableFkPointers, findFkPointers } from '../dist/index.js';

// The platform tables carry `tenantId` and `userId`, and the `@relation` lines
// to the app's own models ship commented out — a fragment cannot know what they
// are called or whether they exist.
//
// Nothing fails without them, which is the problem: the columns are there, the
// queries work, and referential integrity is simply absent until somebody
// deletes a tenant. "Briefly review schema.prisma" was the instruction, and it
// is the kind that gets done once and forgotten on the upgrade.

const SCHEMA = `model AuditLog {
    id       String  @id
    tenantId String?
    userId   String?

    // Relations — the consumer must define \`Tenant\` and \`User\`.
    // tenant Tenant? @relation(fields: [tenantId], references: [id])
    // user   User?   @relation("AuditLogUser", fields: [userId], references: [id])
}

model Subscription {
    id       String @id
    tenantId String

    // tenant             Tenant                    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
}
`;

describe('finding them', () => {
    test('every commented relation to Tenant or User', () => {
        const found = findFkPointers(SCHEMA);
        assert.deepEqual(
            found.map((p) => p.target),
            ['Tenant', 'User', 'Tenant'],
        );
    });

    test('prose that merely mentions @relation is not one', () => {
        // `01-subscription.prisma` has a sentence about the convention.
        // Uncommenting it would put English into the schema and Prisma would
        // reject the file — a failure the consumer did not cause.
        const prose = '// The consumer adds the `@relation` with their own Tenant model.\n';
        assert.deepEqual(findFkPointers(prose), []);
    });

    test('a relation to something else is left alone', () => {
        // `SuperAdminUser` is a platform model, already present. Enabling it
        // here would point it at the app's user table.
        const other = '    // user SuperAdminUser @relation(fields: [userId], references: [id])\n';
        assert.deepEqual(findFkPointers(other), []);
    });
});

describe('enabling them', () => {
    test('both targets, renamed to the app models', () => {
        const result = enableFkPointers(SCHEMA, { tenant: 'Organization', user: 'Account' });
        assert.equal(result.enabled.length, 3);
        assert.equal(result.skipped.length, 0);
        assert.match(result.schema, /^ {4}tenant Organization\? @relation/m);
        assert.match(result.schema, /^ {4}user {3}Account\? {3}@relation\("AuditLogUser"/m);
        assert.doesNotMatch(result.schema, /\/\/ tenant/);
    });

    test('naming only the tenant leaves the user relations commented, and says so', () => {
        // A real configuration: not every app has a `User` the audit log should
        // point at. Half-wired referential integrity that looked finished would
        // be worse than none.
        const result = enableFkPointers(SCHEMA, { tenant: 'Organization' });
        assert.equal(result.enabled.length, 2);
        assert.deepEqual(
            result.skipped.map((p) => p.target),
            ['User'],
        );
        assert.match(result.schema, /\/\/ user {3}User\?/);
    });

    test('naming nothing changes nothing', () => {
        const result = enableFkPointers(SCHEMA, {});
        assert.equal(result.schema, SCHEMA);
        assert.equal(result.enabled.length, 0);
        assert.equal(result.skipped.length, 3);
    });

    test('the column alignment the fragment chose survives', () => {
        // Prisma's formatter would redo it; a consumer who does not run it
        // should still get a file they can read.
        const result = enableFkPointers(SCHEMA, { tenant: 'Tenant', user: 'User' });
        assert.match(result.schema, /^ {4}user {3}User\? {3}@relation/m);
    });

    test('running it twice is a no-op — there is nothing left to uncomment', () => {
        const once = enableFkPointers(SCHEMA, { tenant: 'Tenant', user: 'User' }).schema;
        const twice = enableFkPointers(once, { tenant: 'Tenant', user: 'User' });
        assert.equal(twice.schema, once);
        assert.equal(twice.enabled.length, 0);
    });
});

/** The error `fn` threw. `assert.throws` returns nothing, so it cannot be used. */
function thrownBy(fn) {
    try {
        fn();
    } catch (err) {
        return err;
    }
    assert.fail('expected a throw, got none');
}

describe('refusing a model that does not exist', () => {
    test('and listing what the schema does declare', () => {
        const error = thrownBy(() =>
            assertModelsExist(['Tenant', 'User', 'Note'], { tenant: 'Organisation' }),
        );
        assert.match(error.message, /--tenant-model=Organisation/);
        assert.match(error.message, /It declares: Note, Tenant, User/);
    });

    test('a name that does exist passes', () => {
        assert.doesNotThrow(() =>
            assertModelsExist(['Tenant', 'User'], { tenant: 'Tenant', user: 'User' }),
        );
    });

    test('naming nothing passes', () => {
        assert.doesNotThrow(() => assertModelsExist([], {}));
    });
});

describe('against the fragments as shipped', () => {
    test('every commented FK pointer in them is one this recognises', async () => {
        // The pattern is written here and the lines are written there. Two
        // hand-maintained halves of one decision drift, and the way this one
        // would drift is silent: a fragment gains a pointer, the pattern does
        // not match it, and it stays commented while the command reports
        // success.
        const require = createRequire(import.meta.url);
        const fragmentsDir = join(dirname(require.resolve('@saasicat/spec')), 'prisma-fragments');
        const files = (await readdir(fragmentsDir)).filter((f) => f.endsWith('.prisma'));

        let recognised = 0;
        for (const file of files) {
            const content = await readFile(join(fragmentsDir, file), 'utf8');
            recognised += findFkPointers(content).length;

            // Any commented line that declares a field of type Tenant/User is
            // a pointer, whatever its spacing — matched loosely here, strictly
            // in the implementation, so a mismatch shows up as a count.
            const loose = content
                .split('\n')
                .filter((line) => /^\s*\/\/\s*\w+\s+(Tenant|User)\??\s+@relation/.test(line));
            assert.equal(
                findFkPointers(content).length,
                loose.length,
                `${file}: the strict pattern missed a pointer the loose one found`,
            );
        }
        assert.ok(recognised >= 5, `only ${recognised} pointers found across the fragments`);
    });
});
