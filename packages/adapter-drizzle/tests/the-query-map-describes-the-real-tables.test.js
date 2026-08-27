import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The query map describes tables it does not own.
//
// `schema.ts` says so in its own header: the DDL authority is
// `@saasicat/spec/sql/reference-schema.postgres.sql`, and these definitions only
// describe the existing tables for the query builder. Nothing enforced it. A
// column invented here compiles, passes the type checker, and fails at runtime
// against a real database — or worse, quietly reads NULL where a column with a
// different name holds the value.
//
// It happened while adding the contract tables: seven columns were written from
// memory, and every one of them was wrong. This is the comparison that found it,
// kept as a test rather than as a thing somebody remembers to run.

const require = createRequire(import.meta.url);
const specRoot = dirname(require.resolve('@saasicat/spec/package.json'));
const ddl = readFileSync(join(specRoot, 'sql', 'reference-schema.postgres.sql'), 'utf8');
const schema = readFileSync(fileURLToPath(new URL('../src/schema.ts', import.meta.url)), 'utf8');

/** Column names of one `CREATE TABLE`, taken from the normative DDL. */
function canonicalColumns(table) {
    const start = ddl.indexOf(`CREATE TABLE "${table}" (`);
    assert.notEqual(start, -1, `${table} is not in the reference schema`);
    const end = ddl.indexOf('\n);', start);
    const body = ddl.slice(start, end);
    // `"name" TYPE …` at the start of a line — constraints and indexes do not
    // match, which is what keeps this from counting them as columns.
    return new Set([...body.matchAll(/^[ \t]+"(\w+)"[ \t]+[A-Z"]/gm)].map((m) => m[1]));
}

/** Column names one `pgTable(…)` declares, by the string it maps to. */
function declaredColumns(table) {
    const start = schema.indexOf(`pgTable('${table}', {`);
    assert.notEqual(start, -1, `${table} is not in the query map`);
    const end = schema.indexOf('\n});', start);
    const body = schema.slice(start, end);
    return new Set([...body.matchAll(/^[ \t]+\w+: \w+\('(\w+)'/gm)].map((m) => m[1]));
}

/** Every table the query map declares, in the order it declares them. */
const tables = [...schema.matchAll(/pgTable\('(\w+)'/g)].map((m) => m[1]);

describe('every table in the query map', () => {
    test('there is more than one, so a broken scan cannot pass by finding none', () => {
        assert.ok(tables.length > 10, `found only ${tables.length} tables`);
    });

    for (const table of tables) {
        test(`${table} declares exactly the canonical columns`, () => {
            const canonical = canonicalColumns(table);
            const declared = declaredColumns(table);

            const invented = [...declared].filter((name) => !canonical.has(name));
            assert.deepEqual(
                invented,
                [],
                `${table} declares ${invented.join(', ')}, which the reference schema does not have`,
            );

            const missing = [...canonical].filter((name) => !declared.has(name));
            assert.deepEqual(
                missing,
                [],
                `${table} omits ${missing.join(', ')} — a column this file omits is one the ` +
                    'repositories cannot return',
            );
        });
    }
});
