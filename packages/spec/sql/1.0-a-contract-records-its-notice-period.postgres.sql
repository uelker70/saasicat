-- =============================================================================
-- SaaSiCat 1.0 — a contract records the notice period it was concluded with.
-- =============================================================================
--
-- `subscription_contracts` gains "cancellationNoticeDays": the days of notice a
-- cancellation of the contract is judged by, in its rhythm, as
-- `config/saas.yaml#tenantBilling.cancellationNoticeDays` named them when the
-- contract was concluded or changed (`SC-CANC-026`). It is NOT NULL in the
-- shipped fragment, which `prisma db push` cannot produce on a table that
-- already holds rows, so this file adds it nullable, fills it and only then
-- tightens it. Run it BEFORE `db push`, after
-- `1.0-a-contract-names-its-subscriber.postgres.sql`.
--
-- Where the values come from. A contract written before this release recorded
-- no notice period, and this file cannot read `config/saas.yaml`. Name the two
-- numbers the file names, for the session, and each contract gets the one of
-- its rhythm, read from its `priceSnapshot`:
--
--   psql "$DATABASE_URL" \
--        -c "SET saasicat.cancellation_notice_days_monthly = 14" \
--        -c "SET saasicat.cancellation_notice_days_yearly = 90" \
--        -f 1.0-a-contract-records-its-notice-period.postgres.sql
--
-- A runner of one's own sets them the same way, with `SET` in the session
-- before it runs the file, or through any libpq client's environment:
--
--   PGOPTIONS="-c saasicat.cancellation_notice_days_monthly=14 -c saasicat.cancellation_notice_days_yearly=90"
--
-- Without them the file refuses where a contract is there to fill, and goes
-- through where none is. A value that is no whole number of days, or more of
-- them than the column holds, a contract
-- whose snapshot names no rhythm a notice period is kept for, and a table that
-- row-level security hides rows of from this role each stop it with a sentence
-- naming what to do. Nothing is filled then.
--
-- Also the check `subscription_contracts_notice_is_days` from
-- `constraints.postgres.sql`: the days are at least none.
--
-- Skipped, with a notice, where `subscription_contracts` is not there.
--
-- Safe to run again: the column is added only where it is missing, only rows
-- without a value are filled, so a second run needs neither setting, tightening
-- a column that is already NOT NULL is a no-op, and the check is dropped and
-- added again. On a database created from `reference-schema.postgres.sql` the
-- whole file leaves the schema as it found it.

BEGIN;

DO $$
DECLARE
    monthly_text text := nullif(current_setting('saasicat.cancellation_notice_days_monthly', true), '');
    yearly_text text := nullif(current_setting('saasicat.cancellation_notice_days_yearly', true), '');
    unfilled integer := 0;
    unknown_rhythm text[];
    still_nullable boolean;
BEGIN
    IF to_regclass('subscription_contracts') IS NULL THEN
        RAISE NOTICE 'subscription_contracts is not present — no contracts, so none records a notice period.';
        RETURN;
    END IF;

    ALTER TABLE "subscription_contracts" ADD COLUMN IF NOT EXISTS "cancellationNoticeDays" INTEGER;

    SELECT NOT attnotnull INTO still_nullable
      FROM pg_attribute
     WHERE attrelid = to_regclass('subscription_contracts')
       AND attname = 'cancellationNoticeDays';

    -- Once the column is required no contract is without a value, so a
    -- second run asks nothing of the rows and nothing of the role.
    IF still_nullable THEN
        -- A table under row-level security shows this role only the rows its
        -- policies allow — the count below included —, and a hidden contract
        -- left without its notice period would fail the tightening with a
        -- message about null values.
        IF EXISTS (
            SELECT 1 FROM pg_class c
             WHERE c.oid = to_regclass('subscription_contracts')
               AND c.relrowsecurity
               AND (c.relforcerowsecurity OR NOT pg_has_role(current_user, c.relowner, 'USAGE'))
               AND NOT EXISTS (
                   SELECT 1 FROM pg_roles r
                    WHERE r.rolname = current_user AND (r.rolsuper OR r.rolbypassrls)
               )
        ) THEN
            RAISE EXCEPTION 'Cannot see every row of subscription_contracts under row-level security as role %, so a contract it hides would be left without its notice period. Run this file as a role that bypasses row-level security. Nothing was filled.', current_user;
        END IF;

        SELECT count(*) INTO unfilled
          FROM "subscription_contracts" WHERE "cancellationNoticeDays" IS NULL;
    END IF;

    IF unfilled > 0 THEN
        IF monthly_text IS NULL OR yearly_text IS NULL THEN
            RAISE EXCEPTION 'subscription_contracts holds % contracts without the notice period they were concluded with, and this file cannot read config/saas.yaml. Set both numbers tenantBilling.cancellationNoticeDays names for the session, as SET saasicat.cancellation_notice_days_monthly = <days> and SET saasicat.cancellation_notice_days_yearly = <days>, and run this file again. Nothing was filled.', unfilled;
        END IF;
        IF monthly_text !~ '^[0-9]+$' OR yearly_text !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'The notice periods set for the session are % monthly and % yearly, and each is a whole number of days, at least none, as tenantBilling.cancellationNoticeDays names it. Nothing was filled.', monthly_text, yearly_text;
        END IF;
        -- The file sets no ceiling, and the column holds what an integer does.
        IF monthly_text::numeric > 2147483647 OR yearly_text::numeric > 2147483647 THEN
            RAISE EXCEPTION 'The notice periods set for the session are % monthly and % yearly, and a contract records at most 2147483647 days. Nothing was filled.', monthly_text, yearly_text;
        END IF;

        SELECT array_agg("id" ORDER BY "id") INTO unknown_rhythm
          FROM "subscription_contracts"
         WHERE "cancellationNoticeDays" IS NULL
           AND coalesce("priceSnapshot"->>'billingCycle', '') NOT IN ('monthly', 'yearly');
        IF unknown_rhythm IS NOT NULL THEN
            RAISE EXCEPTION 'The contracts % name no rhythm a notice period is kept for — their priceSnapshot has no billingCycle of monthly or yearly. Give each its rhythm, and run this file again. Nothing was filled.', array_to_string(unknown_rhythm, ', ');
        END IF;

        UPDATE "subscription_contracts"
           SET "cancellationNoticeDays" = CASE "priceSnapshot"->>'billingCycle'
                   WHEN 'yearly' THEN yearly_text::integer
                   ELSE monthly_text::integer
               END
         WHERE "cancellationNoticeDays" IS NULL;
    END IF;

    ALTER TABLE "subscription_contracts" ALTER COLUMN "cancellationNoticeDays" SET NOT NULL;

    -- Dropped before it is added: `ADD CONSTRAINT` has no `IF NOT EXISTS`, and a
    -- check of its name that asks for something else would otherwise stay.
    ALTER TABLE "subscription_contracts"
        DROP CONSTRAINT IF EXISTS "subscription_contracts_notice_is_days";
    ALTER TABLE "subscription_contracts"
        ADD CONSTRAINT "subscription_contracts_notice_is_days" CHECK ("cancellationNoticeDays" >= 0);
END
$$;

COMMIT;
