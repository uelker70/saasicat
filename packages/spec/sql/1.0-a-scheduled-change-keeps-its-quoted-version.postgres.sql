-- =============================================================================
-- SaaSiCat 1.0 — a scheduled change to another plan binds the version it was
-- quoted at.
-- =============================================================================
--
-- `subscriptions` gains "pendingChangeVersionId": the version of "pendingPlan"
-- the plan-change preview showed when the change was scheduled. When the change
-- comes due, the platform binds that version rather than whichever is in effect
-- that day, so a version published in between does not reach the customer by a
-- change they already agreed to. Run it BEFORE `db push`, the same way as the
-- other files in this directory:
--
--   psql "$DATABASE_URL" -f 1.0-a-scheduled-change-keeps-its-quoted-version.postgres.sql
--
-- What happens to a change scheduled before this file. The version it was
-- shown was never recorded, so the one live now — the newest published, not
-- superseded and not ended, as the catalogue shows it — stands for it. That is the version
-- the change would have bound had it come due today, which is what it did
-- before this file. A change that stays on its plan is left empty: it keeps the
-- version bound, whatever that is by the day it comes due. A plan with no live
-- version is left empty too, and binds the version in effect when it comes due,
-- and so is every change on a schema whose "plan_versions"."planId" holds the
-- plan's row id rather than its key: the match below is by key.
--
-- Safe to run again: the column, its index and its foreign key are added only
-- where they are missing, and the backfill runs only in the run that adds the
-- column. A second run therefore finds the column and changes nothing — it
-- does not pin a version published since the first run to a change scheduled
-- before it. On a database created from `reference-schema.postgres.sql` the
-- whole file does nothing: the column is already there.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscriptions') IS NULL OR to_regclass('plan_versions') IS NULL THEN
        RAISE NOTICE 'subscriptions or plan_versions is not present — nothing to migrate.';
        RETURN;  -- an installation that never adopted these fragments
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'subscriptions'
          AND column_name = 'pendingChangeVersionId'
    ) THEN
        ALTER TABLE "subscriptions" ADD COLUMN "pendingChangeVersionId" TEXT;

        -- Live as the catalogue reads it: published, not superseded, and — on
        -- a schema that can end a version — not ended, since an ended version
        -- takes no new bookings. The clause is added only where the column
        -- exists; a schema from before it ends nothing.
        EXECUTE format(
            $backfill$
            UPDATE "subscriptions" AS s
            SET "pendingChangeVersionId" = (
                SELECT v."id"
                FROM "plan_versions" AS v
                WHERE v."planId" = s."pendingPlan"
                  AND v."publishedAt" IS NOT NULL
                  AND v."supersededAt" IS NULL
                  %s
                ORDER BY v."version" DESC
                LIMIT 1
            )
            WHERE s."pendingPlan" IS NOT NULL
              AND s."pendingPlan" <> s."plan"
            $backfill$,
            CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'plan_versions'
                      AND column_name = 'endsAt'
                )
                THEN 'AND (v."endsAt" IS NULL OR v."endsAt" > NOW())'
                ELSE ''
            END
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_pendingChangeVersionId_fkey'
    ) THEN
        ALTER TABLE "subscriptions"
            ADD CONSTRAINT "subscriptions_pendingChangeVersionId_fkey"
            FOREIGN KEY ("pendingChangeVersionId") REFERENCES "plan_versions"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    CREATE INDEX IF NOT EXISTS "subscriptions_pendingChangeVersionId_idx"
        ON "subscriptions"("pendingChangeVersionId");
END
$$;

COMMIT;
