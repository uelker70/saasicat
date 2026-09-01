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
-- The rate needs its unit read rather than assumed. A contract concluded from a
-- checkout offer holds the rate as the offer stated it, and an offer prices its
-- lines as `net * (1 + vatRate)` — a fraction — while a contract frozen from
-- the catalogue holds per cent. The same installation therefore has both in one
-- column, which is the reason `"taxRate"` exists.
--
-- Which unit a snapshot holds is read off that snapshot's own totals: whichever
-- of the two readings explains the gross it recorded is the one it was written
-- in. Where both explain it — a contract for a free plan, whose totals are zero,
-- and every rate explains zero — the contract's own provenance decides:
-- `originalOfferId` is set only where the contract was concluded from an offer,
-- so a null one was frozen from the catalogue and already holds per cent.
-- Falling back to the fraction there turned an ordinary 19 into 1900 and
-- stopped the upgrade of any installation that sells a free plan.
--
-- What it will not do is invent a value. A contract whose snapshot does not
-- state a currency, or does not state the numbers this needs, or yields a rate
-- outside 0–100, stops the migration with a sentence naming the contract —
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
                   WHEN jsonb_typeof(c."priceSnapshot" -> 'vatRate') = 'number'
                        AND jsonb_typeof(c."priceSnapshot" -> 'totalNet') = 'number'
                        AND jsonb_typeof(c."priceSnapshot" -> 'totalGross') = 'number'
                       THEN CASE
                           -- The totals say per cent and cannot be read as a
                           -- fraction.
                           WHEN round(
                                    (c."priceSnapshot" ->> 'totalNet')::numeric
                                        * (1 + (c."priceSnapshot" ->> 'vatRate')::numeric / 100),
                                    2
                                ) = round((c."priceSnapshot" ->> 'totalGross')::numeric, 2)
                                AND round(
                                        (c."priceSnapshot" ->> 'totalNet')::numeric
                                            * (1 + (c."priceSnapshot" ->> 'vatRate')::numeric),
                                        2
                                    ) <> round((c."priceSnapshot" ->> 'totalGross')::numeric, 2)
                               THEN round((c."priceSnapshot" ->> 'vatRate')::numeric, 2)
                           -- And the other way round. It has to exclude the
                           -- per-cent reading in the same way: a total of zero
                           -- is explained by both, and without the exclusion
                           -- this branch answers first and every free contract
                           -- reaches the fraction.
                           WHEN round(
                                    (c."priceSnapshot" ->> 'totalNet')::numeric
                                        * (1 + (c."priceSnapshot" ->> 'vatRate')::numeric),
                                    2
                                ) = round((c."priceSnapshot" ->> 'totalGross')::numeric, 2)
                                AND round(
                                        (c."priceSnapshot" ->> 'totalNet')::numeric
                                            * (1 + (c."priceSnapshot" ->> 'vatRate')::numeric
                                                       / 100),
                                        2
                                    ) <> round((c."priceSnapshot" ->> 'totalGross')::numeric, 2)
                               THEN round((c."priceSnapshot" ->> 'vatRate')::numeric * 100, 2)
                           -- The totals cannot tell the two apart. A contract
                           -- for a free plan is the case that reaches here: its
                           -- totals are both zero, so every rate explains them.
                           -- The contract says where it came from instead, and
                           -- that is a recorded fact rather than an inference —
                           -- a contract frozen from the catalogue holds per
                           -- cent, one concluded from an offer holds the
                           -- fraction the offer priced its lines with.
                           WHEN c."originalOfferId" IS NULL
                               THEN round((c."priceSnapshot" ->> 'vatRate')::numeric, 2)
                           ELSE round((c."priceSnapshot" ->> 'vatRate')::numeric * 100, 2)
                       END
               END
           ) AS tax_rate,
           coalesce(li."taxAmount", li."priceGross" - li."priceNet") AS tax_amount
      FROM "contract_line_items" li
      LEFT JOIN "subscription_contracts" c ON c."id" = li."contractId"
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
            'numbers, or yields a rate outside 0-100 (%). The snapshot is the only record of what '
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
