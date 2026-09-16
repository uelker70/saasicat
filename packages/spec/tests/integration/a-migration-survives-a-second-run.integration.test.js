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

// @requirement SC-OPS-002 — A migration is safe on a partially adopted schema
// @requirement SC-OPS-003 — An operator can list what a migration will touch before running it

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

describe('a shipped migration leaves an installation without its tables alone', () => {
    // A fresh installation applies every file before `db push` has created a
    // table — the notesapp entrypoint does exactly that, under `set -e` — and an
    // application that never adopted a fragment applies them too. Either way a
    // file whose tables are missing has nothing to migrate, and saying so is
    // the only defined outcome: an error stops the container on its first start.

    // The constraints are the exception, and by design: they are applied after
    // `db push`, to the tables it created, and a constraint on a table that is
    // not there has nothing to hold.
    const beforeTheTables = migrations().filter((name) => name !== 'constraints.postgres.sql');

    for (const name of beforeTheTables) {
        test(`${name} runs on a database with none of the platform tables, twice`, async () => {
            await client.query('ROLLBACK').catch(() => {});
            await client.query('DROP SCHEMA IF EXISTS public CASCADE');
            await client.query('CREATE SCHEMA public');

            await apply(name);
            await apply(name);
        });
    }
});

describe('a table a migration creates has the shape the fragments declare', () => {
    // A fresh installation applies every file in name order before `db push`,
    // and a file that creates a table creates it for good: `CREATE TABLE IF NOT
    // EXISTS` never revisits it. A table created in an older shape than the
    // fragments declare is then left to `db push` to finish — which refuses a
    // unique index on a table it cannot see is empty, and stops the container.

    /** Columns and indexes per table, as comparable strings. */
    async function shapes() {
        const columns = await client.query(
            `SELECT table_name, column_name, data_type, is_nullable, column_default
               FROM information_schema.columns
              WHERE table_schema = current_schema()
              ORDER BY table_name, column_name`,
        );
        const indexes = await client.query(
            `SELECT tablename, indexname, indexdef FROM pg_indexes
              WHERE schemaname = current_schema() ORDER BY tablename, indexname`,
        );
        const byTable = new Map();
        const entry = (table) => {
            if (!byTable.has(table)) byTable.set(table, { columns: [], indexes: [] });
            return byTable.get(table);
        };
        for (const row of columns.rows) {
            const { table_name: table, ...column } = row;
            entry(table).columns.push(column);
        }
        for (const row of indexes.rows) {
            entry(row.tablename).indexes.push([row.indexname, row.indexdef]);
        }
        return byTable;
    }

    test('every table the migrations create on an empty database, in the order a consumer applies them', async () => {
        await freshGround();
        const declared = await shapes();

        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        for (const name of migrations().filter((file) => file !== 'constraints.postgres.sql')) {
            await apply(name);
        }
        const created = await shapes();

        assert.ok(created.size > 0, 'no migration created a table, so nothing was compared');
        for (const [table, shape] of created) {
            assert.deepEqual(
                shape,
                declared.get(table),
                `${table} is created by a migration in another shape than the fragments declare`,
            );
        }
    });
});

describe('a migration that would merge rows stops instead', () => {
    // The 1.0 migration drops `projectKey` and puts a unique index where it
    // was. On an installation that only ever used one key that is a rename; on
    // one that used two it is a merge, and which of two colliding rows survives
    // is not a decision a migration takes on its own.
    //
    // Against the database rather than against the file: the file can be read
    // for a `RAISE`, but only a run shows that the condition finds the case and
    // that a single-key installation still goes through.

    const MIGRATION = '1.0-remove-project-key.postgres.sql';

    /**
     * The state a consumer is in *before* 1.0 runs.
     *
     * The ground is the schema as it is today, which is the migration's result
     * — so the column has to be put back, and the unique index it replaced
     * taken off, or there is nothing here for the migration to decide about.
     */
    async function beforeTheMigration() {
        await freshGround();
        await client.query('DROP INDEX IF EXISTS "plans_planKey_key"');
        await client.query('ALTER TABLE "plans" ADD COLUMN "projectKey" TEXT');
    }

    const seedPlan = (key, planKey) =>
        client.query(
            'INSERT INTO "plans" ("id", "projectKey", "planKey", "label", "updatedAt") ' +
                'VALUES ($1, $2, $3, $4, NOW())',
            [`plan-${key}-${planKey}`, key, planKey, planKey],
        );

    // @requirement SC-PRIV-009 — A migration that would destroy data stops and says what it found
    test('two project keys stop it, and the message names them', async () => {
        await beforeTheMigration();
        await seedPlan('alpha', 'STARTER');
        await seedPlan('beta', 'STARTER');

        await assert.rejects(
            () => apply(MIGRATION),
            (error) => {
                const said = String(error.message);
                assert.match(said, /2 different project keys/);
                assert.match(said, /alpha/);
                assert.match(said, /beta/, 'it stopped without saying what it found');
                assert.match(said, /plans:/, 'it did not say which table held them');
                return true;
            },
        );
    });

    // @requirement SC-PRIV-009 — A migration that would destroy data stops and says what it found
    // @requirement SC-PRIV-009 — A migration that would destroy data stops and says what it found
    test('and the installation is exactly as it was afterwards', async () => {
        // Stopping halfway would be the worst of the three outcomes: the column
        // gone and the operator with no way back to the state they were asked
        // to decide about. The whole file is one script in one transaction,
        // which is what makes the refusal a refusal rather than a half-run.
        await beforeTheMigration();
        await seedPlan('alpha', 'STARTER');
        await seedPlan('beta', 'STARTER');

        await apply(MIGRATION).catch(() => {});
        await client.query('ROLLBACK').catch(() => {});

        const { rows } = await client.query(
            'SELECT column_name FROM information_schema.columns ' +
                "WHERE table_name = 'plans' AND column_name = 'projectKey'",
        );
        assert.equal(rows.length, 1, 'the column it was asked about is already gone');
        const { rows: kept } = await client.query('SELECT "projectKey" FROM "plans" ORDER BY 1');
        assert.deepEqual(
            kept.map((row) => row.projectKey),
            ['alpha', 'beta'],
            'rows the operator was asked to decide about were already merged',
        );
    });

    test('one project key goes through', async () => {
        // The counter-check: a guard that refused every installation would pass
        // both cases above and stop every consumer from ever migrating.
        await beforeTheMigration();
        await seedPlan('alpha', 'STARTER');
        await seedPlan('alpha', 'PRO');

        await apply(MIGRATION);

        const { rows } = await client.query(
            'SELECT column_name FROM information_schema.columns ' +
                "WHERE table_name = 'plans' AND column_name = 'projectKey'",
        );
        assert.equal(rows.length, 0, 'the migration did not run');
    });
});

