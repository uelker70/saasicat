-- =============================================================================
-- SaaSiCat 1.0 — a correction carries the order it was recorded in.
-- =============================================================================
--
-- `subscriber_corrections` gains `seq`, numbered by the database at the write
-- that records each correction, and the platform lists the corrections by it.
-- A correction is dated while its write holds the subscriber's row lock, the
-- same lock a second correction waits for; the number is assigned inside that
-- write, so the list reads in the order the corrections replaced each other's
-- values, whatever the clocks of the instances that wrote them say.
--
-- Run it the same way as the other files in this directory, after
-- `1.0-a-contract-names-its-subscriber.postgres.sql`, whose
-- `subscriber_corrections` table it extends, and before `db push` where you
-- use one:
--
--   psql "$DATABASE_URL" -f 1.0-a-correction-carries-its-order.postgres.sql
--
-- An installation without `subscriber_corrections` is left alone. Safe to run
-- again: the numbering runs only while the column is missing. Rows recorded
-- before it existed are numbered in the order they were listed until now —
-- `correctedAt`, then `id` — so nothing an operator saw changes place, and the
-- numbering continues after them. The indexes are created afterwards, because
-- the renumbering passes through values the unique index would refuse; the
-- index over `correctedAt` gives way to one over `seq`, the order the list is
-- read in. On a database created from `reference-schema.postgres.sql` the file
-- does nothing at all.
--
-- Row-level security. The numbering reaches only the rows this role sees. Where
-- `subscriber_corrections` is under a policy that hides some of them from it,
-- the file stops before anything changes: run it as a role that sees every row
-- — one that bypasses row-level security, or with whatever lifts your policy.

BEGIN;

DO $$
DECLARE
    visible  bigint;
    numbered bigint;
BEGIN
    IF to_regclass('subscriber_corrections') IS NULL THEN
        RAISE NOTICE 'subscriber_corrections is not present — nothing to migrate.';
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'subscriber_corrections'
          AND column_name = 'seq'
    ) THEN
        RETURN;
    END IF;

    ALTER TABLE "subscriber_corrections" ADD COLUMN "seq" SERIAL NOT NULL;

    -- Adding the column numbered every row, whatever this role sees, so the
    -- sequence already stands after the last of them. The renumbering reaches
    -- only the rows row-level security shows this role: a row it hides would
    -- keep the number the table's storage order gave it, out of the order the
    -- operator saw, and could share it with a row renumbered. So what this role
    -- sees is counted against what the sequence handed out.
    SELECT count(*) INTO visible FROM "subscriber_corrections";
    numbered := COALESCE(
        pg_sequence_last_value(pg_get_serial_sequence('subscriber_corrections', 'seq')::regclass),
        0
    );
    IF visible < numbered THEN
        RAISE EXCEPTION
            'Cannot see every row of subscriber_corrections under row-level security as role %: '
            '% of % corrections are visible, and the others would keep the order the table '
            'stores them in. Run this file as a role that sees every row. Nothing was changed.',
            current_user, visible, numbered;
    END IF;

    WITH ordered AS (
        SELECT "id", row_number() OVER (ORDER BY "correctedAt", "id") AS n
        FROM "subscriber_corrections"
    )
    UPDATE "subscriber_corrections" AS c
    SET "seq" = ordered.n
    FROM ordered
    WHERE c."id" = ordered."id";
END $$;

DO $$
BEGIN
    IF to_regclass('subscriber_corrections') IS NULL THEN
        RETURN;  -- said once already, by the block above
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_corrections_seq_key"
        ON "subscriber_corrections"("seq");
    CREATE INDEX IF NOT EXISTS "subscriber_corrections_subscriberId_seq_idx"
        ON "subscriber_corrections"("subscriberId", "seq");
    DROP INDEX IF EXISTS "subscriber_corrections_subscriberId_correctedAt_idx";
END $$;

COMMIT;
