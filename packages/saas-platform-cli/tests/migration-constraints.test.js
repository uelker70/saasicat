import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CONSTRAINTS_MARKER,
    appendConstraints,
    hasConstraints,
    newestMigration,
} from '../dist/index.js';

// `schema migrate` used to stop one step short: it wrote the models and ran
// `prisma migrate dev`, and then the quickstart asked the reader to paste
// `constraints.postgres.sql` into the migration Prisma had just generated.
//
// Those statements are not hardening. The adapter contract tests run against a
// database that has them, so an app without them passes its own tests and
// fails the invariant — two drafts on one plan lineage, which nothing else
// rejects.

const MIGRATION = 'CREATE TABLE "plan_versions" ();\n';
const CONSTRAINTS =
    'CREATE UNIQUE INDEX IF NOT EXISTS plan_versions_draft_per_plan\n' +
    '    ON plan_versions ("planId") WHERE "publishedAt" IS NULL;\n';

describe('which migration the constraints belong to', () => {
    test('the newest one — the same order Prisma applies in', () => {
        assert.equal(
            newestMigration([
                '20260101120000_init',
                '20260820090000_add_saasicat',
                '20260501000000_middle',
            ]),
            '20260820090000_add_saasicat',
        );
    });

    test('directories that are not migrations are not candidates', () => {
        // `migration_lock.toml` sits in the same directory, and a stray folder
        // sorting after every timestamp would otherwise win.
        assert.equal(
            newestMigration(['migration_lock.toml', 'zzz-scratch', '20260101120000_init']),
            '20260101120000_init',
        );
    });

    test('no migrations at all is not an error, it is nothing to do', () => {
        assert.equal(newestMigration([]), null);
        assert.equal(newestMigration(['migration_lock.toml']), null);
    });
});

describe('appending them', () => {
    test('the statements land after the tables', () => {
        const result = appendConstraints(MIGRATION, CONSTRAINTS);
        assert.ok(
            result.indexOf('CREATE TABLE') < result.indexOf('CREATE UNIQUE INDEX'),
            'a partial index on a table that does not exist yet fails the migration',
        );
    });

    test('it says where the copy came from', () => {
        // Whoever reads this file next has to know the spec is the source, or
        // the copy becomes the thing that gets edited.
        const result = appendConstraints(MIGRATION, CONSTRAINTS);
        assert.match(result, /@saasicat\/spec\/sql\/constraints\.postgres\.sql/);
        assert.match(result, /Edit the spec, not this copy/);
    });

    test('running it twice appends once', () => {
        const once = appendConstraints(MIGRATION, CONSTRAINTS);
        assert.equal(appendConstraints(once, CONSTRAINTS), once);
        assert.equal(once.split(CONSTRAINTS_MARKER).length - 1, 1);
    });

    test('a migration that already has them is recognised', () => {
        assert.equal(hasConstraints(MIGRATION), false);
        assert.equal(hasConstraints(appendConstraints(MIGRATION, CONSTRAINTS)), true);
    });

    test('a migration without a trailing newline still gets a separating one', () => {
        const result = appendConstraints('CREATE TABLE "x" ();', CONSTRAINTS);
        assert.match(result, /\(\);\n\n-- saasicat:constraints/);
    });
});
