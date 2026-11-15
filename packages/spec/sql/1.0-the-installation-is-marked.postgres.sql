-- =============================================================================
-- SaaSiCat 1.0 — the database names the installation it belongs to.
-- =============================================================================
--
-- One table, additive: `installation_marks` holds the one row that names the
-- installation this database belongs to, when it was marked and by whom. A
-- tenant's deletion runs only where that identifier is the one the process's
-- environment names, so a process meant for another environment, started
-- against a copy of this database, deletes nothing.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-the-installation-is-marked.postgres.sql
--
-- The file creates the table and leaves it empty. Nothing is deleted until the
-- operator marks the database with `<app> installation mark <identifier>` —
-- no start writes the row, so that a process started against a shared
-- database after this migration cannot claim it for its own environment.
--
-- One row per installation. The CHECK is what holds it to one row, the
-- constant default only lands a caller that omits the id on the right one.
--
-- Safe to run again: the table is created only where it is missing, and the
-- constraint is dropped before it is added because `ADD CONSTRAINT` has no
-- `IF NOT EXISTS`. On a database created from `reference-schema.postgres.sql`
-- the whole file does nothing at all.

BEGIN;

CREATE TABLE IF NOT EXISTS "installation_marks" (
    "id" TEXT NOT NULL DEFAULT 'installation',
    "identifier" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL,
    "markedBy" TEXT NOT NULL,

    CONSTRAINT "installation_marks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "installation_marks"
    DROP CONSTRAINT IF EXISTS installation_marks_is_a_singleton;
ALTER TABLE "installation_marks"
    ADD CONSTRAINT installation_marks_is_a_singleton CHECK ("id" = 'installation');

COMMIT;
