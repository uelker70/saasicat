-- =============================================================================
-- SaaSiCat 1.0 — a settings change carries the order it was recorded in.
-- =============================================================================
--
-- `settings_changes` gains `seq`, numbered by the database at the write that
-- records each change, and the platform lists the changes by it. Until now the
-- list was ordered by `noticedAt`, which is the recording start's own clock: a
-- start delayed between reading its clock and writing — a pause, a slow
-- connection — could land after a move made by another start and still be
-- listed before it, and the list then showed an order the record never went
-- through. The number is assigned inside the write, under the row lock the
-- guarded write already takes, so it cannot.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-a-settings-change-carries-its-order.postgres.sql
--
-- Safe to run again: the block runs only while the column is missing. Rows
-- recorded before it existed are numbered in the order they were listed until
-- now — `noticedAt`, then `id` — so nothing an operator saw changes place, and
-- the numbering continues after them. The unique index is created afterwards,
-- because the renumbering passes through values the index would refuse. On a
-- database created from `reference-schema.postgres.sql` the file does nothing
-- at all.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'settings_changes'
          AND column_name = 'seq'
    ) THEN
        RETURN;
    END IF;

    ALTER TABLE "settings_changes" ADD COLUMN "seq" SERIAL NOT NULL;

    WITH ordered AS (
        SELECT "id", row_number() OVER (ORDER BY "noticedAt", "id") AS n
        FROM "settings_changes"
    )
    UPDATE "settings_changes" AS c
    SET "seq" = ordered.n
    FROM ordered
    WHERE c."id" = ordered."id";

    PERFORM setval(
        pg_get_serial_sequence('settings_changes', 'seq'),
        (SELECT COALESCE(MAX("seq"), 0) + 1 FROM "settings_changes"),
        false
    );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "settings_changes_seq_key" ON "settings_changes"("seq");

COMMIT;
