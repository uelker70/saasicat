-- =============================================================================
-- SaaSiCat 1.0 — a contract line item records the currency and the tax it was
-- booked with.
-- =============================================================================
--
-- `contract_line_items` gains three columns: "currency", "taxRate" and
-- "taxAmount". They are NOT NULL in the shipped fragment, which a plain
-- `prisma db push` cannot produce on a table that already holds rows — so this
-- file adds them nullable, fills them, and only then tightens them. Run it
-- BEFORE `db push`, the same way as the other file in this directory:
--
--   psql "$DATABASE_URL" -f 1.0-line-items-record-their-money.postgres.sql
--
-- Where the values come from. Every contract carries a `priceSnapshot` holding
-- the currency and the VAT rate that were agreed for it, written in the same
-- moment as its line items — so an existing line reads the fact one level up.
-- "taxAmount" is the gap between the line's own net and gross, which is exact:
-- both are already held to two places.
--
-- The rate is a percentage, as every tax rate in SaaSiCat is: 19 means 19 %.
-- It is taken from the snapshot as it stands and checked, never read in some
-- other unit or converted. A contract stops the migration, named, where its
-- snapshot does not state a currency, does not state its vatRate as a number,
-- or states a rate outside 0 to 100 or between 0 and 1 — the shape of a
-- fraction such as 0.19. A line this file fills that already carries a rate of
-- its own is held to the same rule; a line that already holds all three values
-- is not touched. An installation that stored fractions converts them before it
-- runs this file; a row labelled 0.19 % because a number was there is worse
-- than a migration that did not run.
--
-- Safe to run again: the columns are added only where they are missing, a value
-- already in a column is kept rather than rewritten, and tightening a column
-- that is already NOT NULL is a no-op. On a database created from
-- `reference-schema.postgres.sql` the whole file does nothing at all — the
-- columns are already there, already tight, and there is nothing to fill.

BEGIN;

DO $$
DECLARE
    unfillable text[];
BEGIN
    IF to_regclass('contract_line_items') IS NULL THEN
        RAISE NOTICE 'contract_line_items is not present — nothing to migrate.';
        RETURN;  -- an installation that never adopted this fragment
    END IF;

    ALTER TABLE "contract_line_items" ADD COLUMN IF NOT EXISTS "currency" TEXT;
    ALTER TABLE "contract_line_items" ADD COLUMN IF NOT EXISTS "taxRate" DECIMAL(5,2);
    ALTER TABLE "contract_line_items" ADD COLUMN IF NOT EXISTS "taxAmount" DECIMAL(10,2);

    -- What each row is to end up holding, worked out once.
    --
    -- Once, because the guard below and the backfill after it have to agree:
    -- two copies of this expression is two chances to answer differently, and
    -- the one that would go unnoticed is the guard passing a row the backfill
    -- then cannot fill.
    --
    -- A value already in a column is kept. The columns are added only where
    -- they are missing, so on a schema that already had a `currency` of its own
    -- this migration reads it rather than overwriting it — and a row that needs
    -- only one of the three is still found, which keying off `currency` alone
    -- would have missed.
    CREATE TEMP TABLE _saasicat_line_money ON COMMIT DROP AS
    SELECT li."id" AS line_id,
           coalesce(c."id", format('line %s', li."id")) AS witness,
           coalesce(
               li."currency",
               CASE
                   WHEN jsonb_typeof(c."priceSnapshot" -> 'currency') = 'string'
                       THEN nullif(c."priceSnapshot" ->> 'currency', '')
               END
           ) AS currency,
           -- The rate as it is stated, before it is rounded to the column's two
           -- places: the rule is checked on what was written, as the guide's
           -- query checks it, so 0.995 is a fraction here too.
           coalesce(li."taxRate", snap.rate) AS stated_rate,
           coalesce(li."taxRate", round(snap.rate, 2)) AS tax_rate,
           coalesce(li."taxAmount", li."priceGross" - li."priceNet") AS tax_amount
      FROM "contract_line_items" li
      LEFT JOIN "subscription_contracts" c ON c."id" = li."contractId"
      -- The rate is cast only once it is known to be a JSON number, so a
      -- snapshot stating `"vatRate": "19"` reaches the refusal below with its
      -- contract named rather than a cast error that names nothing.
     CROSS JOIN LATERAL (
         SELECT CASE WHEN jsonb_typeof(c."priceSnapshot" -> 'vatRate') = 'number'
                    THEN (c."priceSnapshot" ->> 'vatRate')::numeric END AS rate
     ) snap
     WHERE li."currency" IS NULL
        OR li."taxRate" IS NULL
        OR li."taxAmount" IS NULL;

    -- The contract names itself where there is one. A line whose contract is
    -- missing names itself instead: the shipped fragment declares the foreign
    -- key that makes that impossible, but a schema without it would otherwise
    -- reach the message with nothing to say, and an installation this cannot
    -- fill is exactly the one that needs telling which row to look at.
    SELECT array_agg(DISTINCT witness)
      INTO unfillable
      FROM _saasicat_line_money
     WHERE currency IS NULL
        OR stated_rate IS NULL
        OR stated_rate < 0
        OR stated_rate > 100
        -- The shape of a fraction: a percentage between 0 and 1 is refused
        -- rather than recorded as a fraction of a per cent.
        OR (stated_rate > 0 AND stated_rate < 1);

    IF unfillable IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot record the money facts of % contract(s): their priceSnapshot does not state a '
            'currency, or does not state its vatRate as a number, or states a tax rate — in the '
            'snapshot, or on a line that already carries one — that is not a percentage from 0 '
            'to 100, a value between 0 and 1 being refused as a fraction (%). The snapshot is '
            'the only record of what was agreed, so this migration converts nothing. Repair those '
            'rows and run it again. A line named on its own has no contract row at all.',
            array_length(unfillable, 1),
            array_to_string(unfillable[1:10], ', ')
                || CASE WHEN array_length(unfillable, 1) > 10 THEN ', …' ELSE '' END;
    END IF;

    UPDATE "contract_line_items" li
       SET "currency"  = m.currency,
           "taxRate"   = m.tax_rate,
           "taxAmount" = m.tax_amount
      FROM _saasicat_line_money m
     WHERE m.line_id = li."id";

    ALTER TABLE "contract_line_items" ALTER COLUMN "currency" SET NOT NULL;
    ALTER TABLE "contract_line_items" ALTER COLUMN "taxRate" SET NOT NULL;
    ALTER TABLE "contract_line_items" ALTER COLUMN "taxAmount" SET NOT NULL;
END $$;

COMMIT;
