-- =============================================================================
-- SaaSiCat 1.0 — a subscriber has a tax origin, and a contract its treatment.
-- =============================================================================
--
-- What a tax adapter decides from, and where its answers are kept (ADR 0013).
-- Run it BEFORE `db push`, and after
-- `1.0-a-contract-names-its-subscriber.postgres.sql`, whose `subscribers`
-- table it extends:
--
--   psql "$DATABASE_URL" -f 1.0-a-subscriber-has-a-tax-origin.postgres.sql
--
-- What it touches, in one transaction:
--
--   `subscribers` — three nullable columns: `business`, whether the
--   subscriber is a business; `currentVatIdCheckId`, which recorded check of
--   its VAT id counts now; and `vatIdSince`, since when it holds that VAT id.
--
--   `subscriber_tax_origin_changes` — created with its indexes and its foreign
--   key to `subscribers`: every change of a subscriber's country, business
--   status or VAT id, numbered in the order it was written, with why where the
--   write states it.
--
--   `subscriber_vat_id_checks` — created with its index and its foreign key to
--   `subscribers`: every completed check of a subscriber's VAT id, never
--   rewritten.
--
--   `subscription_contracts` — one nullable column, `taxTreatment`: the
--   treatment the tax adapter decided when the contract was concluded.
--
-- Each part is skipped, with a notice, where its table is missing.
--
-- Nothing is backfilled. A subscriber's business status stays unknown until
-- sign-up or the operator records it, no VAT id counts as checked until it is
-- checked, and a contract concluded before records no treatment: each of its
-- invoices takes the adapter's answer when it is issued.
--
-- Safe to run again: each column, table and index is created only where it is
-- missing, and each foreign key only where its name is not taken. On a
-- database created from `reference-schema.postgres.sql` the whole file does
-- nothing at all.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscribers') IS NULL THEN
        RAISE NOTICE 'subscribers is not present — no tax origin is added; it belongs to the subscribers contracts are concluded with.';
    ELSE
        ALTER TABLE "subscribers" ADD COLUMN IF NOT EXISTS "business" BOOLEAN;
        ALTER TABLE "subscribers" ADD COLUMN IF NOT EXISTS "currentVatIdCheckId" TEXT;
        ALTER TABLE "subscribers" ADD COLUMN IF NOT EXISTS "vatIdSince" TIMESTAMP(3);

        CREATE TABLE IF NOT EXISTS "subscriber_tax_origin_changes" (
            "id" TEXT NOT NULL,
            "seq" SERIAL NOT NULL,
            "subscriberId" TEXT NOT NULL,
            "previous" JSONB NOT NULL,
            "changed" JSONB NOT NULL,
            "changedBy" TEXT NOT NULL,
            "changedAt" TIMESTAMP(3) NOT NULL,
            "reason" TEXT,
            CONSTRAINT "subscriber_tax_origin_changes_pkey" PRIMARY KEY ("id")
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_tax_origin_changes_seq_key"
            ON "subscriber_tax_origin_changes"("seq");
        CREATE INDEX IF NOT EXISTS "subscriber_tax_origin_changes_subscriberId_seq_idx"
            ON "subscriber_tax_origin_changes"("subscriberId", "seq");

        CREATE TABLE IF NOT EXISTS "subscriber_vat_id_checks" (
            "id" TEXT NOT NULL,
            "subscriberId" TEXT NOT NULL,
            "vatId" TEXT NOT NULL,
            "checkedAt" TIMESTAMP(3) NOT NULL,
            "valid" BOOLEAN NOT NULL,
            "service" TEXT NOT NULL,
            "confirmation" JSONB NOT NULL,
            "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "subscriber_vat_id_checks_pkey" PRIMARY KEY ("id")
        );
        CREATE INDEX IF NOT EXISTS "subscriber_vat_id_checks_subscriberId_checkedAt_idx"
            ON "subscriber_vat_id_checks"("subscriberId", "checkedAt");

        -- `ADD CONSTRAINT` has no `IF NOT EXISTS`.
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conrelid = to_regclass('subscriber_tax_origin_changes')
               AND conname = 'subscriber_tax_origin_changes_subscriberId_fkey'
        ) THEN
            ALTER TABLE "subscriber_tax_origin_changes"
                ADD CONSTRAINT "subscriber_tax_origin_changes_subscriberId_fkey"
                FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
                ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conrelid = to_regclass('subscriber_vat_id_checks')
               AND conname = 'subscriber_vat_id_checks_subscriberId_fkey'
        ) THEN
            ALTER TABLE "subscriber_vat_id_checks"
                ADD CONSTRAINT "subscriber_vat_id_checks_subscriberId_fkey"
                FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
                ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
    END IF;

    IF to_regclass('subscription_contracts') IS NULL THEN
        RAISE NOTICE 'subscription_contracts is not present — no contract records a tax treatment.';
    ELSE
        ALTER TABLE "subscription_contracts" ADD COLUMN IF NOT EXISTS "taxTreatment" JSONB;
    END IF;
END $$;

COMMIT;
