-- =============================================================================
-- SaaSiCat 1.0 — a tenant's deletion is recorded with its subscriber.
-- =============================================================================
--
-- Three tables, additive (`SC-PRIV-023`, 33-subscriber-tenant-deletion.prisma):
--
--   `subscriber_tenant_deletions` — one row per tenant deleted or being
--   deleted: its subscriber, the end it was deleted for, when it began, what
--   the tenant was told to keep, the subscriber's commercial record counted
--   before and after, the run that holds it, the last failure, why it is
--   halted, and when it closed. At most one row per tenant.
--
--   `subscriber_tenant_deletion_stores` — one row per store of the
--   application's in a deletion, in the order the stores are erased in, with
--   when it counted and when it confirmed.
--
--   `subscriber_tenant_deletion_counts` — what each store held for the tenant
--   before it erased, and what the tenant keeps itself, a number per category.
--
-- The rows name no person, and they are kept with the subscriber rather than
-- the tenant, as its invoices are: the keys restrict, so a subscriber with a
-- deletion cannot be deleted from under it.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one, and after `1.0-a-contract-names-its-subscriber.postgres.sql`,
-- whose `subscribers` table the records point at:
--
--   psql "$DATABASE_URL" -f 1.0-a-tenant-deletion-is-recorded.postgres.sql
--
-- Skipped, with a notice, where `subscribers` is missing.
--
-- The checks are the ones sql/constraints.postgres.sql holds, so a database
-- that gained the tables here is held to them before the constraints run.
--
-- Safe to run again: the tables and their indexes are created only where they
-- are missing, each foreign key only where its name is not taken, and each
-- check is dropped before it is added because `ADD CONSTRAINT` has no
-- `IF NOT EXISTS`. On a database created from `reference-schema.postgres.sql`
-- the whole file changes nothing.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscribers') IS NULL THEN
        RAISE NOTICE 'subscribers is not present — no deletion is recorded without a subscriber to keep it; run this file again after db push.';
        RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS "subscriber_tenant_deletions" (
        "id" TEXT NOT NULL,
        "tenantId" TEXT NOT NULL,
        "subscriberId" TEXT NOT NULL,
        "subscriptionId" TEXT NOT NULL,
        "subscriptionEndId" TEXT NOT NULL,
        "deletesOn" DATE NOT NULL,
        "exportOfferedFrom" TIMESTAMP(3) NOT NULL,
        "exportBlockedBySuspension" BOOLEAN NOT NULL,
        "commercialBefore" JSONB,
        "commercialAfter" JSONB,
        "startedAt" TIMESTAMP(3) NOT NULL,
        "claimedAt" TIMESTAMP(3),
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "lastFailure" JSONB,
        "halt" TEXT,
        "closedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "subscriber_tenant_deletions_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_tenant_deletions_tenantId_key"
        ON "subscriber_tenant_deletions"("tenantId");
    CREATE INDEX IF NOT EXISTS "subscriber_tenant_deletions_subscriberId_idx"
        ON "subscriber_tenant_deletions"("subscriberId");
    CREATE INDEX IF NOT EXISTS "subscriber_tenant_deletions_closedAt_idx"
        ON "subscriber_tenant_deletions"("closedAt");

    CREATE TABLE IF NOT EXISTS "subscriber_tenant_deletion_stores" (
        "id" TEXT NOT NULL,
        "deletionId" TEXT NOT NULL,
        "store" TEXT NOT NULL,
        "position" INTEGER NOT NULL,
        "countedAt" TIMESTAMP(3),
        "erasedAt" TIMESTAMP(3),

        CONSTRAINT "subscriber_tenant_deletion_stores_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_tenant_deletion_stores_deletionId_store_key"
        ON "subscriber_tenant_deletion_stores"("deletionId", "store");
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_tenant_deletion_stores_deletionId_position_key"
        ON "subscriber_tenant_deletion_stores"("deletionId", "position");

    CREATE TABLE IF NOT EXISTS "subscriber_tenant_deletion_counts" (
        "id" TEXT NOT NULL,
        "deletionId" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "store" TEXT,
        "category" TEXT NOT NULL,
        "count" INTEGER NOT NULL,
        "labels" JSONB,

        CONSTRAINT "subscriber_tenant_deletion_counts_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_tenant_deletion_counts_deletionId_kind_store_cat_key"
        ON "subscriber_tenant_deletion_counts"("deletionId", "kind", "store", "category");
    CREATE UNIQUE INDEX IF NOT EXISTS subscriber_tenant_deletion_counts_kept_once_per_category
        ON subscriber_tenant_deletion_counts ("deletionId", "category") WHERE "kind" = 'kept';

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriber_tenant_deletions_subscriberId_fkey'
    ) THEN
        ALTER TABLE "subscriber_tenant_deletions"
            ADD CONSTRAINT "subscriber_tenant_deletions_subscriberId_fkey"
            FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriber_tenant_deletion_stores_deletionId_fkey'
    ) THEN
        ALTER TABLE "subscriber_tenant_deletion_stores"
            ADD CONSTRAINT "subscriber_tenant_deletion_stores_deletionId_fkey"
            FOREIGN KEY ("deletionId") REFERENCES "subscriber_tenant_deletions"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriber_tenant_deletion_counts_deletionId_fkey'
    ) THEN
        ALTER TABLE "subscriber_tenant_deletion_counts"
            ADD CONSTRAINT "subscriber_tenant_deletion_counts_deletionId_fkey"
            FOREIGN KEY ("deletionId") REFERENCES "subscriber_tenant_deletions"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    ALTER TABLE subscriber_tenant_deletions
        DROP CONSTRAINT IF EXISTS subscriber_tenant_deletions_known_halt;
    ALTER TABLE subscriber_tenant_deletions
        ADD CONSTRAINT subscriber_tenant_deletions_known_halt
        CHECK ("halt" IN ('commercial-record-lost'));
    ALTER TABLE subscriber_tenant_deletions
        DROP CONSTRAINT IF EXISTS subscriber_tenant_deletions_attempts_are_counted;
    ALTER TABLE subscriber_tenant_deletions
        ADD CONSTRAINT subscriber_tenant_deletions_attempts_are_counted CHECK ("attempts" >= 0);
    ALTER TABLE subscriber_tenant_deletion_stores
        DROP CONSTRAINT IF EXISTS subscriber_tenant_deletion_stores_position_is_a_place;
    ALTER TABLE subscriber_tenant_deletion_stores
        ADD CONSTRAINT subscriber_tenant_deletion_stores_position_is_a_place CHECK ("position" >= 0);
    ALTER TABLE subscriber_tenant_deletion_counts
        DROP CONSTRAINT IF EXISTS subscriber_tenant_deletion_counts_known_kind;
    ALTER TABLE subscriber_tenant_deletion_counts
        ADD CONSTRAINT subscriber_tenant_deletion_counts_known_kind CHECK ("kind" IN ('erased', 'kept'));
    ALTER TABLE subscriber_tenant_deletion_counts
        DROP CONSTRAINT IF EXISTS subscriber_tenant_deletion_counts_erased_names_its_store;
    ALTER TABLE subscriber_tenant_deletion_counts
        ADD CONSTRAINT subscriber_tenant_deletion_counts_erased_names_its_store
        CHECK (("kind" = 'erased') = ("store" IS NOT NULL));
    ALTER TABLE subscriber_tenant_deletion_counts
        DROP CONSTRAINT IF EXISTS subscriber_tenant_deletion_counts_kept_carries_its_words;
    ALTER TABLE subscriber_tenant_deletion_counts
        ADD CONSTRAINT subscriber_tenant_deletion_counts_kept_carries_its_words
        CHECK (("kind" = 'kept') = ("labels" IS NOT NULL));
    ALTER TABLE subscriber_tenant_deletion_counts
        DROP CONSTRAINT IF EXISTS subscriber_tenant_deletion_counts_count_is_a_number_of_things;
    ALTER TABLE subscriber_tenant_deletion_counts
        ADD CONSTRAINT subscriber_tenant_deletion_counts_count_is_a_number_of_things
        CHECK ("count" >= 0);
END
$$;

COMMIT;
