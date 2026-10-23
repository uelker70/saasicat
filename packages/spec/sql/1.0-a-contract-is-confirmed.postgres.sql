-- =============================================================================
-- SaaSiCat 1.0 — every contract written from now on is confirmed.
-- =============================================================================
--
-- `subscription_contracts."confirmationDue"` says whether a contract is due a
-- confirmation (`SC-AUD-016`, 26-contract-confirmation.prisma). Fragment 08
-- declares it `NOT NULL DEFAULT true`, which `db push` would add as true on
-- every contract already there — and a contract written before this release
-- gets no confirmation. So this file adds it false on those, and then makes
-- true the default for every contract written after. Run it once, BEFORE
-- `db push`:
--
--   psql "$DATABASE_URL" -f 1.0-a-contract-is-confirmed.postgres.sql
--
-- Skipped, with a notice, where `subscription_contracts` is not there: with no
-- contracts there is none to leave unconfirmed, and `db push` adds the column.
--
-- Safe to run again: the column is added only where it is missing, so a
-- contract written in between keeps the value it was written with, and the
-- default is set to what it already is.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscription_contracts') IS NULL THEN
        RAISE NOTICE 'subscription_contracts is not present — no contracts, so none is left unconfirmed.';
        RETURN;
    END IF;
    ALTER TABLE "subscription_contracts"
        ADD COLUMN IF NOT EXISTS "confirmationDue" BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE "subscription_contracts" ALTER COLUMN "confirmationDue" SET DEFAULT true;
END
$$;

COMMIT;
