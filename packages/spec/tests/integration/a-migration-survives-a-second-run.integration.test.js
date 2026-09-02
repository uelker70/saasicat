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
     * `offerId` is the provenance the migration falls back on where a
     * contract's totals cannot say which unit its rate is in: null is a
     * contract frozen from the catalogue, an id one concluded from an offer.
     */
    const seedContract = (id, priceSnapshot, offerId = null) =>
        client.query(
            'INSERT INTO "subscription_contracts" ' +
                '("id", "tenantId", "effectiveFrom", "priceSnapshot", "originalOfferId", ' +
                ' "updatedAt") ' +
                'VALUES ($1, $2, NOW(), $3, $4, NOW())',
            [id, `tenant-${id}`, JSON.stringify(priceSnapshot), offerId],
        );

    const seedLine = (id, contractId, kind, priceNet, priceGross) =>
        client.query(
            'INSERT INTO "contract_line_items" ' +
                '("id", "contractId", "kind", "sourceKey", "titleSnapshot", ' +
                ' "priceNet", "priceGross", "billingCycle") ' +
                'VALUES ($1, $2, $3::"ContractLineItemKind", $4, $5, $6, $7, $8)',
            [id, contractId, kind, 'STANDARD', 'Standard', priceNet, priceGross, 'monthly'],
        );

    // States its rate in per cent, and its own totals say so.
    const swiss = { currency: 'CHF', vatRate: 8.1, totalNet: 100, totalGross: 108.1 };
    // States it as a fraction, the way a checkout offer does.
    const fromAnOffer = { currency: 'EUR', vatRate: 0.19, totalNet: 100, totalGross: 119 };

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

    // @requirement SC-PRIV-009 — A migration that would destroy data stops and says what it found
    const totals = { totalNet: 100, totalGross: 119 };
    for (const [what, snapshot] of [
        ['no currency at all', { vatRate: 19, ...totals }],
        ['a currency that is not a string', { currency: 7, vatRate: 19, ...totals }],
        ['an empty currency', { currency: '', vatRate: 19, ...totals }],
        ['a rate written as text', { currency: 'EUR', vatRate: '19', ...totals }],
        ['no totals to read the unit from', { currency: 'EUR', vatRate: 19 }],
        ['totals that are not numbers', { currency: 'EUR', vatRate: 19, totalNet: '100' }],
    ]) {
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

    // @requirement SC-PRIC-017 — The tax rate and the tax amount are recorded, not re-derived
    test('a rate no reading brings inside 0-100 stops the migration and is named', async () => {
        // Reachable only through an offer: a breakdown that states a
        // percentage, which this platform's own offer arithmetic never
        // produces. The catalogue side cannot get here — its rate is taken as
        // stated — which is the whole point of asking provenance.
        await beforeTheMigration();
        await seedContract('c-percent-offer', { currency: 'EUR', vatRate: 19 }, 'offer-9');
        await seedLine('l-1', 'c-percent-offer', 'plan', '100.00', '119.00');

        await assert.rejects(
            () => apply(MIGRATION),
            (error) => {
                assert.match(String(error.message), /Cannot record the money facts of 1 contract/);
                assert.match(String(error.message), /c-percent-offer/);
                return true;
            },
        );
    });

    // @requirement SC-PRIC-017 — The tax rate and the tax amount are recorded, not re-derived
    test('a free plan frozen from the catalogue keeps its rate as it stands', async () => {
        // Both readings explain a gross of zero, so the totals decide nothing
        // and the contract's provenance has to. Falling back to the fraction
        // here turned an ordinary 19 into 1900 and stopped the upgrade of every
        // installation that sells a free plan.
        await beforeTheMigration();
        await seedContract('c-free', { currency: 'EUR', vatRate: 19, totalNet: 0, totalGross: 0 });
        await seedLine('l-free', 'c-free', 'plan', '0.00', '0.00');

        await apply(MIGRATION);

        assert.deepEqual(await linesById(), [
            { id: 'l-free', currency: 'EUR', taxRate: '19.00', taxAmount: '0.00' },
        ]);
    });

    test('and a free plan concluded from an offer keeps its rate as the fraction it is', async () => {
        await beforeTheMigration();
        await seedContract(
            'c-free-offer',
            { currency: 'EUR', vatRate: 0.19, totalNet: 0, totalGross: 0 },
            'offer-2',
        );
        await seedLine('l-free-offer', 'c-free-offer', 'plan', '0.00', '0.00');

        await apply(MIGRATION);

        assert.deepEqual(await linesById(), [
            { id: 'l-free-offer', currency: 'EUR', taxRate: '19.00', taxAmount: '0.00' },
        ]);
    });

    test('a rate a checkout offer stated as a fraction is recorded in per cent', async () => {
        // The case that makes the column worth having: the same installation
        // holds 0.19 on contracts concluded through checkout and 19 on ones
        // frozen from the catalogue, and a column filled from either as it
        // stands would keep both.
        await beforeTheMigration();
        await seedContract('c-offer', fromAnOffer, 'offer-1');
        await seedLine('l-offer', 'c-offer', 'plan', '100.00', '119.00');
        await seedContract('c-catalogue', { currency: 'EUR', ...fromAnOffer, vatRate: 19 });
        await seedLine('l-catalogue', 'c-catalogue', 'plan', '100.00', '119.00');

        await apply(MIGRATION);

        assert.deepEqual(await linesById(), [
            { id: 'l-catalogue', currency: 'EUR', taxRate: '19.00', taxAmount: '19.00' },
            { id: 'l-offer', currency: 'EUR', taxRate: '19.00', taxAmount: '19.00' },
        ]);
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
        // A contract with no lines needs no filling, so the query must not
        // report it however broken its snapshot is.
        await seedContract('c-lineless', {});

        const { rows } = await client.query(preflightQueryFromTheGuide());
        const reported = rows.map((row) => row.id).sort();
        assert.deepEqual(reported, ['c-no-currency', 'c-text-rate']);

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
                assert.equal(
                    said.includes('c-good'),
                    false,
                    'the migration refused a contract the guide told the operator was fine',
                );
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