// @requirement SC-CFG-028 — There is one record per installation
describe('the applied settings hold one row, and the database is what holds them to it', () => {
    // The repository always writes `id = 'installation'`, and a unit test says
    // so; that is the code. The promise is about the other half: a caller that
    // supplies another id is refused by the CHECK, so a migration that lost the
    // constraint — or a `db push` that dropped it — fails here rather than
    // leaving a table with two rows and a reader picking one at random.
    const MIGRATION = '1.0-the-applied-settings-are-recorded.postgres.sql';
    const insert = (id) =>
        client.query(
            'INSERT INTO "applied_settings" ("id", "fingerprint", "settings", "source", "appliedAt") ' +
                "VALUES ($1, 'sha256-x', '{}', '/srv/app/config/saas.yaml', NOW())",
            [id],
        );

    test('a second id is refused by the constraint, on the reference schema', async () => {
        await freshGround();
        await insert('installation');
        await assert.rejects(() => insert('other'), /applied_settings_is_a_singleton/);
    });

    test('and on a database that gained the tables from the migration alone', async () => {
        await freshGround();
        await client.query('DROP TABLE "applied_settings", "settings_changes"');
        await apply(MIGRATION);
        await insert('installation');
        await assert.rejects(() => insert('other'), /applied_settings_is_a_singleton/);
    });
});

// @requirement SC-CFG-033 — The changes are listed in the order the record went through them
describe('a settings change carries the order it was recorded in', () => {
    // `seq` arrives on a table that may already hold rows, and the list an
    // operator saw was ordered by `noticedAt`, then `id`. The migration numbers
    // those rows in that order, so nothing changes place, continues the
    // numbering after them — and, run again, leaves every number alone: a row
    // recorded between the two runs keeps the number its write gave it, however
    // early the moment it carries.
    const MIGRATION = '1.0-a-settings-change-carries-its-order.postgres.sql';
    const insert = (id, noticedAt) =>
        client.query(
            'INSERT INTO "settings_changes" ("id", "noticedAt", "source", "previous", "current") ' +
                "VALUES ($1, $2, '/srv/app/config/saas.yaml', '{}', '{}')",
            [id, noticedAt],
        );
    const numbered = async () =>
        (await client.query('SELECT "id", "seq" FROM "settings_changes" ORDER BY "seq"')).rows.map(
            (row) => `${row.id}:${row.seq}`,
        );
    /** The table as it shipped before the column, with rows an operator has seen. */
    async function tableBeforeTheColumn() {
        await freshGround();
        await client.query('ALTER TABLE "settings_changes" DROP COLUMN "seq"');
        await insert('b', '2026-09-01T06:30:00.000Z');
        await insert('a', '2026-09-01T06:30:00.000Z');
        await insert('c', '2026-08-01T06:30:00.000Z');
        // An acknowledgement rewrites the row, so the heap no longer holds the
        // rows in the order they were inserted — the case a naive backfill
        // would number wrongly.
        await client.query(
            `UPDATE "settings_changes" SET "acknowledgedAt" = NOW() WHERE "id" = 'c'`,
        );
    }

    test('rows recorded before the column keep the order they were listed in, and the numbering continues', async () => {
        await tableBeforeTheColumn();
        await apply(MIGRATION);
        assert.deepEqual(await numbered(), ['c:1', 'a:2', 'b:3']);

        // Recorded after the migration, dated earlier than everything: the
        // number is the order of the write, and the sequence carried on.
        await insert('d', '2026-07-01T06:30:00.000Z');
        assert.deepEqual(await numbered(), ['c:1', 'a:2', 'b:3', 'd:4']);
    });

    test('a second run leaves every number where the first one put it', async () => {
        await tableBeforeTheColumn();
        await apply(MIGRATION);
        await insert('d', '2026-07-01T06:30:00.000Z');
        const afterFirst = await numbered();

        await apply(MIGRATION);
        assert.deepEqual(await numbered(), afterFirst, 'the second run renumbered rows');
        await insert('e', '2026-06-01T06:30:00.000Z');
        assert.deepEqual(
            (await numbered()).at(-1),
            'e:5',
            'the sequence was reset by the second run',
        );
    });
});

