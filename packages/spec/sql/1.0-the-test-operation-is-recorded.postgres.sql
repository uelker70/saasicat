-- =============================================================================
-- SaaSiCat 1.0 — the test operation is recorded.
-- =============================================================================
--
-- Whether an invoice was issued in a test operation, as the installation's
-- mark said when it was issued (`installation mark --operation test|live`).
-- Every rendering of the invoice reads it from the invoice, never from the
-- mark as it stands later, and a cancellation and its replacement carry the
-- one of the invoice they correct. Needed where
-- `tenantBilling.chargeJournal.invoices` is configured. Run it BEFORE
-- `db push`, and after `1.0-an-invoice-is-issued.postgres.sql`, whose
-- `subscription_invoices` table it extends:
--
--   psql "$DATABASE_URL" -f 1.0-the-test-operation-is-recorded.postgres.sql
--
-- What it touches, in one transaction:
--
--   `subscription_invoices` — one column, `testOperation`, false unless the
--   invoice was issued in a test operation.
--
-- Skipped, with a notice, where `subscription_invoices` is missing.
--
-- Nothing is backfilled beyond the default. An invoice issued before this ran
-- was issued by a release that marked no document as a test, so it was issued
-- live, which the default records.
--
-- Safe to run again: the column is added only where it is missing. On a
-- database created from `reference-schema.postgres.sql` the whole file does
-- nothing at all.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscription_invoices') IS NULL THEN
        RAISE NOTICE 'subscription_invoices is not present — no operation is recorded on invoices; run 1.0-an-invoice-is-issued.postgres.sql first.';
        RETURN;
    END IF;

    ALTER TABLE "subscription_invoices"
        ADD COLUMN IF NOT EXISTS "testOperation" BOOLEAN NOT NULL DEFAULT false;
END
$$;

COMMIT;
