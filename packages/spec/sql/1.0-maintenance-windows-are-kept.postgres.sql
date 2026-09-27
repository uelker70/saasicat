-- =============================================================================
-- SaaSiCat 1.0 — maintenance windows are kept.
-- =============================================================================
--
-- One table, additive: `maintenance_windows` holds one row per maintenance
-- window — announced to the tenants, locked while a deploy runs, ended when the
-- operator unlocks. The platform reads it on every request while it is turned
-- on (`maintenance` in `SaaSiCatModule.forRoot`), through a cache of a few
-- seconds.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-maintenance-windows-are-kept.postgres.sql
--
-- Apply it in an ordinary deploy, BEFORE the first deploy you lock: the lock
-- protects a deploy only when the version already running reads it, so the
-- table has to be there, and that version with it, before it is needed.
--
-- The index on a constant is what holds an installation to one open window:
-- every open row carries the same key, so a second one collides, and a window
-- that ended leaves the index.
--
-- Safe to run again: the table and both indexes are created only where they are
-- missing. On a database created from `reference-schema.postgres.sql` the whole
-- file does nothing at all.

BEGIN;

CREATE TABLE IF NOT EXISTS "maintenance_windows" (
    "id" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedBy" TEXT,

    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "maintenance_windows_createdAt_idx"
    ON "maintenance_windows"("createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_windows_one_open
    ON maintenance_windows ((true)) WHERE "endedAt" IS NULL;

COMMIT;