describe('a line item learns the money it was booked with', () => {
    // The 1.0 line-item migration adds three NOT NULL columns to a table that
    // already holds rows, which `db push` cannot do — it fills them from the
    // contract's own price snapshot first.
    //
    // Against the database rather than against the file, for the same reason as
    // above: the second-run suite proves it is a no-op on the reference schema,
    // where the columns already exist. It says nothing about the path that
    // matters, which is the one an upgrading consumer takes.

    const MIGRATION = '1.0-line-items-record-their-money.postgres.sql';

    /** The shape of the table before this migration existed. */
    async function beforeTheMigration() {
        await freshGround();
        await client.query(
            'ALTER TABLE "contract_line_items" ' +
                'DROP COLUMN "currency", DROP COLUMN "taxRate", DROP COLUMN "taxAmount"',
        );
    }

    /**
     * `offerId` names the offer a contract was concluded from. It changes
     * nothing about the rate, which is a percentage either way, and the cases
     * that pass one show exactly that.
     */
    const seedContract = async (id, priceSnapshot, offerId = null) => {
        // A contract names its subscriber, which this migration does not look at.
        await client.query(
            'INSERT INTO "subscribers" ("id", "legalName", "updatedAt") VALUES ($1, $2, NOW())',
            [`subscriber-${id}`, `Customer ${id}`],
        );
        await client.query(
            'INSERT INTO "subscription_contracts" ' +
                '("id", "tenantId", "subscriberId", "subscriberSnapshot", "effectiveFrom", ' +
                ' "priceSnapshot", "originalOfferId", "updatedAt") ' +
                'VALUES ($1, $2, $3, $4, NOW(), $5, $6, NOW())',
            [
                id,
                `tenant-${id}`,
                `subscriber-${id}`,
                JSON.stringify({ legalName: `Customer ${id}` }),
                JSON.stringify(priceSnapshot),
                offerId,
            ],
        );
    };

    const seedLine = (id, contractId, kind, priceNet, priceGross) =>
        client.query(
            'INSERT INTO "contract_line_items" ' +
                '("id", "contractId", "kind", "sourceKey", "titleSnapshot", ' +
                ' "priceNet", "priceGross", "billingCycle") ' +
                'VALUES ($1, $2, $3::"ContractLineItemKind", $4, $5, $6, $7, $8)',
            [id, contractId, kind, 'STANDARD', 'Standard', priceNet, priceGross, 'monthly'],
        );

    // A percentage its totals follow from.
    const swiss = { currency: 'CHF', vatRate: 8.1, totalNet: 100, totalGross: 108.1 };

    async function linesById() {
        const { rows } = await client.query(
            'SELECT "id", "currency", "taxRate", "taxAmount" FROM "contract_line_items" ' +
                'ORDER BY "id"',
        );
        return rows;
    }

    // @requirement SC-PRIC-015 — An amount records the currency it was booked in
    // @requirement SC-PRIC-017 — The tax rate and the tax amount are recorded, not re-derived
    test('the values come from the contract the line belongs to', async () => {
        await beforeTheMigration();
        await seedContract('c-1', swiss);
        await seedLine('l-plan', 'c-1', 'plan', '100.00', '108.10');
        // A discount is the case a fill that assumed positive money would get
        // wrong, and it is the one that would be found by a customer.
        await seedLine('l-discount', 'c-1', 'discount', '-10.00', '-10.81');

        await apply(MIGRATION);

        assert.deepEqual(await linesById(), [
            { id: 'l-discount', currency: 'CHF', taxRate: '8.10', taxAmount: '-0.81' },
            { id: 'l-plan', currency: 'CHF', taxRate: '8.10', taxAmount: '8.10' },
        ]);
    });

    test('and the columns come out of it required, so nothing can be written without them', async () => {
        await beforeTheMigration();
        await seedContract('c-1', swiss);
        await seedLine('l-plan', 'c-1', 'plan', '100.00', '108.10');

        await apply(MIGRATION);

        const { rows } = await client.query(
            'SELECT column_name, is_nullable FROM information_schema.columns ' +
                "WHERE table_name = 'contract_line_items' " +
                "AND column_name IN ('currency', 'taxRate', 'taxAmount') " +
                'ORDER BY column_name',
        );
        assert.deepEqual(
            rows.map((row) => [row.column_name, row.is_nullable]),
            [
                ['currency', 'NO'],
                ['taxAmount', 'NO'],
                ['taxRate', 'NO'],
            ],
        );
    });

    test('a second run leaves the values the first one wrote', async () => {
        // The second-run suite compares the schema. This compares the rows,
        // which is where a backfill without a condition would show — it would
        // rewrite them from today's snapshot rather than leave them alone.
        await beforeTheMigration();
        await seedContract('c-1', swiss);
        await seedLine('l-plan', 'c-1', 'plan', '100.00', '108.10');

        await apply(MIGRATION);
        const afterFirst = await linesById();
        await client.query(
            `UPDATE "subscription_contracts" SET "priceSnapshot" = $1 WHERE "id" = 'c-1'`,
            [JSON.stringify({ currency: 'EUR', vatRate: 19, totalNet: 100, totalGross: 119 })],
        );

        await apply(MIGRATION);

        assert.deepEqual(await linesById(), afterFirst, 'the second run relabelled history');
    });

    const totals = { totalNet: 100, totalGross: 119 };
    for (const [what, snapshot] of [
        ['no currency at all', { vatRate: 19, ...totals }],
        ['a currency that is not a string', { currency: 7, vatRate: 19, ...totals }],
        ['an empty currency', { currency: '', vatRate: 19, ...totals }],
        ['a rate written as text', { currency: 'EUR', vatRate: '19', ...totals }],
    ]) {
        // @requirement SC-PRIV-009 — A migration that would destroy data stops and says what it found
        test(`a contract with ${what} stops the migration and is named`, async () => {
            await beforeTheMigration();
            await seedContract('c-broken', snapshot);
            await seedLine('l-1', 'c-broken', 'plan', '100.00', '119.00');

            await assert.rejects(
                () => apply(MIGRATION),
                (error) => {
                    const said = String(error.message);
                    assert.match(said, /Cannot record the money facts of 1 contract/);
                    assert.match(said, /c-broken/, 'it stopped without saying which contract');
                    return true;
                },
            );
        });
    }

    test('and the table is exactly as it was afterwards', async () => {
        await beforeTheMigration();
        await seedContract('c-broken', { vatRate: 19, totalNet: 100, totalGross: 119 });
        await seedLine('l-1', 'c-broken', 'plan', '100.00', '119.00');

        await apply(MIGRATION).catch(() => {});
        await client.query('ROLLBACK').catch(() => {});

        const { rows } = await client.query(
            'SELECT column_name FROM information_schema.columns ' +
                "WHERE table_name = 'contract_line_items' AND column_name = 'currency'",
        );
        assert.equal(rows.length, 0, 'the refusal left half a migration behind');
    });

    for (const [what, snapshot, priceGross] of [
        ['above 100', { currency: 'EUR', vatRate: 150, totalNet: 100, totalGross: 250 }, '250.00'],
        ['below zero', { currency: 'EUR', vatRate: -19, totalNet: 100, totalGross: 81 }, '81.00'],
        [
            'written as a fraction',
            { currency: 'EUR', vatRate: 0.19, totalNet: 100, totalGross: 119 },
            '119.00',
        ],
        [
            'written as a fraction on a free plan',
            { currency: 'EUR', vatRate: 0.19, totalNet: 0, totalGross: 0 },
            '0.00',
        ],
        [
            'between 0 and 1 whose totals follow from it',
            { currency: 'EUR', vatRate: 0.5, totalNet: 100, totalGross: 100.5 },
            '100.50',
        ],
        [
            'just below 1',
            { currency: 'EUR', vatRate: 0.995, totalNet: 100, totalGross: 101 },
            '101.00',
        ],
    ]) {
        // Every tax rate is a percentage. Nothing converts one, and a value
        // outside 0 to 100, or between 0 and 1 however its totals look, stops
        // the migration. The rule is checked on the rate as written, so 0.995
        // is a fraction although it rounds to 1.00.
        // @requirement SC-CFG-035 — Every tax rate is a percentage, wherever it is stated
        test(`a rate ${what} stops the migration and is named`, async () => {
            await beforeTheMigration();
            await seedContract('c-not-a-percentage', snapshot, 'offer-9');
            await seedLine('l-1', 'c-not-a-percentage', 'plan', '100.00', priceGross);

            await assert.rejects(
                () => apply(MIGRATION),
                (error) => {
                    assert.match(
                        String(error.message),
                        /Cannot record the money facts of 1 contract/,
                    );
                    assert.match(String(error.message), /c-not-a-percentage/);
                    return true;
                },
            );
        });
    }

    for (const [what, snapshot, offerId, net, gross, rate] of [
        [
            'from the catalogue',
            { currency: 'EUR', vatRate: 19, totalNet: 100, totalGross: 119 },
            null,
            '100.00',
            '119.00',
            '19.00',
        ],
        [
            'from an offer',
            { currency: 'EUR', vatRate: 19, totalNet: 100, totalGross: 119 },
            'offer-1',
            '100.00',
            '119.00',
            '19.00',
        ],
        [
            'on a free plan',
            { currency: 'EUR', vatRate: 19, totalNet: 0, totalGross: 0 },
            'offer-2',
            '0.00',
            '0.00',
            '19.00',
        ],
        [
            'of 1',
            { currency: 'EUR', vatRate: 1, totalNet: 100, totalGross: 101 },
            'offer-3',
            '100.00',
            '101.00',
            '1.00',
        ],
        [
            'of 100',
            { currency: 'EUR', vatRate: 100, totalNet: 50, totalGross: 100 },
            null,
            '50.00',
            '100.00',
            '100.00',
        ],
        [
            'whose gross is a cent beside its net at the rate',
            { currency: 'EUR', vatRate: 19, totalNet: 10.01, totalGross: 11.92 },
            'offer-4',
            '10.01',
            '11.92',
            '19.00',
        ],
        [
            'of 0 beside a gross that is not its net',
            { currency: 'EUR', vatRate: 0, totalNet: 100, totalGross: 100.01 },
            'offer-5',
            '100.00',
            '100.01',
            '0.00',
        ],
        [
            'whose snapshot states no totals',
            { currency: 'EUR', vatRate: 19 },
            null,
            '100.00',
            '119.00',
            '19.00',
        ],
        [
            'whose totals are written as text',
            { currency: 'EUR', vatRate: 19, totalNet: '100', totalGross: '119' },
            null,
            '100.00',
            '119.00',
            '19.00',
        ],
    ]) {
        // @requirement SC-CFG-035 — Every tax rate is a percentage, wherever it is stated
        test(`a percentage ${what} is recorded as it stands`, async () => {
            await beforeTheMigration();
            await seedContract('c-percentage', snapshot, offerId);
            await seedLine('l-percentage', 'c-percentage', 'plan', net, gross);

            await apply(MIGRATION);

            const [line] = await linesById();
            assert.equal(line.taxRate, rate);
        });
    }

    // @requirement SC-CFG-035 — Every tax rate is a percentage, wherever it is stated
    test('a line that already carries a fraction as its own rate stops the migration too', async () => {
        // A schema that had a `taxRate` of its own keeps the value it holds, and
        // that value is held to the same rule as a snapshot's.
        await freshGround();
        await client.query('ALTER TABLE "contract_line_items" DROP COLUMN "taxAmount"');
        await client.query(
            'ALTER TABLE "contract_line_items" ' +
                'ALTER COLUMN "taxRate" DROP NOT NULL, ALTER COLUMN "currency" DROP NOT NULL',
        );
        await seedContract('c-own-fraction', swiss);
        await seedLine('l-1', 'c-own-fraction', 'plan', '100.00', '108.10');
        await client.query(`UPDATE "contract_line_items" SET "taxRate" = 0.19`);

        await assert.rejects(
            () => apply(MIGRATION),
            (error) => {
                assert.match(String(error.message), /c-own-fraction/);
                return true;
            },
        );
    });

    test('a value already in a column is kept, and a row missing only one is still found', async () => {
        // A schema that already had a `currency` of its own: `ADD COLUMN IF NOT
        // EXISTS` leaves it, so the backfill must read it rather than overwrite
        // it — and must still find the row, which keying off `currency` alone
        // would not.
        await freshGround();
        await client.query(
            'ALTER TABLE "contract_line_items" DROP COLUMN "taxRate", DROP COLUMN "taxAmount"',
        );
        await client.query(
            'ALTER TABLE "contract_line_items" ALTER COLUMN "currency" DROP NOT NULL',
        );
        await seedContract('c-1', swiss);
        await seedLine('l-1', 'c-1', 'plan', '100.00', '108.10');
        await client.query(`UPDATE "contract_line_items" SET "currency" = 'SEK'`);

        await apply(MIGRATION);

        assert.deepEqual(await linesById(), [
            { id: 'l-1', currency: 'SEK', taxRate: '8.10', taxAmount: '8.10' },
        ]);
    });

    test('an installation that never took the fragment is left alone', async () => {
        // The fragments are adopted a la carte. Without the guard the first
        // ALTER raises `relation does not exist` and rolls back the whole
        // script — on an app that had nothing to migrate in the first place.
        await freshGround();
        await client.query('DROP TABLE "contract_line_items" CASCADE');

        await apply(MIGRATION);

        const { rows } = await client.query(
            "SELECT to_regclass('contract_line_items') IS NULL AS gone",
        );
        assert.equal(rows[0].gone, true, 'the migration created a table nobody asked for');
    });

    test('a line whose contract is gone is named as itself, not as an empty space', async () => {
        // Unreachable while the shipped foreign key is there, which is why it
        // is worth pinning: the branch exists for a schema that dropped it, and
        // the first version of it aggregated a NULL — so the refusal counted
        // one row and named none.
        await beforeTheMigration();
        await client.query(
            'ALTER TABLE "contract_line_items" ' +
                'DROP CONSTRAINT "contract_line_items_contractId_fkey"',
        );
        await seedLine('l-orphan', 'c-gone', 'plan', '100.00', '119.00');

        await assert.rejects(
            () => apply(MIGRATION),
            (error) => {
                assert.match(String(error.message), /line l-orphan/);
                return true;
            },
        );
    });

    test('the query the guide ships finds exactly what the migration refuses', async () => {
        // The guide tells an operator to run this before the migration, and an
        // empty result to mean "it will go through". Two predicates written in
        // two places drift, and the one in prose drifts silently — so the guide's
        // own block is executed here and compared against what the migration
        // actually does with the same rows.
        await beforeTheMigration();
        await seedContract('c-good', {
            currency: 'EUR',
            vatRate: 19,
            totalNet: 100,
            totalGross: 119,
        });
        await seedLine('l-good', 'c-good', 'plan', '100.00', '119.00');
        await seedContract('c-no-currency', { vatRate: 19, totalNet: 100, totalGross: 119 });
        await seedLine('l-no-currency', 'c-no-currency', 'plan', '100.00', '119.00');
        await seedContract('c-text-rate', {
            currency: 'EUR',
            vatRate: '19',
            totalNet: 100,
            totalGross: 119,
        });
        await seedLine('l-text-rate', 'c-text-rate', 'plan', '100.00', '119.00');
        await seedContract(
            'c-fraction',
            { currency: 'EUR', vatRate: 0.19, totalNet: 100, totalGross: 119 },
            'offer-5',
        );
        await seedLine('l-fraction', 'c-fraction', 'plan', '100.00', '119.00');
        await seedContract(
            'c-free-fraction',
            { currency: 'EUR', vatRate: 0.19, totalNet: 0, totalGross: 0 },
            'offer-7',
        );
        await seedLine('l-free-fraction', 'c-free-fraction', 'plan', '0.00', '0.00');
        await seedContract(
            'c-zero-off',
            { currency: 'EUR', vatRate: 0, totalNet: 100, totalGross: 100.01 },
            'offer-8',
        );
        await seedLine('l-zero-off', 'c-zero-off', 'plan', '100.00', '100.01');
        await seedContract(
            'c-free-percent-offer',
            { currency: 'EUR', vatRate: 19, totalNet: 0, totalGross: 0 },
            'offer-3',
        );
        await seedLine('l-free-percent-offer', 'c-free-percent-offer', 'plan', '0.00', '0.00');
        // A contract with no lines needs no filling, so the query must not
        // report it however broken its snapshot is.
        await seedContract('c-lineless', {});

        const { rows } = await client.query(preflightQueryFromTheGuide());
        const reported = rows.map((row) => row.id).sort();
        assert.deepEqual(reported, [
            'c-fraction',
            'c-free-fraction',
            'c-no-currency',
            'c-text-rate',
        ]);

        await assert.rejects(
            () => apply(MIGRATION),
            (error) => {
                const said = String(error.message);
                // `includes` rather than a pattern built from the value: a
                // regular expression assembled from text is what the repository
                // bans, and a plain substring is what is actually being asked.
                for (const id of reported) {
                    assert.ok(said.includes(id), `the refusal did not name ${id}`);
                }
                for (const fine of ['c-good', 'c-free-percent-offer', 'c-zero-off']) {
                    assert.equal(
                        said.includes(fine),
                        false,
                        `the migration refused ${fine}, which the guide told the operator was fine`,
                    );
                }
                return true;
            },
        );
    });

    test('a contract that records both goes through', async () => {
        // The counter-check: a guard that refused everything would pass every
        // case above and stop every consumer from ever migrating.
        await beforeTheMigration();
        await seedContract('c-ok', { currency: 'EUR', vatRate: 0, totalNet: 100, totalGross: 100 });
        await seedLine('l-1', 'c-ok', 'plan', '100.00', '100.00');

        await apply(MIGRATION);

        assert.deepEqual(await linesById(), [
            { id: 'l-1', currency: 'EUR', taxRate: '0.00', taxAmount: '0.00' },
        ]);
    });
});

