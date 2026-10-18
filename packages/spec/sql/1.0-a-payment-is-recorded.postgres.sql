-- =============================================================================
-- SaaSiCat 1.0 — a payment is recorded, and a credit paid out.
-- =============================================================================
--
-- What money moved between a subscriber and the operator: the payments the
-- gateway confirmed for an invoice's collection attempts, what each settles of
-- its invoice, the credits a subscriber is owed, the refunds and payouts that
-- pay them out, the reversals that take a payment back and give it back again,
-- and the cases nothing matched (#276 step 6, SC-PRIC-029, SC-PRIC-083,
-- SC-PRIC-084, SC-PRIC-086, SC-ADM-033). Needed where
-- `tenantBilling.chargeJournal.invoices.payments` is configured. Run it BEFORE
-- `db push`, and after `1.0-an-invoice-is-collected.postgres.sql`, whose
-- attempts every payment points at:
--
--   psql "$DATABASE_URL" -f 1.0-a-payment-is-recorded.postgres.sql
--
-- What it touches, in one transaction: seven tables, created with their
-- indexes — among them the unique gateway account and reference of a payment,
-- of a refund and of a reversal, which record each once however often it is
-- reported — and their foreign keys to the subscribers, the invoices and the
-- attempts. Where the five tables of payments, settlements, credits, credit
-- entries and refunds were created by an earlier version of this file, they
-- gain the columns that name a reversal: `reversalId` on the settlements and
-- the credit entries, `originReversalId` on the credits.
--
-- Skipped, with a notice, where `subscription_invoice_collections` is
-- missing. Nothing is backfilled: no payment was recorded before this file.
--
-- Safe to run again: every table and index is created only where it is
-- missing, and a foreign key only where its name is not taken. On a database
-- created from `reference-schema.postgres.sql` the whole file does nothing at
-- all.

BEGIN;

DO $$
DECLARE
    fk RECORD;
