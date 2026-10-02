-- =============================================================================
-- SaaSiCat 1.0 — a retirement is announced.
-- =============================================================================
--
-- One table, additive: `version_retirements` keeps every retirement an operator
-- announces — a plan version ended for the subscriptions already on it, the
-- version they continue on, when and by whom. What it means for each
-- subscription is a `subscription_notices` row of kind `version-retired`, which
-- `1.0-a-subscriber-is-told-once.postgres.sql` creates.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-a-retirement-is-announced.postgres.sql
--
-- The record outlives the catalogue entries it names, so the versions are kept
-- as values and the table has no foreign key: nothing else has to exist for it
-- to be created.
--
-- Safe to run again: the table and its index are created only where they are
-- missing. On a database created from `reference-schema.postgres.sql` the whole
-- file does nothing at all.

BEGIN;

CREATE TABLE IF NOT EXISTS "version_retirements" (
    "id" TEXT NOT NULL,
    "retiredPlanVersionId" TEXT NOT NULL,
    "retiredPlanKey" TEXT NOT NULL,
    "retiredVersion" INTEGER NOT NULL,
    "replacementPlanVersionId" TEXT NOT NULL,
    "replacementPlanKey" TEXT NOT NULL,
    "replacementVersion" INTEGER NOT NULL,
    "announcedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "announcedBy" TEXT NOT NULL,

    CONSTRAINT "version_retirements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "version_retirements_retiredPlanVersionId_idx"
    ON "version_retirements"("retiredPlanVersionId");

COMMIT;
