-- =============================================================================
-- SaaSiCat 1.0 — a new subscription lifts the end of the one before.
-- =============================================================================
--
-- A tenant whose subscription ended can take out a new one before its deletion
-- day, on the same subscription (`SC-CANC-034`). That lifts the end and the day
-- the tenant was told for it, which stay as rows with `liftedAt` set, and the
-- new subscription's own end is a row of its own with a day of its own. One
-- row per subscription, as the tables held it until now, cannot say that.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one, and after `1.0-subscription-ends-are-kept.postgres.sql`,
-- whose tables it changes:
--
--   psql "$DATABASE_URL" -f 1.0-subscription-ends-are-lifted-by-a-new-subscription.postgres.sql
--
-- What it touches, in one transaction, on `subscription_ends` and on
-- `subscription_end_announcements` alike:
--
--   a nullable column `liftedAt`, empty on every row there is, since no end
--   was lifted before this release;
--
--   the unique key on `subscriptionId` gives way to two: at most one row of a
--   subscription not lifted (`…_one_not_lifted`, the partial index
--   `constraints.postgres.sql` declares too), and no two rows of a
--   subscription for one `endsAt` (`…_subscriptionId_endsAt_key`), which keeps
--   a run that read the subscription before it came back from recording the
--   lifted end a second time. Both are created before the old key is dropped,
--   and every row there is satisfies both, since it was the only one of its
--   subscription.
--
-- Each table is skipped, with a notice, where it is missing.
--
-- Safe to run again: the column and the indexes are added only where they are
-- missing, and the old key is dropped only where it is still there. On a
-- database created from `reference-schema.postgres.sql` the whole file changes
-- nothing.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscription_ends') IS NULL THEN
        RAISE NOTICE 'subscription_ends is not present — nothing to lift; run 1.0-subscription-ends-are-kept.postgres.sql first.';
    ELSE
        ALTER TABLE "subscription_ends" ADD COLUMN IF NOT EXISTS "liftedAt" TIMESTAMP(3);
        CREATE UNIQUE INDEX IF NOT EXISTS "subscription_ends_subscriptionId_endsAt_key"
            ON "subscription_ends"("subscriptionId", "endsAt");
        CREATE UNIQUE INDEX IF NOT EXISTS subscription_ends_one_not_lifted
            ON subscription_ends ("subscriptionId") WHERE "liftedAt" IS NULL;
        DROP INDEX IF EXISTS "subscription_ends_subscriptionId_key";
    END IF;

    IF to_regclass('subscription_end_announcements') IS NULL THEN
        RAISE NOTICE 'subscription_end_announcements is not present — nothing to lift; run 1.0-subscription-ends-are-kept.postgres.sql first.';
    ELSE
        ALTER TABLE "subscription_end_announcements" ADD COLUMN IF NOT EXISTS "liftedAt" TIMESTAMP(3);
        CREATE UNIQUE INDEX IF NOT EXISTS "subscription_end_announcements_subscriptionId_endsAt_key"
            ON "subscription_end_announcements"("subscriptionId", "endsAt");
        CREATE UNIQUE INDEX IF NOT EXISTS subscription_end_announcements_one_not_lifted
            ON subscription_end_announcements ("subscriptionId") WHERE "liftedAt" IS NULL;
        DROP INDEX IF EXISTS "subscription_end_announcements_subscriptionId_key";
    END IF;
END
$$;

COMMIT;