BEGIN
    IF to_regclass('subscription_invoice_collections') IS NULL THEN
        RAISE NOTICE 'subscription_invoice_collections is not present — the payments are not created; run 1.0-an-invoice-is-collected.postgres.sql first.';
        RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS "subscriber_payments" (
        "id" TEXT NOT NULL,
        "subscriberId" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "invoiceId" TEXT NOT NULL,
        "collectionId" TEXT NOT NULL,
        "gatewayAccount" TEXT NOT NULL,
        "provider" TEXT NOT NULL,
        "gatewayRef" TEXT NOT NULL,
        "amount" DECIMAL(12,2) NOT NULL,
        "currency" TEXT NOT NULL,
        "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "subscriber_payments_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS "subscription_invoice_settlements" (
        "id" TEXT NOT NULL,
        "invoiceId" TEXT NOT NULL,
        "paymentId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "amount" DECIMAL(12,2) NOT NULL,
        "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "subscription_invoice_settlements_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS "subscriber_credits" (
        "id" TEXT NOT NULL,
        "subscriberId" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "amount" DECIMAL(12,2) NOT NULL,
        "currency" TEXT NOT NULL,
        "originPaymentId" TEXT,
        "originInvoiceId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "subscriber_credits_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS "subscriber_credit_entries" (
        "id" TEXT NOT NULL,
        "creditId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "amount" DECIMAL(12,2) NOT NULL,
        "refundId" TEXT,
        "reference" TEXT,
        "paidOn" DATE,
        "recordedBy" TEXT,
        "note" TEXT,
        "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "subscriber_credit_entries_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS "subscriber_refunds" (
        "id" TEXT NOT NULL,
        "subscriberId" TEXT NOT NULL,
        "paymentId" TEXT NOT NULL,
        "gatewayAccount" TEXT NOT NULL,
        "gatewayRef" TEXT NOT NULL,
        "amount" DECIMAL(12,2) NOT NULL,
        "currency" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "endedAt" TIMESTAMP(3),

        CONSTRAINT "subscriber_refunds_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS "subscriber_reversals" (
        "id" TEXT NOT NULL,
        "subscriberId" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "paymentId" TEXT NOT NULL,
        "gatewayAccount" TEXT NOT NULL,
        "gatewayRef" TEXT NOT NULL,
        "amount" DECIMAL(12,2) NOT NULL,
        "currency" TEXT NOT NULL,
        "fromCredit" DECIMAL(12,2) NOT NULL,
        "reinstated" DECIMAL(12,2) NOT NULL,
        "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "reinstatedAt" TIMESTAMP(3),

        CONSTRAINT "subscriber_reversals_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS "subscriber_reconciliation_cases" (
        "id" TEXT NOT NULL,
        "subscriberId" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "amount" DECIMAL(12,2) NOT NULL,
        "currency" TEXT NOT NULL,
        "paymentId" TEXT NOT NULL,
        "refundId" TEXT,
        "reversalId" TEXT,
        "gatewayAccount" TEXT NOT NULL,
        "gatewayRef" TEXT NOT NULL,
        "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "closedAt" TIMESTAMP(3),
        "closedBy" TEXT,
        "note" TEXT,

        CONSTRAINT "subscriber_reconciliation_cases_pkey" PRIMARY KEY ("id")
    );

    ALTER TABLE "subscription_invoice_settlements" ADD COLUMN IF NOT EXISTS "reversalId" TEXT;
    ALTER TABLE "subscriber_credits" ADD COLUMN IF NOT EXISTS "originReversalId" TEXT;
    ALTER TABLE "subscriber_credit_entries" ADD COLUMN IF NOT EXISTS "reversalId" TEXT;

    CREATE INDEX IF NOT EXISTS "subscriber_payments_invoiceId_idx" ON "subscriber_payments"("invoiceId");
    CREATE INDEX IF NOT EXISTS "subscriber_payments_subscriberId_idx" ON "subscriber_payments"("subscriberId");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_payments_gatewayAccount_gatewayRef_key" ON "subscriber_payments"("gatewayAccount", "gatewayRef");
    CREATE INDEX IF NOT EXISTS "subscription_invoice_settlements_invoiceId_idx" ON "subscription_invoice_settlements"("invoiceId");
    CREATE INDEX IF NOT EXISTS "subscription_invoice_settlements_paymentId_idx" ON "subscription_invoice_settlements"("paymentId");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_credits_originPaymentId_key" ON "subscriber_credits"("originPaymentId");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_credits_originInvoiceId_key" ON "subscriber_credits"("originInvoiceId");
    CREATE INDEX IF NOT EXISTS "subscriber_credits_subscriberId_createdAt_idx" ON "subscriber_credits"("subscriberId", "createdAt");
    CREATE INDEX IF NOT EXISTS "subscriber_credit_entries_creditId_idx" ON "subscriber_credit_entries"("creditId");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_credit_entries_refundId_creditId_kind_key" ON "subscriber_credit_entries"("refundId", "creditId", "kind");
    CREATE INDEX IF NOT EXISTS "subscriber_refunds_paymentId_idx" ON "subscriber_refunds"("paymentId");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_refunds_gatewayAccount_gatewayRef_key" ON "subscriber_refunds"("gatewayAccount", "gatewayRef");
    CREATE INDEX IF NOT EXISTS "subscription_invoice_settlements_reversalId_idx" ON "subscription_invoice_settlements"("reversalId");
    CREATE INDEX IF NOT EXISTS "subscriber_credits_originReversalId_idx" ON "subscriber_credits"("originReversalId");
    CREATE INDEX IF NOT EXISTS "subscriber_credit_entries_reversalId_idx" ON "subscriber_credit_entries"("reversalId");
    CREATE INDEX IF NOT EXISTS "subscriber_reversals_paymentId_idx" ON "subscriber_reversals"("paymentId");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_reversals_gatewayAccount_gatewayRef_key" ON "subscriber_reversals"("gatewayAccount", "gatewayRef");
    CREATE INDEX IF NOT EXISTS "subscriber_reconciliation_cases_reversalId_idx" ON "subscriber_reconciliation_cases"("reversalId");
    CREATE INDEX IF NOT EXISTS "subscriber_reconciliation_cases_closedAt_recordedAt_idx" ON "subscriber_reconciliation_cases"("closedAt", "recordedAt");
    CREATE INDEX IF NOT EXISTS "subscriber_reconciliation_cases_subscriberId_closedAt_idx" ON "subscriber_reconciliation_cases"("subscriberId", "closedAt");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_reconciliation_cases_refundId_key" ON "subscriber_reconciliation_cases"("refundId");

    FOR fk IN
        SELECT * FROM (VALUES
        ('subscriber_payments_subscriberId_fkey', 'subscriber_payments', 'subscriberId', 'subscribers'),
        ('subscriber_payments_invoiceId_fkey', 'subscriber_payments', 'invoiceId', 'subscription_invoices'),
        ('subscriber_payments_collectionId_fkey', 'subscriber_payments', 'collectionId', 'subscription_invoice_collections'),
        ('subscription_invoice_settlements_invoiceId_fkey', 'subscription_invoice_settlements', 'invoiceId', 'subscription_invoices'),
        ('subscription_invoice_settlements_paymentId_fkey', 'subscription_invoice_settlements', 'paymentId', 'subscriber_payments'),
        ('subscriber_credits_subscriberId_fkey', 'subscriber_credits', 'subscriberId', 'subscribers'),
        ('subscriber_credits_originPaymentId_fkey', 'subscriber_credits', 'originPaymentId', 'subscriber_payments'),
        ('subscriber_credits_originInvoiceId_fkey', 'subscriber_credits', 'originInvoiceId', 'subscription_invoices'),
        ('subscriber_credit_entries_creditId_fkey', 'subscriber_credit_entries', 'creditId', 'subscriber_credits'),
        ('subscriber_credit_entries_refundId_fkey', 'subscriber_credit_entries', 'refundId', 'subscriber_refunds'),
        ('subscriber_refunds_subscriberId_fkey', 'subscriber_refunds', 'subscriberId', 'subscribers'),
        ('subscriber_refunds_paymentId_fkey', 'subscriber_refunds', 'paymentId', 'subscriber_payments'),
        ('subscription_invoice_settlements_reversalId_fkey', 'subscription_invoice_settlements', 'reversalId', 'subscriber_reversals'),
        ('subscriber_credits_originReversalId_fkey', 'subscriber_credits', 'originReversalId', 'subscriber_reversals'),
        ('subscriber_credit_entries_reversalId_fkey', 'subscriber_credit_entries', 'reversalId', 'subscriber_reversals'),
        ('subscriber_reversals_subscriberId_fkey', 'subscriber_reversals', 'subscriberId', 'subscribers'),
        ('subscriber_reversals_paymentId_fkey', 'subscriber_reversals', 'paymentId', 'subscriber_payments'),
        ('subscriber_reconciliation_cases_subscriberId_fkey', 'subscriber_reconciliation_cases', 'subscriberId', 'subscribers'),
        ('subscriber_reconciliation_cases_paymentId_fkey', 'subscriber_reconciliation_cases', 'paymentId', 'subscriber_payments'),
        ('subscriber_reconciliation_cases_refundId_fkey', 'subscriber_reconciliation_cases', 'refundId', 'subscriber_refunds'),
        ('subscriber_reconciliation_cases_reversalId_fkey', 'subscriber_reconciliation_cases', 'reversalId', 'subscriber_reversals')
        ) AS keys (name, tbl, col, refers)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I ("id") ON DELETE RESTRICT ON UPDATE CASCADE',
                fk.tbl, fk.name, fk.col, fk.refers
            );
        END IF;
    END LOOP;
END
$$;

COMMIT;