describe('every contract names the subscriber it is concluded with', () => {
    // The migration gives every tenant that has a subscription or a contract a
    // subscriber, named from the application's own tenant table, and attaches
    // the contracts with a copy of it. Against the database, because the
    // second-run suite runs it on the reference schema, where there is nothing
    // to attach — which is exactly where it proves nothing.

    const MIGRATION = '1.0-a-contract-names-its-subscriber.postgres.sql';

    /**
     * The platform tables as they stood before subscribers, beside an
     * application's own `tenants` table — with the foreign key an application
     * declares on `subscriptions."tenantId"`, unless asked not to.
     */
    async function beforeTheMigration({ foreignKey = true } = {}) {
        await freshGround();
        // Payment methods came later still, and point at the subscribers.
        await client.query(
            'DROP TABLE "subscriber_payment_method_setups", "subscriber_payment_methods", ' +
                '"subscriber_corrections", "subscriber_tenants"',
        );
        await client.query(
            'ALTER TABLE "subscription_contracts" DROP COLUMN "subscriberId", ' +
                'DROP COLUMN "subscriberSnapshot", DROP COLUMN "issuerSnapshot", ' +
                'DROP COLUMN "partiesMigrated"',
        );
        await client.query('DROP TABLE "subscribers"');
        await client.query('CREATE TABLE "tenants" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL)');
        if (foreignKey) {
            await client.query(
                'ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" ' +
                    'FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE',
            );
        }
        await client.query(
            `INSERT INTO "plans" ("id", "planKey", "label", "updatedAt") ` +
                `VALUES ('plan-1', 'STANDARD', 'Standard', NOW())`,
        );
        await client.query(
            'INSERT INTO "plan_versions" ("id", "planId", "version", "features", "quotas", ' +
                ' "monthlyNet", "yearlyNet", "changeNote", "updatedAt") ' +
                `VALUES ('pv-1', 'plan-1', 1, '[]', '{}', 49, 490, 'first', NOW())`,
        );
    }

    const seedTenant = (id, name) =>
        client.query('INSERT INTO "tenants" ("id", "name") VALUES ($1, $2)', [id, name]);
    const seedSubscription = (tenantId, createdAt) =>
        client.query(
            'INSERT INTO "subscriptions" ("id", "tenantId", "plan", "planVersionId", ' +
                ' "createdAt", "updatedAt") ' +
                `VALUES ($1, $2, 'STANDARD', 'pv-1', $3, NOW())`,
            [`sub-${tenantId}`, tenantId, createdAt],
        );
    const seedContract = (id, tenantId, createdAt) =>
        client.query(
            'INSERT INTO "subscription_contracts" ("id", "tenantId", "effectiveFrom", ' +
                ' "priceSnapshot", "createdAt", "updatedAt") ' +
                `VALUES ($1, $2, $3, '{}', $3, NOW())`,
            [id, tenantId, createdAt],
        );

    /** Three customers who came in a known order, and one who never bought anything. */
    async function threeCustomers() {
        await seedTenant('t-early', 'Early Motors GmbH');
        await seedTenant('t-member', 'TSV Example e.V.');
        await seedTenant('t-late', 'Late Software AG');
        await seedTenant('t-idle', 'Just Looking UG');
        await seedSubscription('t-early', '2026-01-10T09:00:00.000Z');
        await seedContract('c-early', 't-early', '2026-01-10T09:00:00.000Z');
        // A subscription and no contract yet: still a customer.
        await seedSubscription('t-member', '2026-02-01T09:00:00.000Z');
        // A contract created before its tenant's subscription row was.
        await seedContract('c-late', 't-late', '2026-03-01T09:00:00.000Z');
        await seedSubscription('t-late', '2026-03-05T09:00:00.000Z');
    }

    async function subscribers() {
        const { rows } = await client.query(
            'SELECT l."tenantId", s."customerNumberPrefix" || s."customerSequence" AS number, ' +
                ' s."legalName", s."migrated", l."unlinkedAt" ' +
                'FROM "subscribers" s JOIN "subscriber_tenants" l ON l."subscriberId" = s."id" ' +
                'ORDER BY s."customerSequence"',
        );
        return rows.map((row) => [row.tenantId, row.number, row.legalName, row.migrated]);
    }

    async function contracts() {
        const { rows } = await client.query(
            'SELECT c."id", l."tenantId" AS "linkedTenant", c."subscriberSnapshot", ' +
                ' c."issuerSnapshot", c."partiesMigrated" ' +
                'FROM "subscription_contracts" c ' +
                'JOIN "subscriber_tenants" l ON l."subscriberId" = c."subscriberId" ' +
                'ORDER BY c."id"',
        );
        return rows;
    }

    // @requirement SC-SUB-016 — A subscription always has its subscriber, whichever path created the tenant
    test('every tenant with a subscription or a contract gets one subscriber, named from its own table, in the order it came', async () => {
        await beforeTheMigration();
        await threeCustomers();

        await apply(MIGRATION);

        assert.deepEqual(await subscribers(), [
            ['t-early', '10001', 'Early Motors GmbH', true],
            ['t-member', '10002', 'TSV Example e.V.', true],
            ['t-late', '10003', 'Late Software AG', true],
        ]);
    });

    // @requirement SC-AUD-012 — A contract carries both parties as they were when it was concluded
    test("each contract names its tenant's subscriber, with a copy that says the migration made it", async () => {
        await beforeTheMigration();
        await threeCustomers();

        await apply(MIGRATION);

        assert.deepEqual(await contracts(), [
            {
                id: 'c-early',
                linkedTenant: 't-early',
                subscriberSnapshot: {
                    customerNumber: '10001',
                    legalName: 'Early Motors GmbH',
                    vatId: null,
                    taxNumber: null,
                    addressLine1: null,
                    addressLine2: null,
                    postalCode: null,
                    city: null,
                    country: null,
                },
                // The configuration is not readable from here, and a guess at
                // the issuer would be a party nobody named.
                issuerSnapshot: null,
                partiesMigrated: true,
            },
            {
                id: 'c-late',
                linkedTenant: 't-late',
                subscriberSnapshot: {
                    customerNumber: '10003',
                    legalName: 'Late Software AG',
                    vatId: null,
                    taxNumber: null,
                    addressLine1: null,
                    addressLine2: null,
                    postalCode: null,
                    city: null,
                    country: null,
                },
                issuerSnapshot: null,
                partiesMigrated: true,
            },
        ]);
        const { rows } = await client.query(
            'SELECT column_name, is_nullable FROM information_schema.columns ' +
                "WHERE table_name = 'subscription_contracts' " +
                "AND column_name IN ('subscriberId', 'subscriberSnapshot') ORDER BY column_name",
        );
        assert.deepEqual(
            rows.map((row) => [row.column_name, row.is_nullable]),
            [
                ['subscriberId', 'NO'],
                ['subscriberSnapshot', 'NO'],
            ],
        );
    });

    test('a prefix set for the session numbers the migrated subscribers the way new ones are numbered', async () => {
        await beforeTheMigration();
        await threeCustomers();

        await client.query(`SET saasicat.customer_number_prefix = 'K-'`);
        try {
            await apply(MIGRATION);
        } finally {
            await client.query('RESET saasicat.customer_number_prefix');
        }

        assert.deepEqual(
            (await subscribers()).map(([, number]) => number),
            ['K-10001', 'K-10002', 'K-10003'],
        );
        const copies = (await contracts()).map((row) => row.subscriberSnapshot.customerNumber);
        assert.deepEqual(copies, ['K-10001', 'K-10003']);
    });

    test('a prefix the configuration would refuse creates no subscriber', async () => {
        await beforeTheMigration();
        await threeCustomers();

        await client.query(`SET saasicat.customer_number_prefix = 'K 1'`);
        try {
            await assert.rejects(
                () => apply(MIGRATION),
                (error) => {
                    assert.ok(String(error.message).includes("'K 1'"), error.message);
                    return true;
                },
            );
        } finally {
            await client.query('ROLLBACK').catch(() => {});
            await client.query('RESET saasicat.customer_number_prefix');
        }

        const { rows } = await client.query('SELECT count(*)::int AS n FROM "subscribers"');
        assert.equal(rows[0].n, 0);
    });

    test('a second run leaves everything as the first one left it, a tenant added in between included', async () => {
        // Once the link is required the migration is done. A tenant an
        // application creates after that without a subscriber is the
        // application's to give one: a migration that went on naming them from
        // the tenant table on every container start would cover the gap with
        // copies marked as migrated instead of letting it show.
        await beforeTheMigration();
        await threeCustomers();
        await apply(MIGRATION);
        const subscribersAfterFirst = await subscribers();
        const copiesAfterFirst = await contracts();
        // A correction after the first run: the copies on the contracts stay as
        // the migration made them.
        await client.query(
            `UPDATE "subscribers" SET "legalName" = 'Early Motors Holding GmbH' ` +
                `WHERE "legalName" = 'Early Motors GmbH'`,
        );
        await seedTenant('t-next', 'Next Customer GmbH');
        await seedSubscription('t-next', '2026-04-01T09:00:00.000Z');

        await apply(MIGRATION);

        assert.deepEqual(
            await subscribers(),
            subscribersAfterFirst.map((row) =>
                row[0] === 't-early' ? [row[0], row[1], 'Early Motors Holding GmbH', row[3]] : row,
            ),
            'the second run created or renamed a subscriber',
        );
        assert.deepEqual(await contracts(), copiesAfterFirst, 'the second run rewrote a copy');
    });

    test('without a foreign key naming the tenant table it stops, names the tenants, and leaves the tables in place', async () => {
        await beforeTheMigration({ foreignKey: false });
        await threeCustomers();

        await assert.rejects(
            () => apply(MIGRATION),
            (error) => {
                const said = String(error.message);
                assert.ok(said.includes('Cannot create the subscribers of 3 tenant(s)'), said);
                for (const tenant of ['t-early', 't-late', 't-member']) {
                    assert.ok(said.includes(tenant), `it did not name ${tenant}`);
                }
                assert.ok(said.includes('no foreign key'), said);
                return true;
            },
        );
        await client.query('ROLLBACK').catch(() => {});

        const { rows } = await client.query(
            'SELECT (SELECT count(*)::int FROM "subscribers") AS subscribers, ' +
                ' (SELECT is_nullable FROM information_schema.columns ' +
                "   WHERE table_name = 'subscription_contracts' AND column_name = 'subscriberId') " +
                ' AS nullable',
        );
        assert.deepEqual(rows[0], { subscribers: 0, nullable: 'YES' });
    });

    test('a tenant table without a name column stops it, naming the table', async () => {
        await beforeTheMigration({ foreignKey: false });
        await client.query('CREATE TABLE "accounts" ("id" TEXT PRIMARY KEY)');
        await client.query(
            'ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" ' +
                'FOREIGN KEY ("tenantId") REFERENCES "accounts"("id")',
        );
        await client.query(`INSERT INTO "accounts" ("id") VALUES ('t-early')`);
        await seedSubscription('t-early', '2026-01-10T09:00:00.000Z');

        await assert.rejects(
            () => apply(MIGRATION),
            (error) => {
                const said = String(error.message);
                assert.ok(said.includes('accounts has no "name" column'), said);
                return true;
            },
        );
    });

    test('a tenant with no row or an empty name stops it, and both are named', async () => {
        await beforeTheMigration();
        await threeCustomers();
        await seedTenant('t-blank', '   ');
        await seedSubscription('t-blank', '2026-05-01T09:00:00.000Z');
        // The foreign key sits on the subscriptions, so a contract can outlive
        // its tenant's row.
        await seedContract('c-orphan', 't-gone', '2026-05-02T09:00:00.000Z');

        await assert.rejects(
            () => apply(MIGRATION),
            (error) => {
                const said = String(error.message);
                assert.ok(said.includes('of 2 tenant(s) (t-blank, t-gone)'), said);
                assert.equal(said.includes('t-early'), false, 'it named a tenant it could name');
                return true;
            },
        );
    });

    /**
     * Runs `fn` as a role that owns every table and has no way around
     * row-level security, the shape of an application's own database role.
     */
    async function asOwningRole(fn) {
        await client.query('DROP ROLE IF EXISTS saasicat_migrator');
        await client.query('CREATE ROLE saasicat_migrator');
        await client.query('GRANT ALL ON SCHEMA public TO saasicat_migrator');
        const { rows: tables } = await client.query(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
        );
        for (const { tablename } of tables) {
            await client.query(`ALTER TABLE "${tablename}" OWNER TO saasicat_migrator`);
        }
        try {
            await fn({
                become: () => client.query('SET ROLE saasicat_migrator'),
                leave: () => client.query('RESET ROLE'),
            });
        } finally {
            await client.query('ROLLBACK').catch(() => {});
            await client.query('RESET ROLE');
            await client.query('DROP OWNED BY saasicat_migrator CASCADE');
            await client.query('DROP ROLE IF EXISTS saasicat_migrator');
        }
    }

    const forceRowLevelSecurity = async (table) => {
        await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
        await client.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    };

    const refusedFor = (table) => (error) => {
        const said = String(error.message);
        assert.ok(said.includes(`Cannot see every row of ${table} `), said);
        assert.ok(said.includes('saasicat_migrator'), said);
        return true;
    };

    test('a role row-level security hides contracts from stops it, naming the table and the role', async () => {
        // A consumer that forces row-level security onto its contracts and runs
        // the file as the table owner sees none of them without a tenant set.
        await beforeTheMigration();
        await threeCustomers();
        await asOwningRole(async ({ become, leave }) => {
            await forceRowLevelSecurity('subscription_contracts');
            await become();

            await assert.rejects(() => apply(MIGRATION), refusedFor('subscription_contracts'));
            await client.query('ROLLBACK').catch(() => {});
            const { rows } = await client.query('SELECT count(*)::int AS n FROM "subscribers"');
            assert.equal(rows[0].n, 0);

            // The counter-check: the owner of a table whose security is not
            // forced sees every row, and the migration goes through.
            await leave();
            await client.query('ALTER TABLE "subscription_contracts" NO FORCE ROW LEVEL SECURITY');
            await become();
            await apply(MIGRATION);
            assert.equal((await subscribers()).length, 3);
        });
    });

    test('and so does row-level security on the tenant table the legal names come from', async () => {
        // Hidden tenant rows would otherwise be reported as tenants without a
        // name, of rows that are there.
        await beforeTheMigration();
        await threeCustomers();
        await asOwningRole(async ({ become }) => {
            await forceRowLevelSecurity('tenants');
            await become();

            await assert.rejects(() => apply(MIGRATION), refusedFor('tenants'));
        });
    });

    test('once it has run through, a run as a role under row-level security does nothing', async () => {
        // The upgrade is run once as a role that bypasses row-level security,
        // and an entrypoint applies the file again on the next start as the
        // application's own role.
        await beforeTheMigration();
        await threeCustomers();
        await apply(MIGRATION);
        const afterFirst = await subscribers();
        await asOwningRole(async ({ become, leave }) => {
            await forceRowLevelSecurity('subscription_contracts');
            await become();

            await apply(MIGRATION);

            await leave();
            assert.deepEqual(await subscribers(), afterFirst);
        });
    });

    test('the statement the guide shows creates the subscribers it could not, and it then goes through', async () => {
        await beforeTheMigration({ foreignKey: false });
        await threeCustomers();
        await apply(MIGRATION).catch(() => {});
        await client.query('ROLLBACK').catch(() => {});

        await client.query(subscriberStatementFromTheGuide());
        await apply(MIGRATION);

        const numbered = await subscribers();
        assert.deepEqual(
            numbered.map(([tenant, , name, migrated]) => [tenant, name, migrated]),
            [
                ['t-early', 'Early Motors GmbH', true],
                ['t-late', 'Late Software AG', true],
                ['t-member', 'TSV Example e.V.', true],
            ],
        );
        assert.deepEqual(
            (await contracts()).map((row) => [row.id, row.linkedTenant, row.partiesMigrated]),
            [
                ['c-early', 't-early', true],
                ['c-late', 't-late', true],
            ],
        );
    });
});

