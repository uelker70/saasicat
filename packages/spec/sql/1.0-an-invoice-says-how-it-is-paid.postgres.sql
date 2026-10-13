-- =============================================================================
-- SaaSiCat 1.0 — an invoice says how it is paid.
-- =============================================================================
--
-- What an invoice records of the payment method it is collected with, and the
-- day a direct debit is collected, which the invoice announces and falls due
-- on (#276 step 6, SC-PRIC-028). Needed where
-- `tenantBilling.chargeJournal.invoices` is configured. Run it BEFORE
-- `db push`, and after `1.0-an-invoice-is-issued.postgres.sql`, whose
-- `subscription_invoices` table it extends:
--
--   psql "$DATABASE_URL" -f 1.0-an-invoice-says-how-it-is-paid.postgres.sql
--
-- What it touches, in one transaction:
--
--   `subscription_invoices` — two nullable columns: `payment`, the payment
--   method the invoice is collected with as it stood when the invoice was
--   issued, and `collectionDate`, the day a direct debit is collected from.
--
-- Skipped, with a notice, where `subscription_invoices` is missing.
--
-- Nothing is backfilled. An invoice issued before this ran announced no
-- collection, so it records none: it is not collected, and it stays due on the
-- day it states.
--
-- Safe to run again: each column is added only where it is missing. On a
-- database created from `reference-schema.postgres.sql` the whole file does
-- nothing at all.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscription_invoices') IS NULL THEN
        RAISE NOTICE 'subscription_invoices is not present — no payment is added to invoices; run 1.0-an-invoice-is-issued.postgres.sql first.';
        RETURN;
    END IF;

    ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "payment" JSONB;
    ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "collectionDate" DATE;
END
$$;

COMMIT;
