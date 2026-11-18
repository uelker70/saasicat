// @requirement SC-OPS-002 — A migration is safe on a partially adopted schema
// @requirement SC-COMP-011 — Every data-access implementation is held to the same executable contract

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CONSTRAINTS_MARKER,
    reportConstraints,
    appendConstraints,
    hasConstraints,
    migrationCreatedBy,
    readStatements,
    selectConstraints,
    tablesAddressedBy,
} from '../dist/index.js';

// `schema migrate` used to stop one step short: it wrote the models and ran
// `prisma migrate dev`, and then the quickstart asked the reader to paste
// `constraints.postgres.sql` into the migration Prisma had just generated.
//
// The first attempt at automating it appended AFTER a plain `migrate dev`,
// which does two wrong things at once: the constraints never reach the database
// that was just migrated, and the next `migrate dev` finds a migration whose
// recorded checksum no longer matches and offers a reset. The command uses
// `--create-only` now — write the file, append, then apply.
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
    // The one THIS run created. Asking which sorts last gives the same answer
    // whenever a run created one — and a silently wrong one when it did not,
    // because the step would then edit somebody else's already-applied
    // migration and break its checksum.

    test('the one that appeared between the two listings', () => {
        assert.equal(
            migrationCreatedBy(
                ['20260101120000_init', '20260501000000_middle'],
                ['20260101120000_init', '20260501000000_middle', '20260820090000_add_saasicat'],
            ),
            '20260820090000_add_saasicat',
        );
    });

    test('nothing new means nothing to append to, even with migrations present', () => {
        // The case the sort-based version got wrong: Prisma created no
        // migration because the schema had not changed, and the last one
        // belongs to a previous run.
        assert.equal(migrationCreatedBy(['20260101120000_init'], ['20260101120000_init']), null);
    });

    test('directories that are not migrations are not candidates', () => {
        // `migration_lock.toml` sits in the same directory, and a stray folder
        // sorting after every timestamp would otherwise win.
        assert.equal(migrationCreatedBy([], ['migration_lock.toml', 'zzz-scratch']), null);
    });

    test('the newest of several, when a run somehow produced two', () => {
        assert.equal(
            migrationCreatedBy([], ['20260101120000_a', '20260820090000_b']),
            '20260820090000_b',
        );
    });

    test('no migrations at all is not an error, it is nothing to do', () => {
        assert.equal(migrationCreatedBy([], []), null);
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

describe('only the constraints this schema has tables for', () => {
    // Found by running the command, not by reasoning about it:
    // `schema migrate --fragments=03` produces a migration with the
    // plan-version tables and nothing else, and appending the whole file added
    // an index on `bundle_versions`. Prisma then failed the entire migration
    // against its shadow database with P1014, naming a table the consumer never
    // asked for.

    const BOTH =
        'CREATE UNIQUE INDEX IF NOT EXISTS plan_versions_draft_per_plan\n' +
        '    ON plan_versions ("planId") WHERE "publishedAt" IS NULL;\n\n' +
        'CREATE UNIQUE INDEX IF NOT EXISTS bundle_versions_draft_per_bundle\n' +
        '    ON bundle_versions ("bundleId") WHERE "publishedAt" IS NULL;\n';

    test('reads the table off each statement', () => {
        assert.deepEqual(tablesAddressedBy('CREATE INDEX x ON plan_versions ("a");'), [
            'plan_versions',
        ]);
        assert.deepEqual(tablesAddressedBy('ALTER TABLE "subscriptions" ADD CONSTRAINT c CHECK;'), [
            'subscriptions',
        ]);
    });

    test('keeps the ones whose table is present', () => {
        const kept = selectConstraints(BOTH, ['plan_versions']).applicable;
        assert.match(kept, /plan_versions_draft_per_plan/);
        assert.doesNotMatch(kept, /bundle_versions/);
    });

    test('keeps everything when every table is present', () => {
        const selection = selectConstraints(BOTH, ['plan_versions', 'bundle_versions']);
        assert.match(selection.applicable, /plan_versions_draft_per_plan/);
        assert.match(selection.applicable, /bundle_versions_draft_per_bundle/);
        assert.deepEqual(selection.leftOut, []);
    });

    test('a statement it cannot read is kept, not dropped', () => {
        // An unrecognised shape is a reason to be conservative: dropping a
        // constraint silently is the one outcome worse than a failed migration.
        const odd = 'DO $$ BEGIN /* something clever */ END $$;';
        assert.equal(selectConstraints(odd, []).applicable, odd);
        assert.ok(readStatements(odd).every((statement) => statement.shape === 'unreadable'));
    });

    test('nothing applicable appends nothing at all', () => {
        const nothing = selectConstraints(BOTH, ['unrelated']).applicable;
        assert.equal(nothing, '');
        assert.equal(appendConstraints(MIGRATION, nothing), MIGRATION);
    });
});

// @requirement SC-OPS-017 — `schema migrate` carries every constraint whose tables exist, and names the rest
describe('the table is read from the statement, not from the words around it', () => {
    // The shipped file explains its blocks in comments that say "on purpose"
    // and "ON CONFLICT", and its CHECKs list values. A word read there as a
    // table is one no schema has, so its block would be left out of every
    // migration — among the shipped blocks, the checks on corrections of
    // charges and invoice lines.

    const SINGLETON =
        '-- Two plain statements on purpose, and ON CONFLICT names no table either.\n' +
        'ALTER TABLE marketing_settings\n' +
        '    DROP CONSTRAINT IF EXISTS marketing_settings_is_a_singleton;\n' +
        'ALTER TABLE marketing_settings\n' +
        '    ADD CONSTRAINT marketing_settings_is_a_singleton CHECK ("id" = \'marketing-settings\');';

    test('a word after "on" in a comment is not a table', () => {
        assert.deepEqual(tablesAddressedBy(SINGLETON), [
            'marketing_settings',
            'marketing_settings',
        ]);
        assert.equal(selectConstraints(SINGLETON, ['marketing_settings']).applicable, SINGLETON);
    });

    test('the block keeps its comments when it is kept', () => {
        assert.match(selectConstraints(SINGLETON, ['marketing_settings']).applicable, /on purpose/);
    });

    test('"on" inside a CHECK is not a table', () => {
        const check =
            "ALTER TABLE notes ADD CONSTRAINT notes_kind CHECK (\"kind\" IN ('on', 'off'));";
        assert.deepEqual(tablesAddressedBy(check), ['notes']);
    });

    test('a quoted table, written against its column list, is read', () => {
        const index =
            'CREATE UNIQUE INDEX IF NOT EXISTS once ON "PaymentEventLog"("sessionId") WHERE true;';
        assert.deepEqual(readStatements(index), [
            {
                shape: 'create-index',
                table: 'PaymentEventLog',
                constraint: 'once',
                text: index.slice(0, -1),
            },
        ]);
    });

    test('an index without a name, on ONLY a schema-qualified table, is read', () => {
        assert.deepEqual(tablesAddressedBy('CREATE INDEX ON ONLY public.notes (a);'), ['notes']);
    });

    test('ALTER TABLE IF EXISTS ONLY reads the table after the keywords', () => {
        const statement = 'alter table if exists only notes drop constraint if exists notes_kind;';
        assert.deepEqual(
            readStatements(statement).map((s) => [s.table, s.constraint]),
            [['notes', 'notes_kind']],
        );
    });

    test('a sequence and a setval address no table, so nothing leaves them out', () => {
        const sequence =
            'ALTER SEQUENCE IF EXISTS "s_seq" START WITH 10001;\n' +
            "SELECT setval('s_seq', 10001, false) FROM pg_sequences WHERE true;";
        assert.deepEqual(
            readStatements(sequence).map((statement) => statement.shape),
            ['addresses-no-table', 'addresses-no-table'],
        );
        assert.equal(selectConstraints(sequence, []).applicable, sequence);
    });

    test('a separator inside a string or a quoted name does not end the statement', () => {
        const check =
            'ALTER TABLE notes ADD CONSTRAINT "a;b" CHECK ("body" <> \';\' AND "x" <> \'it\'\'s;\');';
        assert.deepEqual(
            readStatements(check).map((s) => [s.shape, s.constraint]),
            [['alter-table', 'a;b']],
        );
    });

    test('a separator in a comment does not end the statement', () => {
        const index = 'CREATE INDEX i -- one; two\n    ON notes (a);';
        assert.deepEqual(tablesAddressedBy(index), ['notes']);
        assert.deepEqual(
            tablesAddressedBy('/* ON purpose; */ ALTER TABLE notes ADD COLUMN x int;'),
            ['notes'],
        );
    });
});

// @requirement SC-OPS-017 — `schema migrate` carries every constraint whose tables exist, and names the rest
describe('what is left out is named', () => {
    // Silence has to mean "all of it went in", and a scoped run has to say
    // which constraints its schema cannot take.

    const TWO =
        'CREATE UNIQUE INDEX IF NOT EXISTS plan_versions_draft_per_plan\n' +
        '    ON plan_versions ("planId") WHERE "publishedAt" IS NULL;\n\n' +
        '-- A pair on a join table.\n' +
        'ALTER TABLE links DROP CONSTRAINT IF EXISTS links_not_into_itself;\n' +
        'ALTER TABLE links ADD CONSTRAINT links_not_into_itself CHECK ("a" <> "b");';

    test('each left-out block with its constraint and the table the schema lacks', () => {
        assert.deepEqual(selectConstraints(TWO, ['plan_versions']).leftOut, [
            { constraints: ['links_not_into_itself'], missingTables: ['links'] },
        ]);
    });

    test('only the tables that are missing, not every table the block addresses', () => {
        const across = 'CREATE INDEX i ON a (x);\nCREATE INDEX j ON b (x);';
        assert.deepEqual(selectConstraints(across, ['a']).leftOut, [
            { constraints: ['i', 'j'], missingTables: ['b'] },
        ]);
    });

    test('the report says one line for each, and nothing when none is left out', () => {
        const { leftOut } = selectConstraints(TWO, ['plan_versions']);
        const report = reportConstraints('appended', {
            sqlPath: '/pkg/sql/constraints.postgres.sql',
            migration: '20260820_x',
            leftOut,
        });
        assert.deepEqual(report.leftOut, [
            '  - left out links_not_into_itself: this schema has no table links',
        ]);
        assert.deepEqual(
            reportConstraints('appended', { sqlPath: '/x', migration: '20260820_x' }).leftOut,
            [],
        );
    });

    test('a block without a name is still named by its tables', () => {
        const leftOut = selectConstraints('ALTER TABLE a ADD COLUMN x int;', []).leftOut;
        const report = reportConstraints('not-applicable', { sqlPath: '/x', leftOut });
        assert.deepEqual(report.leftOut, ['  - left out a statement: this schema has no table a']);
    });

    test('several missing tables are named together', () => {
        const leftOut = selectConstraints(
            'CREATE INDEX i ON a (x);\nCREATE INDEX j ON b (x);',
            [],
        ).leftOut;
        const report = reportConstraints('not-applicable', { sqlPath: '/x', leftOut });
        assert.deepEqual(report.leftOut, ['  - left out i, j: this schema has no tables a, b']);
    });
});

describe('what step 3 did, and whether step 4 may follow', () => {
    // This was a boolean, and the boolean conflated "nothing to append" with
    // "appending failed". On the second the command printed "add the SQL by
    // hand, before applying it" — and then applied it three lines later. The
    // advice named a window the caller had already closed, and the migration
    // went under a recorded checksum, where editing it offers a reset.

    const OUTCOMES = ['appended', 'already-present', 'not-applicable', 'no-migration', 'failed'];
    const CONTEXT = { sqlPath: '/pkg/sql/constraints.postgres.sql', migration: '20260820_x' };

    test('only a failure stops the command', () => {
        const stops = OUTCOMES.filter((o) => !reportConstraints(o, CONTEXT).mayApply);
        assert.deepEqual(stops, ['failed']);
    });

    test('"before applying" is said exactly when the command will not apply', () => {
        // The invariant that broke, asserted as an equality rather than as a
        // list of expected strings: a message may promise that window only
        // while the caller still leaves it open.
        for (const outcome of OUTCOMES) {
            const report = reportConstraints(outcome, CONTEXT);
            assert.equal(
                /before applying/.test(report.message),
                !report.mayApply,
                `${outcome}: message and decision disagree — "${report.message}"`,
            );
        }
    });

    test('a failure says where the SQL is, because the operator now needs it', () => {
        const report = reportConstraints('failed', CONTEXT);
        assert.match(report.message, /constraints\.postgres\.sql/);
        assert.match(report.message, /nothing was applied/);
    });

    test('nothing to append is not a failure', () => {
        // Prisma creating no migration means the schema was already in sync.
        // Treating that as an error would fail a correct re-run.
        assert.equal(reportConstraints('no-migration', CONTEXT).mayApply, true);
    });

    test('every outcome carries a message and a decision', () => {
        for (const outcome of OUTCOMES) {
            const report = reportConstraints(outcome, CONTEXT);
            assert.equal(report.outcome, outcome);
            assert.equal(typeof report.mayApply, 'boolean');
            assert.ok(report.message.trim().length > 0, `${outcome} says nothing`);
        }
    });
});
