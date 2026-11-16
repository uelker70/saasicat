-- =============================================================================
-- SaaSiCat 1.0 — the ends are read by their day, and the notices by their tenant.
-- =============================================================================
--
-- What a tenant's deletion reads, and what it keeps of a notice once the tenant
-- is gone (`SC-PRIV-023`). Run it the same way as the other files in this
-- directory, before `db push` where you use one, and after
-- `1.0-a-subscriber-is-told-once.postgres.sql` and
-- `1.0-subscription-ends-are-kept.postgres.sql`, whose tables it extends:
--
--   psql "$DATABASE_URL" -f 1.0-the-ends-are-read-by-day-and-the-notices-by-tenant.postgres.sql
--
-- What it touches, in one transaction:
--
--   `subscription_ends` — an index on `deletesOn`, which the reminders of a
--   deletion read the ends by.
--
--   `subscription_notices` — an index on `tenantId`, which a deletion reads a
--   tenant's notices by, and two nullable columns: `recipientCount`, how many a
--   notice went to, and `recipientsForgottenAt`, when its recipients were
--   forgotten because its tenant was deleted. A deleted tenant's notices say
--   how many they went to, not to whom.
--
-- Each table is skipped, with a notice, where it is missing.
--
-- Every notice delivered before this ran is given the number of the recipients
-- it records. A notice the role running this file cannot see under row-level
-- security keeps none: forgetting its recipients counts them, so nothing is
-- lost by it.
--
-- Safe to run again: the indexes and columns are added only where they are
-- missing, and the count is written only where none is, which no notice the
-- first run counted still matches. On a database created from
-- `reference-schema.postgres.sql` the whole file changes nothing.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscription_ends') IS NULL THEN
        RAISE NOTICE 'subscription_ends is not present — no index on the deletion day; run 1.0-subscription-ends-are-kept.postgres.sql first.';
    ELSE
        CREATE INDEX IF NOT EXISTS "subscription_ends_deletesOn_idx"
            ON "subscription_ends"("deletesOn");
    END IF;

    IF to_regclass('subscription_notices') IS NULL THEN
        RAISE NOTICE 'subscription_notices is not present — no recipient count; run 1.0-a-subscriber-is-told-once.postgres.sql first.';
        RETURN;
    END IF;

    CREATE INDEX IF NOT EXISTS "subscription_notices_tenantId_idx"
        ON "subscription_notices"("tenantId");
    ALTER TABLE "subscription_notices" ADD COLUMN IF NOT EXISTS "recipientCount" INTEGER;
    ALTER TABLE "subscription_notices" ADD COLUMN IF NOT EXISTS "recipientsForgottenAt" TIMESTAMP(3);

    UPDATE "subscription_notices"
       SET "recipientCount" = jsonb_array_length("recipients")
     WHERE "recipientCount" IS NULL
       AND jsonb_typeof("recipients") = 'array';
END
$$;

COMMIT;
