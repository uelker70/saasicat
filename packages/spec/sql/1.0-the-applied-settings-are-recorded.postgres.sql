-- =============================================================================
-- SaaSiCat 1.0 — the platform records the configuration it applied.
-- =============================================================================
--
-- Two tables, both additive: `applied_settings` holds the one row that says
-- which settings the installation applied at its last start, with a fingerprint
-- and the moment they took effect; `settings_changes` holds one row per start
-- that found the fingerprint moved. The platform writes both at boot and reads
-- them for the read-only settings screen — and for nothing else. The record is
-- a mirror of `config/saas.yaml`, never a source.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-the-applied-settings-are-recorded.postgres.sql
--
-- One row per installation. An installation serves one application and owns
-- its database, so the row's identity is the installation's, and the CHECK is
-- what holds it to one row — the constant default only lands a caller that
-- omits the id on the right one.
--
-- Safe to run again: both tables and the index are created only where they are
-- missing, and the constraint is dropped before it is added because
-- `ADD CONSTRAINT` has no `IF NOT EXISTS`. On a database created from
-- `reference-schema.postgres.sql` the whole file does nothing at all.

BEGIN;

CREATE TABLE IF NOT EXISTS "applied_settings" (
    "id" TEXT NOT NULL DEFAULT 'installation',
    "fingerprint" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applied_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "applied_settings"
    DROP CONSTRAINT IF EXISTS applied_settings_is_a_singleton;
ALTER TABLE "applied_settings"
    ADD CONSTRAINT applied_settings_is_a_singleton CHECK ("id" = 'installation');

CREATE TABLE IF NOT EXISTS "settings_changes" (
    "id" TEXT NOT NULL,
    "noticedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "current" JSONB NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,

    CONSTRAINT "settings_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "settings_changes_acknowledgedAt_noticedAt_idx"
    ON "settings_changes"("acknowledgedAt", "noticedAt");

COMMIT;
