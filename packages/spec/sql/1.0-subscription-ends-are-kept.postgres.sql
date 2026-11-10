-- =============================================================================
-- SaaSiCat 1.0 — the end of each subscription, and its deletion day, are kept.
-- =============================================================================
--
-- One table, additive: `subscription_ends` holds one row per subscription that
-- ended, with the installation's day its tenant's data is deleted on
-- (`SC-CANC-027`). The platform records an end once it learns that the
-- subscription's cancellation has landed.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-subscription-ends-are-kept.postgres.sql
--
-- A subscription that ended before this release is recorded by the platform's
-- first run after it, its deletion day counted from that run's day rather than
-- from the day it ended: nobody is given less than the read-only period's
-- notice.
--
-- The unique key on `subscriptionId` is what holds each subscription to one
-- end.
--
-- Safe to run again: the table and its indexes are created only where they are
-- missing. On a database created from `reference-schema.postgres.sql` the file
-- changes nothing.

BEGIN;

CREATE TABLE IF NOT EXISTS "subscription_ends" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "deletesOn" DATE NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_ends_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_ends_subscriptionId_key"
    ON "subscription_ends"("subscriptionId");

CREATE INDEX IF NOT EXISTS "subscription_ends_tenantId_idx"
    ON "subscription_ends"("tenantId");

COMMIT;
