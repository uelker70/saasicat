-- =============================================================================
-- SaaSiCat 1.0 — an add-on retirement is announced.
-- =============================================================================
--
-- One table, additive: `bundle_version_retirements` keeps every add-on
-- retirement an operator announces — an add-on version ended for the bookings
-- already on it, the version of the same add-on they continue on, when and by
-- whom. What it means for each booking is a `subscription_notices` row of kind
-- `bundle-version-retired`, which `1.0-a-subscriber-is-told-once.postgres.sql`
-- creates.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-an-add-on-retirement-is-announced.postgres.sql
--
-- The record outlives the catalogue entries it names, so the versions are kept
-- as values and the table has no foreign key: nothing else has to exist for it
-- to be created.
--
-- Safe to run again: the table and its index are created only where they are
-- missing. On a database created from `reference-schema.postgres.sql` the whole
-- file does nothing at all.

BEGIN;

CREATE TABLE IF NOT EXISTS "bundle_version_retirements" (
    "id" TEXT NOT NULL,
    "retiredBundleVersionId" TEXT NOT NULL,
    "retiredBundleKey" TEXT NOT NULL,
    "retiredVersion" INTEGER NOT NULL,
    "replacementBundleVersionId" TEXT NOT NULL,
    "replacementBundleKey" TEXT NOT NULL,
    "replacementVersion" INTEGER NOT NULL,
    "announcedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "announcedBy" TEXT NOT NULL,

    CONSTRAINT "bundle_version_retirements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bundle_version_retirements_retiredBundleVersionId_idx"
    ON "bundle_version_retirements"("retiredBundleVersionId");

COMMIT;
