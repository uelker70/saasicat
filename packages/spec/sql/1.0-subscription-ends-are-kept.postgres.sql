-- =============================================================================
-- SaaSiCat 1.0 — the end of each subscription, and its deletion day, are kept.
-- =============================================================================
--
-- Three tables, additive:
--
-- `subscription_ends` holds one row per subscription that ended, with the
-- installation's day its tenant's data is deleted on (`SC-CANC-027`). The
-- platform records an end once it learns that the subscription's cancellation
-- has landed.
--
-- `subscription_end_announcements` holds one row per subscription whose
-- cancellation was confirmed with a deletion day: the day the tenant was told,
-- and the read-only period it was counted with. It is written at confirmation,
-- before the cancellation lands, and the end is later recorded with that day.
--
-- `tenant_export_downloads` holds one row per download of a tenant's full
-- export taken after its subscription ended: when, by which of the tenant's
-- administrators, and how many bytes. A second download is a row of its own.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-subscription-ends-are-kept.postgres.sql
--
-- A subscription that ended before this release is recorded by the platform's
-- first run after it, its deletion day counted from that run's day rather than
-- from the day it ended: nobody is given less than the read-only period's
-- notice. A cancellation confirmed before this release has no announcement and
-- none is made up for it; its day is counted when its end is recorded.
--
-- The unique keys on `subscriptionId` are what hold each subscription to one
-- end and one announcement. The downloads have none: every download counts.
--
-- Safe to run again: the tables and their indexes are created only where they
-- are missing. On a database created from `reference-schema.postgres.sql` the
-- file changes nothing.

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

CREATE TABLE IF NOT EXISTS "subscription_end_announcements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "readOnlyDays" INTEGER NOT NULL,
    "deletesOn" DATE NOT NULL,
    "announcedAt" TIMESTAMP(3) NOT NULL,
    "announcedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_end_announcements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_end_announcements_subscriptionId_key"
    ON "subscription_end_announcements"("subscriptionId");

CREATE INDEX IF NOT EXISTS "subscription_end_announcements_tenantId_idx"
    ON "subscription_end_announcements"("tenantId");

CREATE TABLE IF NOT EXISTS "tenant_export_downloads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL,
    "downloadedBy" TEXT NOT NULL,
    "downloadedByUserId" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_export_downloads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tenant_export_downloads_subscriptionId_idx"
    ON "tenant_export_downloads"("subscriptionId");

COMMIT;
