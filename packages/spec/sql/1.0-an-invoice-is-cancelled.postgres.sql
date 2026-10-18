-- =============================================================================
-- SaaSiCat 1.0 — an issued invoice is corrected by a cancellation invoice.
-- =============================================================================
--
-- An invoice and the invoices that correct it become a chain, a cancellation
-- is recorded with the reason it was given, and what was paid for a cancelled
-- invoice moves onto its replacement (#276 step 6, `SC-PRIC-025`,
-- `SC-PRIC-036`). Needed where `tenantBilling.chargeJournal.invoices` is
-- configured. Run it BEFORE `db push`, after
-- `1.0-an-invoice-is-issued.postgres.sql` and, where invoices are collected,
-- after `1.0-a-payment-is-recorded.postgres.sql`:
--
--   psql "$DATABASE_URL" -f 1.0-an-invoice-is-cancelled.postgres.sql
--
-- Before `db push`, because `db push` cannot give the invoices already issued
-- the chain they begin: it would refuse to add a required column to a table
-- that holds rows.
--
-- What it touches, in one transaction:
--
--   `subscription_invoices` — given `chainId`, the invoice its chain began
--   with, which is the invoice itself for every invoice issued so far, with its
--   index and its foreign key; `chainStep`, 0; and `paidOnIssue`, 0.
--
--   `subscription_invoice_lines` — given `chainStep`, 0, and
--   `correctedPosition`, empty; the unique `chargeId` becomes the unique
--   (`chargeId`, `chainStep`), so a charge can stand on an invoice, its
--   cancellation and its replacement.
--
--   `subscription_invoice_cancellations` — created, with its unique indexes and
--   its foreign keys to `subscription_invoices`.
--
--   `subscription_invoice_settlements` and `subscriber_credits`, where invoices
--   are collected — given `cancellationId` and `originCancellationId` with
--   their indexes and foreign keys; the unique `originPaymentId` of a credit
--   becomes one credit of a payment's own (the partial
--   `subscriber_credits_one_per_payment`) and one per cancellation.
--
-- Skipped, with a notice, where there are no invoices; the part about
-- settlements and credits is skipped, with a notice, where invoices are not
-- collected. Nothing else is backfilled: no invoice was cancelled before this
-- file ran.
--
-- Safe to run again: every column, table and index is created only where it is
-- missing, an index is dropped only where it is there, each foreign key is added
-- only where its name is not taken, and `chainId` is filled only where it is
-- empty. On a database created from `reference-schema.postgres.sql` the whole
-- file does nothing at all.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscription_invoices') IS NULL
        OR to_regclass('subscription_invoice_lines') IS NULL THEN
        RAISE NOTICE 'subscription_invoices is not present — there is no invoice to cancel; invoices are issued from the charge journal.';
        RETURN;
    END IF;

    -- The invoice a chain began with: each invoice issued so far began its own.
    ALTER TABLE "subscription_invoices" ADD COLUMN IF NOT EXISTS "chainId" TEXT;
    UPDATE "subscription_invoices" SET "chainId" = "id" WHERE "chainId" IS NULL;
    ALTER TABLE "subscription_invoices" ALTER COLUMN "chainId" SET NOT NULL;
    ALTER TABLE "subscription_invoices"
        ADD COLUMN IF NOT EXISTS "chainStep" INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE "subscription_invoices"
        ADD COLUMN IF NOT EXISTS "paidOnIssue" DECIMAL(12,2) NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS "subscription_invoices_chainId_idx"
        ON "subscription_invoices"("chainId");
    -- `ADD CONSTRAINT` has no `IF NOT EXISTS`.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_invoices')
           AND conname = 'subscription_invoices_chainId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoices"
            ADD CONSTRAINT "subscription_invoices_chainId_fkey"
            FOREIGN KEY ("chainId") REFERENCES "subscription_invoices"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- A charge stands once on each step of its chain, not once in all.
    ALTER TABLE "subscription_invoice_lines"
        ADD COLUMN IF NOT EXISTS "chainStep" INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE "subscription_invoice_lines"
        ADD COLUMN IF NOT EXISTS "correctedPosition" INTEGER;
    DROP INDEX IF EXISTS "subscription_invoice_lines_chargeId_key";
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoice_lines_chargeId_chainStep_key"
        ON "subscription_invoice_lines"("chargeId", "chainStep");

    CREATE TABLE IF NOT EXISTS "subscription_invoice_cancellations" (
        "id" TEXT NOT NULL,
        "cancelledInvoiceId" TEXT NOT NULL,
        "cancellationInvoiceId" TEXT NOT NULL,
        "replacementInvoiceId" TEXT,
        "reason" TEXT NOT NULL,
        "correctedSubscriber" JSONB,
        "deliverTo" TEXT,
        "cancelledBy" TEXT NOT NULL,
        "cancelledAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "subscription_invoice_cancellations_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoice_cancellations_cancelledInvoiceId_key"
        ON "subscription_invoice_cancellations"("cancelledInvoiceId");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoice_cancellations_cancellationInvoiceId_key"
        ON "subscription_invoice_cancellations"("cancellationInvoiceId");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoice_cancellations_replacementInvoiceId_key"
        ON "subscription_invoice_cancellations"("replacementInvoiceId");
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_invoice_cancellations')
           AND conname = 'subscription_invoice_cancellations_cancelledInvoiceId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoice_cancellations"
            ADD CONSTRAINT "subscription_invoice_cancellations_cancelledInvoiceId_fkey"
            FOREIGN KEY ("cancelledInvoiceId") REFERENCES "subscription_invoices"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_invoice_cancellations')
           AND conname = 'subscription_invoice_cancellations_cancellationInvoiceId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoice_cancellations"
            ADD CONSTRAINT "subscription_invoice_cancellations_cancellationInvoiceId_fkey"
            FOREIGN KEY ("cancellationInvoiceId") REFERENCES "subscription_invoices"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_invoice_cancellations')
           AND conname = 'subscription_invoice_cancellations_replacementInvoiceId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoice_cancellations"
            ADD CONSTRAINT "subscription_invoice_cancellations_replacementInvoiceId_fkey"
            FOREIGN KEY ("replacementInvoiceId") REFERENCES "subscription_invoices"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF to_regclass('subscription_invoice_settlements') IS NULL
        OR to_regclass('subscriber_credits') IS NULL THEN
        RAISE NOTICE 'subscription_invoice_settlements or subscriber_credits is not present — invoices are not collected, so nothing paid can move onto a replacement.';
        RETURN;
    END IF;

    -- What a cancellation moved of a payment from the cancelled invoice onto
    -- the replacement, and the credit it left of what the replacement did not take.
    ALTER TABLE "subscription_invoice_settlements"
        ADD COLUMN IF NOT EXISTS "cancellationId" TEXT;
    CREATE INDEX IF NOT EXISTS "subscription_invoice_settlements_cancellationId_idx"
        ON "subscription_invoice_settlements"("cancellationId");
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_invoice_settlements')
           AND conname = 'subscription_invoice_settlements_cancellationId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoice_settlements"
            ADD CONSTRAINT "subscription_invoice_settlements_cancellationId_fkey"
            FOREIGN KEY ("cancellationId") REFERENCES "subscription_invoice_cancellations"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    ALTER TABLE "subscriber_credits" ADD COLUMN IF NOT EXISTS "originCancellationId" TEXT;
    -- A payment's own credit stays one; a cancellation may leave it one more.
    DROP INDEX IF EXISTS "subscriber_credits_originPaymentId_key";
    CREATE INDEX IF NOT EXISTS "subscriber_credits_originPaymentId_idx"
        ON "subscriber_credits"("originPaymentId");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_credits_originCancellationId_originPaymentId_key"
        ON "subscriber_credits"("originCancellationId", "originPaymentId");
    CREATE UNIQUE INDEX IF NOT EXISTS subscriber_credits_one_per_payment
        ON subscriber_credits ("originPaymentId")
        WHERE "originCancellationId" IS NULL;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscriber_credits')
           AND conname = 'subscriber_credits_originCancellationId_fkey'
    ) THEN
        ALTER TABLE "subscriber_credits"
            ADD CONSTRAINT "subscriber_credits_originCancellationId_fkey"
            FOREIGN KEY ("originCancellationId") REFERENCES "subscription_invoice_cancellations"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
