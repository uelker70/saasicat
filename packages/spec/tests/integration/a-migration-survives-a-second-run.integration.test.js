// Every SQL file this package ships is applied twice, and the second time has
// to be uneventful.
//
// project-key-history: the migration this was written for is named after the
// retired identifier, and the scan asserts it by name.
//
// The rule it holds: **a second run has a defined outcome.** Either it does
// nothing, or it refuses with a sentence naming why — never an unexplained SQL
// error, and never a second application of the same effect.
//
// This is not belt-and-braces here, it is the only belt. Prisma Migrate, Flyway
// and Liquibase each keep a ledger of what has run; this package ships loose
// `.sql` files that a consumer applies by hand or from an entrypoint, and
// nothing remembers. So the second run is all that stands between a retry and a
// stopped deployment — and deployments are retried, containers restart, and a
// failed pipeline step gets run again.
//
// It is written because that is exactly what happened. The 1.0 migration dropped
// a column and then, on the next container start, its own guard asked that
// column for its distinct values — of a table that no longer had it. The
// transaction aborted, `set -e` took the container down, and the message named
// a column rather than the retry. The first run was correct and tested; nobody
// had run it twice.
//
// The scope is derived, not listed: every `sql/*.sql` except the reference
// schema, which is the starting point rather than a step and is deliberately
// once-only (`CREATE TABLE` without `IF NOT EXISTS`). A file added to `sql/` is
// covered the day it lands.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sql');

/** The schema every consumer starts from — the ground, not a step on it. */
const GROUND = 'reference-schema.postgres.sql';

/**
 * The files this test is about.
 *
 * Read off the directory rather than written down: a list here would be the
 * same defect one level up, and the migration that is forgotten is the one
 * nobody added to it.
 */
function migrations() {
    return readdirSync(SQL_DIR)
        .filter((name) => name.endsWith('.sql') && name !== GROUND)
        .sort();
}

/** Columns and indexes, as one comparable string. */
async function fingerprint(client) {
    const columns = await client.query(
        `SELECT table_name, column_name, data_type, column_default
           FROM information_schema.columns
          WHERE table_schema = current_schema()
          ORDER BY table_name, column_name`,
    );
    const indexes = await client.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = current_schema() ORDER BY indexname`,
    );
    return JSON.stringify({ columns: columns.rows, indexes: indexes.rows });
}

const databaseUrl = process.env.SAASICAT_TEST_DATABASE_URL;
if (!databaseUrl) {
    throw new Error(
        'SAASICAT_TEST_DATABASE_URL is required for this test — point it at a disposable ' +
            'PostgreSQL database. It drops the `public` schema.',
    );
}

let client;

before(async () => {
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
});

after(async () => {
    await client?.end();
});

/** A database holding nothing but the shipped reference schema. */
async function freshGround() {
    // A migration that failed inside its own `BEGIN` leaves the connection in
    // an aborted transaction, and every later statement on it answers `current
    // transaction is aborted` — so one real failure would be followed by a row
    // of fake ones, and the file that actually broke would be the hardest to
    // pick out. Harmless when there is nothing to roll back.
    await client.query('ROLLBACK').catch(() => {});
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    // Whole, not split on `;`. A splitter would cut through the `DO $$ … $$`
    // block the constraints carry, and a hand-rolled SQL lexer is the last
    // thing this test needs — the driver runs a multi-statement script.
    await apply(GROUND);
}

/** Applies one file the way a consumer does: whole, in one go. */
async function apply(name) {
    await client.query(readFileSync(join(SQL_DIR, name), 'utf8'));
}

describe('a shipped migration survives a second run', () => {
    test('there are migrations to check', () => {
        // Every assertion below is vacuously true on an empty list, and the
        // whole point is that the set is read off the directory.
        const found = migrations();
        assert.ok(found.length > 0, 'no migration files found beside the reference schema');
        assert.ok(
            found.includes('1.0-remove-project-key.postgres.sql'),
            `the 1.0 migration is not in the scan: ${found.join(', ')}`,
        );
    });

    for (const name of migrations()) {
        test(`${name} runs twice, and the second time changes nothing`, async () => {
            await freshGround();

            await apply(name);
            const afterFirst = await fingerprint(client);

            // The second run is the subject. It may do nothing — that is the
            // ordinary case — but it must not raise, and it must not move the
            // schema it already moved.
            await apply(name);
            assert.equal(
                await fingerprint(client),
                afterFirst,
                'the second run changed the schema the first one settled',
            );
        });
    }
});
