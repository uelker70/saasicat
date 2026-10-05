-- =============================================================================
-- SaaSiCat 1.0 — a sign-up keeps whether it is a business, and its VAT id check.
-- =============================================================================
--
-- Where `config/saas.yaml` names a tax adapter, step 4 of a sign-up asks
-- whether it is a business, and checks the VAT identification number before
-- the payment form opens, where the adapter needs a validated one (ADR 0013).
-- The subscriber the sign-up becomes takes both over. Run it BEFORE
-- `db push`:
--
--   psql "$DATABASE_URL" -f 1.0-a-sign-up-keeps-its-vat-id-check.postgres.sql
--
-- What it touches, in one transaction: `"PendingRegistration"` — two nullable
-- columns, `business` and `vatIdCheck`. Skipped, with a notice, where the
-- table is missing.
--
-- Nothing is backfilled. A sign-up that passed step 4 before this file has no
-- business status and no check; where an adapter needs either, its contract is
-- refused at activation as it would have been before, and the person repeats
-- step 4.
--
-- Safe to run again: each column is added only where it is missing. On a
-- database created from `reference-schema.postgres.sql` the whole file does
-- nothing at all.

BEGIN;

DO $$
BEGIN
    IF to_regclass('"PendingRegistration"') IS NULL THEN
        RAISE NOTICE 'PendingRegistration is not present — nothing is added; it belongs to self-registration.';
    ELSE
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "business" BOOLEAN;
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "vatIdCheck" JSONB;
    END IF;
END $$;

COMMIT;
