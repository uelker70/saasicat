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
-- moment as its line items — so an existing line is not guessed at, it reads
-- the fact one level up. "taxAmount" is the gap between the line's own net and
-- gross, which is exact: both are already held to two places.
--
-- The rate needs its unit read rather than assumed. A contract frozen from the
-- catalogue holds per cent. A contract concluded from a checkout offer holds
-- the rate as that offer stated it: the platform's offer priced its lines as
-- `net * (1 + vatRate)`, a fraction, and an installation that built its own
-- offers may have written per cent there too. The same installation can
-- therefore hold both in one column, which is the reason `"taxRate"` exists.
--
-- Three things decide the unit, in this order. First the snapshot's own
-- totals: whichever of the two readings alone explains the gross it recorded
-- is the one it was written in. Where both explain it (totals of zero, which
-- every rate explains) or neither does (a total summed from rounded lines can
-- sit a cent beside both), the size of the rate: a fraction above 1 would be a
-- tax above 100 per cent, which the guard below refuses, so a rate above 1 is
-- per cent. A rate of exactly 1 is still 100 per cent as a fraction, so from 1
-- down the size settles nothing. There, where both readings explain the
-- totals, the contract's provenance decides: `originalOfferId` is set only
-- where the contract was concluded from an offer, so a null one holds per cent
-- and a set one the platform's fraction. Where neither does, nothing in the
-- row says which unit it is, and the migration refuses rather than guessing.
--
-- What it will not do is invent a value. A contract whose snapshot does not
-- state a currency, or does not state the numbers this needs, or leaves the
-- unit of a rate of 1 or below open, or yields a rate outside 0–100, stops the
-- migration with a sentence naming the contract —
-- because a row labelled EUR because EUR is common is worse than a migration
-- that did not run.
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
           coalesce(
               li."taxRate",
               CASE
                   WHEN snap.rate IS NULL THEN NULL
                   -- The totals explain exactly one reading.
                   WHEN reading.as_percent AND NOT reading.as_fraction
                       THEN round(snap.rate, 2)
                   WHEN reading.as_fraction AND NOT reading.as_percent
                       THEN round(snap.rate * 100, 2)
                   -- They explain both or neither. A fraction above 1 would
                   -- be a tax above 100 per cent, so this rate is per cent
                   -- whatever the totals say. Exactly 1 is not settled here:
                   -- as a fraction it is 100 per cent, which the guard allows.
                   WHEN snap.rate > 1
                       THEN round(snap.rate, 2)
                   -- 1 or below and explained by neither reading: the unit is
                   -- open, and the guard below refuses the NULL.
                   WHEN NOT reading.as_percent
                       THEN NULL
                   -- 1 or below and explained by both: provenance decides.
                   WHEN c."originalOfferId" IS NULL
                       THEN round(snap.rate, 2)
                   ELSE round(snap.rate * 100, 2)
               END
           ) AS tax_rate,
           coalesce(li."taxAmount", li."priceGross" - li."priceNet") AS tax_amount
      FROM "contract_line_items" li
      LEFT JOIN "subscription_contracts" c ON c."id" = li."contractId"
      -- The numbers are cast only once all three are known to be JSON numbers,
      -- so a snapshot stating `"vatRate": "19"` reaches the refusal below with
      -- its contract named rather than a cast error that names nothing.
     CROSS JOIN LATERAL (
         SELECT jsonb_typeof(c."priceSnapshot" -> 'vatRate') = 'number'
                AND jsonb_typeof(c."priceSnapshot" -> 'totalNet') = 'number'
                AND jsonb_typeof(c."priceSnapshot" -> 'totalGross') = 'number' AS has_numbers
     ) typed
     CROSS JOIN LATERAL (
         SELECT CASE WHEN typed.has_numbers
                    THEN (c."priceSnapshot" ->> 'vatRate')::numeric END AS rate,
                CASE WHEN typed.has_numbers
                    THEN (c."priceSnapshot" ->> 'totalNet')::numeric END AS net,
                CASE WHEN typed.has_numbers
                    THEN (c."priceSnapshot" ->> 'totalGross')::numeric END AS gross
     ) snap
     CROSS JOIN LATERAL (
         SELECT round(snap.net * (1 + snap.rate / 100), 2) = round(snap.gross, 2) AS as_percent,
                round(snap.net * (1 + snap.rate), 2) = round(snap.gross, 2) AS as_fraction
     ) reading
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
        OR tax_rate IS NULL
        OR tax_rate < 0
        OR tax_rate > 100;

    IF unfillable IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot record the money facts of % contract(s): their priceSnapshot does not state a '
            'currency, or does not state the vatRate, totalNet and totalGross this needs as '
            'numbers, or states a rate of 1 or below whose unit neither its totals nor its size settle, '
            'or yields a rate outside 0-100 (%). The snapshot is the only record of what '
            'was agreed, so this migration will not guess. Repair those snapshots and run it '
            'again. A line named on its own has no contract row at all.',
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