describe('a payment method is the gateway reference, kept for the subscriber', () => {
    // The migration adds the subscriber's payment methods, makes a gateway
    // event unique per account, and gives a sign-up its billing details. The
    // second-run suite runs it on the reference schema, where every object is
    // already there; these start from the schema as it stood before.

    const MIGRATION = '1.0-a-payment-method-is-a-gateway-reference.postgres.sql';

    /** The reference schema with this migration's objects taken back out. */
    async function beforeTheMigration() {
        await freshGround();
        await client.query(
            'DROP TABLE "subscriber_payment_method_setups", "subscriber_payment_methods"',
        );
        await client.query('DROP INDEX "PaymentEventLog_gatewayAccount_eventId_key"');
        await client.query('ALTER TABLE "PaymentEventLog" DROP COLUMN "gatewayAccount"');
        await client.query(
            'CREATE UNIQUE INDEX "PaymentEventLog_eventId_key" ON "PaymentEventLog"("eventId")',
        );
        await client.query(
            'ALTER TABLE "PendingRegistration" DROP COLUMN "addressLine1", ' +
                'DROP COLUMN "addressLine2", DROP COLUMN "postalCode", DROP COLUMN "city", ' +
                'DROP COLUMN "country", DROP COLUMN "vatId", DROP COLUMN "taxNumber", ' +
                'DROP COLUMN "checkoutGatewayAccount", DROP COLUMN "gatewayCustomerRef"',
        );
    }

    const seedEvent = (id, eventId, provider) =>
        client.query(
            'INSERT INTO "PaymentEventLog" ("id", "eventId", "provider", "status") ' +
                `VALUES ($1, $2, $3, 'SUCCEEDED')`,
            [id, eventId, provider],
        );

    async function events() {
        const { rows } = await client.query(
            'SELECT "eventId", "provider", "gatewayAccount" FROM "PaymentEventLog" ORDER BY "id"',
        );
        return rows;
    }

    async function referenceFingerprint() {
        await freshGround();
        return fingerprint(client);
    }

    test('a database from before ends up with the schema the fragments declare', async () => {
        const reference = await referenceFingerprint();
        await beforeTheMigration();
        assert.notEqual(
            await fingerprint(client),
            reference,
            'nothing was taken out to begin with',
        );

        await apply(MIGRATION);

        assert.equal(await fingerprint(client), reference);
        const { rows } = await client.query(
            `SELECT conname FROM pg_constraint WHERE conname IN ` +
                `('subscriber_payment_methods_subscriberId_fkey', ` +
                `'subscriber_payment_method_setups_subscriberId_fkey') ORDER BY conname`,
        );
        assert.deepEqual(
            rows.map((row) => row.conname),
            [
                'subscriber_payment_method_setups_subscriberId_fkey',
                'subscriber_payment_methods_subscriberId_fkey',
            ],
            'the payment methods or their setups do not point at their subscriber',
        );
    });

    test('an event recorded before carries its provider as its account, and stays unique', async () => {
        await beforeTheMigration();
        await seedEvent('e1', 'evt_1', 'dev-stub');
        await seedEvent('e2', 'evt_2', 'stripe');

        await apply(MIGRATION);

        assert.deepEqual(await events(), [
            { eventId: 'evt_1', provider: 'dev-stub', gatewayAccount: 'dev-stub' },
            { eventId: 'evt_2', provider: 'stripe', gatewayAccount: 'stripe' },
        ]);
        // The same identifier from another account is another event now.
        await client.query(
            'INSERT INTO "PaymentEventLog" ("id", "gatewayAccount", "eventId", "provider", "status") ' +
                `VALUES ('e3', 'stripe-main', 'evt_1', 'stripe', 'payment-method-confirmed')`,
        );
        await assert.rejects(
            client.query(
                'INSERT INTO "PaymentEventLog" ("id", "gatewayAccount", "eventId", "provider", "status") ' +
                    `VALUES ('e4', 'stripe-main', 'evt_1', 'stripe', 'payment-method-confirmed')`,
            ),
            /duplicate key value/,
        );
    });

    test('a second run leaves the accounts the first one gave, an event recorded in between included', async () => {
        await beforeTheMigration();
        await seedEvent('e1', 'evt_1', 'dev-stub');
        await apply(MIGRATION);
        const schemaAfterFirst = await fingerprint(client);
        await client.query(
            'INSERT INTO "PaymentEventLog" ("id", "gatewayAccount", "eventId", "provider", "status") ' +
                `VALUES ('e2', 'stripe-main', 'evt_2', 'stripe', 'payment-method-confirmed')`,
        );

        await apply(MIGRATION);

        assert.equal(await fingerprint(client), schemaAfterFirst);
        assert.deepEqual(await events(), [
            { eventId: 'evt_1', provider: 'dev-stub', gatewayAccount: 'dev-stub' },
            { eventId: 'evt_2', provider: 'stripe', gatewayAccount: 'stripe-main' },
        ]);
    });

    test('two confirmations of one session are refused by name rather than by a unique violation', async () => {
        await beforeTheMigration();
        // Only a database run against an unreleased build of this change can
        // hold these: the wording and the index ship in the same file.
        for (const id of ['e1', 'e2']) {
            await client.query(
                'INSERT INTO "PaymentEventLog" ' +
                    '("id", "eventId", "provider", "sessionId", "status") ' +
                    `VALUES ($1, $1, 'stripe', 'cs_twice', 'payment-method-confirmed')`,
                [id],
            );
        }

        await assert.rejects(apply(MIGRATION), (error) => {
            assert.match(error.message, /holds 2 confirmations of session cs_twice/);
            assert.match(error.message, /apply this file again/);
            return true;
        });
        await client.query('ROLLBACK').catch(() => {});

        // The whole file rolled back, so the repair is applying it again.
        await client.query(`DELETE FROM "PaymentEventLog" WHERE "id" = 'e2'`);
        await apply(MIGRATION);
        await apply(MIGRATION);
        assert.deepEqual(await events(), [
            { eventId: 'e1', provider: 'stripe', gatewayAccount: 'stripe' },
        ]);
    });

    test('an installation without self-registration gets the payment methods and nothing else', async () => {
        await beforeTheMigration();
        await client.query('DROP TABLE "PendingRegistration", "PaymentEventLog"');

        await apply(MIGRATION);
        await apply(MIGRATION);

        const { rows } = await client.query(
            `SELECT to_regclass('subscriber_payment_methods') AS methods, ` +
                `to_regclass('"PaymentEventLog"') AS events, ` +
                `to_regclass('"PendingRegistration"') AS pending`,
        );
        assert.deepEqual(rows[0], {
            methods: 'subscriber_payment_methods',
            events: null,
            pending: null,
        });
    });

    test('an installation without subscribers is left without the payment methods, and runs through', async () => {
        await beforeTheMigration();
        await client.query('DROP TABLE "subscribers" CASCADE');

        await apply(MIGRATION);
        await apply(MIGRATION);

        const { rows } = await client.query(
            `SELECT to_regclass('subscriber_payment_methods') AS methods`,
        );
        assert.equal(rows[0].methods, null);
    });

    test('the old masked payment methods an application wrote are left where they are', async () => {
        await beforeTheMigration();
        await client.query(
            `CREATE TYPE "SubscriptionPaymentType" AS ENUM ('CARD', 'SEPA', 'PAYPAL', 'KLARNA', 'INVOICE')`,
        );
        await client.query(
            'CREATE TABLE "subscription_payment_methods" ("id" TEXT PRIMARY KEY, ' +
                '"type" "SubscriptionPaymentType" NOT NULL, "cardLast4" TEXT)',
        );
        await client.query(
            `INSERT INTO "subscription_payment_methods" VALUES ('old', 'CARD', '4242')`,
        );

        await apply(MIGRATION);

        const { rows } = await client.query('SELECT * FROM "subscription_payment_methods"');
        assert.deepEqual(rows, [{ id: 'old', type: 'CARD', cardLast4: '4242' }]);
    });
});

