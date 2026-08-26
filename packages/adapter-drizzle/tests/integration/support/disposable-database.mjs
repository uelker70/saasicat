// One place that opens a disposable PostgreSQL and rebuilds the canonical
// schema in it.
//
// Extracted because two integration files needed the same seventeen lines, and
// a schema bootstrap copied twice is worse than most duplication: the copies
// run in separate processes, each dropping and recreating `public`, and the one
// that loses the race sees its tables vanish mid-test. `--test-concurrency=1`
// is the other half of that fix; this is the half that stops the third copy
// from being written.
//
// Setup, not subject. The scenarios stay written out in full where a reader
// can see them.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

/** Statements from a `.sql` file, comments stripped, blanks dropped. */
function sqlStatements(file) {
    return readFileSync(file, 'utf8')
        .split(';')
        .map((statement) =>
            statement
                .split('\n')
                .filter((line) => !line.trim().startsWith('--'))
                .join('\n')
                .trim(),
        )
        .filter(Boolean);
}

/**
 * A pool and a Drizzle client against a database this call has just emptied.
 *
 * The DDL authority is `@saasicat/spec` — the schema is rebuilt from the
 * shipped reference file rather than from anything this package declares, which
 * is what makes a passing contract a statement about the canonical tables.
 *
 * Requires `SAASICAT_TEST_DATABASE_URL` pointing at a **disposable** database:
 * this drops the `public` schema.
 */
export async function openDisposableDatabase({ max = 10, rebuild = true } = {}) {
    const databaseUrl = process.env.SAASICAT_TEST_DATABASE_URL;
    if (!databaseUrl) {
        throw new Error(
            'SAASICAT_TEST_DATABASE_URL is required for the integration tests — point it at a ' +
                'disposable PostgreSQL database.',
        );
    }
    const require = createRequire(import.meta.url);
    const specRoot = dirname(require.resolve('@saasicat/spec/package.json'));

    const pool = new pg.Pool({ connectionString: databaseUrl, max });
    // `rebuild: false` opens a second connection onto a schema the caller has
    // already built — for a test that needs a narrower pool, not a fresh
    // database. Rebuilding there would drop the tables the surrounding file is
    // in the middle of using.
    if (rebuild) {
        await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
        await pool.query('CREATE SCHEMA public');
        for (const statement of sqlStatements(
            join(specRoot, 'sql', 'reference-schema.postgres.sql'),
        )) {
            await pool.query(statement);
        }
    }
    return { pool, db: drizzle(pool) };
}
