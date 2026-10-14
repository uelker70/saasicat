-- =============================================================================
-- SaaSiCat 1.0 — an invoice is collected through its payment gateway.
-- =============================================================================
--
-- The attempts to collect an invoice: each request the platform makes of the
-- gateway, with everything it carries, and what became of it, and the attempts
-- planned after a failure or with a payment method that replaced the one the
-- invoice named (#276 step 6, SC-PRIC-034, SC-PRIC-080). Needed where `tenantBilling.chargeJournal.invoices.collections`
-- is configured. Run it BEFORE `db push`, and after
-- `1.0-an-invoice-is-issued.postgres.sql`, whose `subscription_invoices` table
-- every attempt points at:
--
--   psql "$DATABASE_URL" -f 1.0-an-invoice-is-collected.postgres.sql
--
-- What it touches, in one transaction:
--
--   `subscription_invoice_collections` — created with its indexes, among them
--   the unique key of every attempt and the unique (invoiceId, attempt), its
--   foreign key to `subscription_invoices`, and the partial unique index that
--   holds an invoice to one attempt open — planned, or sent and not settled —
--   and none after one succeeded, which `db push` cannot create.
--
-- Skipped, with a notice, where `subscription_invoices` is missing. Nothing is
-- backfilled: an invoice issued before collecting was switched on is collected
-- by the next run where it announced a payment method, and has no attempt
-- until then.
--
-- Safe to run again: the table and every index are created only where they are
-- missing, and the foreign key only where its name is not taken. On a database
-- created from `reference-schema.postgres.sql` the whole file does nothing at
-- all.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscription_invoices') IS NULL THEN
        RAISE NOTICE 'subscription_invoices is not present — the collection attempts are not created; run 1.0-an-invoice-is-issued.postgres.sql first.';
        RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS "subscription_invoice_collections" (
        "id" TEXT NOT NULL,
        "invoiceId" TEXT NOT NULL,
        "attempt" INTEGER NOT NULL,
        "attemptKey" TEXT NOT NULL,
        "gatewayAccount" TEXT NOT NULL,
        "paymentMethodId" TEXT NOT NULL,
        "paymentMethodType" TEXT NOT NULL,
        "customerRef" TEXT NOT NULL,
        "paymentMethodRef" TEXT NOT NULL,
        "invoiceNumber" TEXT NOT NULL,
        "amount" DECIMAL(12,2) NOT NULL,
        "currency" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "paymentRef" TEXT,
        "failureReason" TEXT,
        "failureCode" TEXT,
        "submittedAt" TIMESTAMP(3),
        "heldAt" TIMESTAMP(3),
        "resolvedAt" TIMESTAMP(3),
        "collectOn" DATE,
        "announcedAt" TIMESTAMP(3),
        "followedUpAt" TIMESTAMP(3),
        CONSTRAINT "subscription_invoice_collections_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoice_collections_attemptKey_key"
        ON "subscription_invoice_collections"("attemptKey");
    CREATE INDEX IF NOT EXISTS "subscription_invoice_collections_status_heldAt_idx"
        ON "subscription_invoice_collections"("status", "heldAt");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoice_collections_invoiceId_attempt_key"
        ON "subscription_invoice_collections"("invoiceId", "attempt");
    CREATE UNIQUE INDEX IF NOT EXISTS subscription_invoice_collections_one_open_per_invoice
        ON subscription_invoice_collections ("invoiceId")
        WHERE "status" IN ('SCHEDULED', 'SUBMITTED', 'PENDING', 'SUCCEEDED');
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscription_invoice_collections_invoiceId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoice_collections"
            ADD CONSTRAINT "subscription_invoice_collections_invoiceId_fkey"
            FOREIGN KEY ("invoiceId") REFERENCES "subscription_invoices"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

COMMIT;