describe('customer numbers count from 10001', () => {
    // A number with fewer digits reads as a count of customers, and a sequence
    // that starts over at 1 after a restart of its identity — which a test
    // harness truncating its tables does — hands out numbers that were issued
    // once already. The constraints set both where the count starts and where
    // it starts over.
    const insert = (id) =>
        client.query(
            'INSERT INTO "subscribers" ("id", "legalName", "updatedAt") VALUES ($1, $1, NOW())',
            [id],
        );
    const numbers = async () =>
        (await client.query('SELECT "customerSequence" FROM "subscribers" ORDER BY 1')).rows.map(
            (row) => row.customerSequence,
        );

    test('on the reference schema, and again after the identity is restarted', async () => {
        await freshGround();
        await insert('first');
        await insert('second');
        assert.deepEqual(await numbers(), [10001, 10002]);

        await client.query('TRUNCATE TABLE "subscribers" RESTART IDENTITY CASCADE');
        await insert('after-restart');
        assert.deepEqual(await numbers(), [10001]);
    });

    test('and the constraints applied again move a sequence that has handed numbers out nowhere', async () => {
        await freshGround();
        await insert('first');
        await apply('constraints.postgres.sql');
        await insert('second');
        assert.deepEqual(await numbers(), [10001, 10002], 'the second run reset the count');
    });
});

