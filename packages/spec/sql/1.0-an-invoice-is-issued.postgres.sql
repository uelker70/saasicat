-- =============================================================================
-- SaaSiCat 1.0 — an invoice is issued from the charge journal.
-- =============================================================================
--
-- The invoices the platform issues from a subscriber's charges, their lines,
-- and the one number range they are numbered in (#276 step 6). Needed where
-- `tenantBilling.chargeJournal.invoices` is configured. Run it BEFORE `db push`,
-- and after `1.0-a-subscriber-account-records-its-charges.postgres.sql`, whose
-- `subscriber_ledger_entries` table every line points at:
--
--   psql "$DATABASE_URL" -f 1.0-an-invoice-is-issued.postgres.sql
--
-- What it touches, in one transaction:
--
--   `subscription_invoices` — created with its indexes, among them the unique
--   number and the unique (numberYear, numberSequence), and its foreign keys to
--   `subscribers` and `subscription_contracts`.
--
--   `subscription_invoice_lines` — created with its indexes, among them the
--   unique `chargeId` that puts a charge on one invoice only, and its foreign
--   keys to `subscription_invoices`, `subscriber_ledger_entries` and
--   `contract_line_items`.
--
--   `subscription_invoice_numbers` — created: one row per year, holding the last
--   number drawn.
--
-- Skipped, with a notice, where one of the tables the invoices point at is
-- missing. Nothing is backfilled: no invoice is issued for a charge before
-- invoicing is switched on, and the range starts at 1.
--
-- Safe to run again: every table and index is created only where it is
-- missing, and each foreign key only where its name is not taken. On a
-- database created from `reference-schema.postgres.sql` the whole file does
-- nothing at all.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscribers') IS NULL
        OR to_regclass('subscription_contracts') IS NULL
        OR to_regclass('contract_line_items') IS NULL
        OR to_regclass('subscriber_ledger_entries') IS NULL THEN
        RAISE NOTICE 'subscribers, subscription_contracts, contract_line_items or subscriber_ledger_entries is not present — the invoice tables are not created; an invoice is issued from the charge journal.';
        RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS "subscription_invoices" (
        "id" TEXT NOT NULL,
        "number" TEXT NOT NULL,
        "numberPrefix" TEXT NOT NULL,
        "numberYear" INTEGER NOT NULL,
        "numberSequence" INTEGER NOT NULL,
        "tenantId" TEXT NOT NULL,
        "subscriberId" TEXT NOT NULL,
        "subscriptionId" TEXT NOT NULL,
        "contractId" TEXT NOT NULL,
        "issuedAt" TIMESTAMP(3) NOT NULL,
        "issueDate" DATE NOT NULL,
        "dueDate" DATE NOT NULL,
        "servicePeriodFrom" DATE NOT NULL,
        "servicePeriodUntil" DATE NOT NULL,
        "currency" TEXT NOT NULL,
        "issuerParty" JSONB NOT NULL,
        "subscriberParty" JSONB NOT NULL,
        "taxTreatment" JSONB NOT NULL,
        "taxes" JSONB NOT NULL,
        "totalNet" DECIMAL(12,2) NOT NULL,
        "totalTax" DECIMAL(12,2) NOT NULL,
        "totalGross" DECIMAL(12,2) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoices_number_key"
        ON "subscription_invoices"("number");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoices_numberYear_numberSequence_key"
        ON "subscription_invoices"("numberYear", "numberSequence");
    CREATE INDEX IF NOT EXISTS "subscription_invoices_subscriberId_issuedAt_idx"
        ON "subscription_invoices"("subscriberId", "issuedAt");
    CREATE INDEX IF NOT EXISTS "subscription_invoices_subscriptionId_idx"
        ON "subscription_invoices"("subscriptionId");

    CREATE TABLE IF NOT EXISTS "subscription_invoice_lines" (
        "id" TEXT NOT NULL,
        "invoiceId" TEXT NOT NULL,
        "position" INTEGER NOT NULL,
        "chargeId" TEXT NOT NULL,
        "contractLineItemId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "origin" TEXT NOT NULL,
        "source" TEXT NOT NULL,
        "periodFrom" DATE NOT NULL,
        "periodUntil" DATE NOT NULL,
        "amountNet" DECIMAL(10,2) NOT NULL,
        "taxRate" DECIMAL(5,2) NOT NULL,
        CONSTRAINT "subscription_invoice_lines_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoice_lines_chargeId_key"
        ON "subscription_invoice_lines"("chargeId");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscription_invoice_lines_invoiceId_position_key"
        ON "subscription_invoice_lines"("invoiceId", "position");
    CREATE INDEX IF NOT EXISTS "subscription_invoice_lines_contractLineItemId_idx"
        ON "subscription_invoice_lines"("contractLineItemId");

    CREATE TABLE IF NOT EXISTS "subscription_invoice_numbers" (
        "year" INTEGER NOT NULL,
        "last" INTEGER NOT NULL,
        CONSTRAINT "subscription_invoice_numbers_pkey" PRIMARY KEY ("year")
    );

    -- `ADD CONSTRAINT` has no `IF NOT EXISTS`.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_invoices')
           AND conname = 'subscription_invoices_subscriberId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoices"
            ADD CONSTRAINT "subscription_invoices_subscriberId_fkey"
            FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_invoices')
           AND conname = 'subscription_invoices_contractId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoices"
            ADD CONSTRAINT "subscription_invoices_contractId_fkey"
            FOREIGN KEY ("contractId") REFERENCES "subscription_contracts"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_invoice_lines')
           AND conname = 'subscription_invoice_lines_invoiceId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoice_lines"
            ADD CONSTRAINT "subscription_invoice_lines_invoiceId_fkey"
            FOREIGN KEY ("invoiceId") REFERENCES "subscription_invoices"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_invoice_lines')
           AND conname = 'subscription_invoice_lines_chargeId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoice_lines"
            ADD CONSTRAINT "subscription_invoice_lines_chargeId_fkey"
            FOREIGN KEY ("chargeId") REFERENCES "subscriber_ledger_entries"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscription_invoice_lines')
           AND conname = 'subscription_invoice_lines_contractLineItemId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoice_lines"
            ADD CONSTRAINT "subscription_invoice_lines_contractLineItemId_fkey"
            FOREIGN KEY ("contractLineItemId") REFERENCES "contract_line_items"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
