-- =============================================================================
-- SaaSiCat 1.0 — the test operation is recorded.
-- =============================================================================
--
-- Whether an invoice was issued in a test operation, as the installation's
-- mark said when it was issued (`installation mark --operation test|live`).
-- Every rendering of the invoice reads it from the invoice, never from the
-- mark as it stands later, and a cancellation and its replacement carry the
-- one of the invoice they correct. And whether a contract's confirmation was
-- made in one, as the mark said when it was first rendered; every later
-- rendering and its mail read it from the confirmation's record. Needed where
-- `tenantBilling.chargeJournal.invoices` is configured. Run it BEFORE
-- `db push`, and after `1.0-an-invoice-is-issued.postgres.sql` and
-- `1.0-a-contract-confirmation-is-archived.postgres.sql`, whose
-- `subscription_invoices` and `contract_confirmations` tables it extends:
--
--   psql "$DATABASE_URL" -f 1.0-the-test-operation-is-recorded.postgres.sql
--
-- What it touches, in one transaction:
--
--   `subscription_invoices` — one column, `testOperation`, false unless the
--   invoice was issued in a test operation.
--
--   `contract_confirmations` — one column, `testOperation`, false unless the
--   confirmation was made in a test operation.
--
-- Each table is skipped, with a notice, where it is missing; the other one is
-- extended all the same.
--
-- Nothing is backfilled beyond the default. An invoice issued or a
-- confirmation rendered before this ran was made by a release that marked no
-- document as a test, so it was made live, which the default records.
--
-- Safe to run again: each column is added only where it is missing. On a
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

DO $$
BEGIN
    IF to_regclass('contract_confirmations') IS NULL THEN
        RAISE NOTICE 'contract_confirmations is not present — no operation is recorded on confirmations; run 1.0-a-contract-confirmation-is-archived.postgres.sql first.';
        RETURN;
    END IF;

    ALTER TABLE "contract_confirmations"
        ADD COLUMN IF NOT EXISTS "testOperation" BOOLEAN NOT NULL DEFAULT false;
END
$$;

COMMIT;