/**
 * The statement out of the upgrade guide that creates subscribers by hand, as an
 * operator would copy it — cut the same way as the pre-flight query below.
 */
function subscriberStatementFromTheGuide() {
    const guide = readFileSync(
        join(SQL_DIR, '..', '..', '..', 'docs', 'guides', 'upgrade-to-1.0.md'),
        'utf8',
    );
    const heading = guide.indexOf('### A contract names the subscriber it is concluded with');
    assert.notEqual(heading, -1, 'the section this migration is documented in has been renamed');
    const marker = guide.indexOf('**When the migration cannot name a tenant.**', heading);
    assert.notEqual(marker, -1, 'the guide no longer shows how to create subscribers by hand');
    const opens = guide.indexOf('```sql', marker);
    const body = opens + '```sql'.length;
    const closes = guide.indexOf('```', body);
    assert.ok(opens !== -1 && closes !== -1, 'the statement block is not closed');
    return guide.slice(body, closes).trim();
}

/**
 * The pre-flight query out of the upgrade guide, as an operator would copy it.
 *
 * Cut with `indexOf` rather than matched with a pattern: the guide is prose
 * with many fenced blocks, and a pattern loose enough to find one of them is
 * loose enough to find the wrong one.
 */
function preflightQueryFromTheGuide() {
    const guide = readFileSync(
        join(SQL_DIR, '..', '..', '..', 'docs', 'guides', 'upgrade-to-1.0.md'),
        'utf8',
    );
    const heading = guide.indexOf('### A contract line records the currency and the tax');
    assert.notEqual(heading, -1, 'the section this migration is documented in has been renamed');
    const marker = guide.indexOf('**List what it would refuse, before you run it.**', heading);
    assert.notEqual(marker, -1, 'the guide no longer offers a query to run first');
    const opens = guide.indexOf('```sql', marker);
    const body = opens + '```sql'.length;
    const closes = guide.indexOf('```', body);
    assert.ok(opens !== -1 && closes !== -1, 'the query block is not closed');
    return guide.slice(body, closes).trim();
}
