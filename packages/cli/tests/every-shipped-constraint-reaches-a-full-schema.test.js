// @requirement SC-OPS-017 — `schema migrate` carries every constraint whose tables exist, and names the rest

// `schema migrate` appends `constraints.postgres.sql` to the migration Prisma
// generated, minus the blocks whose tables the schema lacks. An integrator who
// takes every fragment has every table, so every block must arrive: a block
// left out there is a CHECK on money or a unique index on a payment
// confirmation that the database never gets, while the command reports
// success.
//
// The expectations are read from the shipped files themselves — the tables
// from the `CREATE TABLE` statements of the reference schema, the blocks from
// the constraints file — so a block or a table added later is covered without
// touching this test.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { readStatements, selectConstraints, tablesAddressedBy } from '../dist/index.js';

const require = createRequire(import.meta.url);
const SQL_DIR = join(dirname(require.resolve('@saasicat/spec')), 'sql');
const CONSTRAINTS = readFileSync(join(SQL_DIR, 'constraints.postgres.sql'), 'utf8');
const REFERENCE = readFileSync(join(SQL_DIR, 'reference-schema.postgres.sql'), 'utf8');

/** The tables the reference schema creates, from its `CREATE TABLE "<name>" (` lines. */
function referenceTables() {
    return [...REFERENCE.matchAll(/^CREATE TABLE "(\w+)" \(/gm)].map((match) => match[1]);
}

/** The blank-line separated blocks of the constraints file, as `schema migrate` reads them. */
function blocksOf(sql) {
    return sql
        .trimEnd()
        .split('\n\n')
        .filter((block) => block.trim() !== '');
}

/**
 * Whether a block names a table outside its comments — read independently of
 * the reader under test, so the two can disagree. The file writes its comments
 * as whole `--` lines, and the guard below holds it to that.
 */
function blockNamesTable(block, table) {
    const code = block
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');
    return code.split(/[^\w]+/).includes(table);
}

/** The names a block gives its constraints: the word after `CONSTRAINT` or `IF NOT EXISTS`. */
function constraintNamesIn(block) {
    const words = block
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .split(/[^\w]+/);
    const names = words.filter(
        (word, i) => i > 0 && ['CONSTRAINT', 'EXISTS'].includes(words[i - 1]) && word !== 'IF',
    );
    return [...new Set(names)];
}

const TABLES = referenceTables();
const BLOCKS = blocksOf(CONSTRAINTS);
const ADDRESSED = [...new Set(BLOCKS.flatMap((block) => tablesAddressedBy(block)))].sort();

describe('every shipped constraint reaches a schema with every table', () => {
    test('the sources are what this test reads them as', () => {
        // A guard over an empty list holds vacuously.
        assert.ok(TABLES.length > 50, `the reference schema creates ${TABLES.length} tables`);
        assert.ok(ADDRESSED.length > 10, `the constraints address ${ADDRESSED.length} tables`);
    });

    test('with every table of the reference schema, no block is left out', () => {
        const selection = selectConstraints(CONSTRAINTS, TABLES);
        assert.deepEqual(
            selection.leftOut,
            [],
            'left out although the schema has every table: ' +
                selection.leftOut.map((entry) => entry.constraints.join(', ')).join(' | '),
        );
        assert.equal(selection.applicable, CONSTRAINTS.trimEnd());
    });

    test('every statement of the shipped file has a shape the reader knows', () => {
        // "Unreadable, so kept" protects foreign input; for the platform's own
        // file it would hide a statement whose table nobody checks.
        const unreadable = readStatements(CONSTRAINTS).filter(
            (statement) => statement.shape === 'unreadable',
        );
        assert.deepEqual(
            unreadable.map((statement) => statement.text),
            [],
        );
    });

    test('every comment of the shipped file is a whole line', () => {
        // What `blockNamesTable` relies on to read the file independently.
        const trailing = CONSTRAINTS.split('\n').filter(
            (line) => !line.trimStart().startsWith('--') && line.includes('--'),
        );
        assert.deepEqual(trailing, []);
    });

    test('every block that addresses a table names its constraint', () => {
        // The name is what `schema migrate` prints for a block it leaves out.
        const unnamed = BLOCKS.filter(
            (block) =>
                tablesAddressedBy(block).length > 0 &&
                readStatements(block).every((statement) => statement.constraint === undefined),
        );
        assert.deepEqual(unnamed, []);
    });

    test('every table the file addresses is one the reference schema creates', () => {
        assert.deepEqual(
            ADDRESSED.filter((table) => !TABLES.includes(table)),
            [],
        );
    });

    test('the reader finds the tables the file names, and no others', () => {
        const named = TABLES.filter((table) =>
            BLOCKS.some((block) => blockNamesTable(block, table)),
        ).sort();
        assert.deepEqual(ADDRESSED, named);
    });

    for (const table of ADDRESSED) {
        test(`without ${table}, exactly the blocks naming it are left out`, () => {
            const selection = selectConstraints(
                CONSTRAINTS,
                TABLES.filter((name) => name !== table),
            );
            const naming = BLOCKS.filter((block) => blockNamesTable(block, table));
            assert.ok(naming.length > 0, `no block names ${table}`);

            assert.deepEqual(
                selection.leftOut.map((entry) => entry.missingTables),
                naming.map(() => [table]),
            );
            assert.deepEqual(
                selection.leftOut.map((entry) => entry.constraints),
                naming.map((block) => constraintNamesIn(block)),
            );
            assert.equal(
                selection.applicable,
                BLOCKS.filter((block) => !naming.includes(block)).join('\n\n'),
            );
        });
    }
});
