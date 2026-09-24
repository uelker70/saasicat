-- =============================================================================
-- SaaSiCat 1.0 — a subscriber's account records the charges its contracts give.
-- =============================================================================
--
-- The journal of charges: one row per contract line and period, derived from
-- the contract in force, the billing windows and the bookings, and written
-- once (ADR 0012, #276 step 4). Needed where `tenantBilling.chargeJournal` is
-- configured. Run it BEFORE `db push`, and after
-- `1.0-a-contract-names-its-subscriber.postgres.sql`, whose `subscribers`
-- table it points at:
--
--   psql "$DATABASE_URL" -f 1.0-a-subscriber-account-records-its-charges.postgres.sql
--
-- What it touches, in one transaction:
--
--   `subscriber_ledger_entries` — created with its indexes, among them the
--   unique index on (subscriptionId, source, sourceRef, periodStart, origin)
--   that makes a charge derived twice a charge written once, and its foreign
--   keys to `subscribers`, `subscription_contracts` and `contract_line_items`.
--   Skipped, with a notice, where one of those three tables is missing.
--
-- Nothing is backfilled: the first time the platform brings an account up to
-- date it charges the period each subscription is in, and nothing before it.
--
-- Safe to run again: the table and every index are created only where they are
-- missing, and each foreign key only where its name is not taken. On a
-- database created from `reference-schema.postgres.sql` the whole file does
-- nothing at all.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscribers') IS NULL
        OR to_regclass('subscription_contracts') IS NULL
        OR to_regclass('contract_line_items') IS NULL THEN
        RAISE NOTICE 'subscribers, subscription_contracts or contract_line_items is not present — subscriber_ledger_entries is not created; the journal needs contracts and the subscribers they are concluded with.';
        RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS "subscriber_ledger_entries" (
        "id" TEXT NOT NULL,
        "subscriberId" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "subscriptionId" TEXT NOT NULL,
        "contractId" TEXT NOT NULL,
        "contractLineItemId" TEXT NOT NULL,
        "origin" TEXT NOT NULL,
        "source" TEXT NOT NULL,
        "sourceRef" TEXT NOT NULL,
        "periodStart" TIMESTAMP(3) NOT NULL,
        "periodEnd" TIMESTAMP(3) NOT NULL,
        "currency" TEXT NOT NULL,
        "amountNet" DECIMAL(10,2) NOT NULL,
        "bookedAt" TIMESTAMP(3) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "subscriber_ledger_entries_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX IF NOT EXISTS "subscriber_ledger_entries_subscriberId_bookedAt_idx"
        ON "subscriber_ledger_entries"("subscriberId", "bookedAt");
    CREATE INDEX IF NOT EXISTS "subscriber_ledger_entries_contractLineItemId_idx"
        ON "subscriber_ledger_entries"("contractLineItemId");
    -- The name is the one Prisma derives and cuts at 63 characters, so that a
    -- later `db push` finds it rather than creating a second index.
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_ledger_entries_subscriptionId_source_sourceRef_p_key"
        ON "subscriber_ledger_entries"("subscriptionId", "source", "sourceRef", "periodStart", "origin");

    -- `ADD CONSTRAINT` has no `IF NOT EXISTS`.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscriber_ledger_entries')
           AND conname = 'subscriber_ledger_entries_subscriberId_fkey'
    ) THEN
        ALTER TABLE "subscriber_ledger_entries"
            ADD CONSTRAINT "subscriber_ledger_entries_subscriberId_fkey"
            FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscriber_ledger_entries')
           AND conname = 'subscriber_ledger_entries_contractId_fkey'
    ) THEN
        ALTER TABLE "subscriber_ledger_entries"
            ADD CONSTRAINT "subscriber_ledger_entries_contractId_fkey"
            FOREIGN KEY ("contractId") REFERENCES "subscription_contracts"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('subscriber_ledger_entries')
           AND conname = 'subscriber_ledger_entries_contractLineItemId_fkey'
    ) THEN
        ALTER TABLE "subscriber_ledger_entries"
            ADD CONSTRAINT "subscriber_ledger_entries_contractLineItemId_fkey"
            FOREIGN KEY ("contractLineItemId") REFERENCES "contract_line_items"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
