-- =============================================================================
-- SaaSiCat 1.0 — an add-on switch that takes something away waits for the end
-- of the booking's term.
-- =============================================================================
--
-- `subscription_bundles` gains "pendingBundleVersionId" and
-- "pendingVersionEffectiveAt": the newer version of the add-on a subscriber
-- took for the end of the booking's running term, because it takes a feature or
-- a quota away, and the moment it takes effect. Until then the booking stays on
-- "bundleVersionId"; the platform's quarter-hourly run makes the switch at that
-- moment and clears both. Run it before `db push`, the same way as the other
-- files in this directory:
--
--   psql "$DATABASE_URL" -f 1.0-an-add-on-switch-waits-for-its-term.postgres.sql
--
-- Nothing is backfilled: no booking had a switch scheduled before these columns
-- existed, so both start empty. `constraints.postgres.sql` holds the two to
-- being set together; apply it after this file, as on every deployment.
--
-- Safe to run again: the columns, their foreign key and the index are added
-- only where they are missing, so a second run changes nothing. On a database
-- created from `reference-schema.postgres.sql` the whole file does nothing: the
-- columns are already there.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscription_bundles') IS NULL OR to_regclass('bundle_versions') IS NULL THEN
        RAISE NOTICE 'subscription_bundles or bundle_versions is not present — nothing to migrate.';
        RETURN;  -- an installation that never adopted these fragments
    END IF;

    ALTER TABLE "subscription_bundles" ADD COLUMN IF NOT EXISTS "pendingBundleVersionId" TEXT;
    ALTER TABLE "subscription_bundles"
        ADD COLUMN IF NOT EXISTS "pendingVersionEffectiveAt" TIMESTAMP(3);

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscription_bundles_pendingBundleVersionId_fkey'
    ) THEN
        ALTER TABLE "subscription_bundles"
            ADD CONSTRAINT "subscription_bundles_pendingBundleVersionId_fkey"
            FOREIGN KEY ("pendingBundleVersionId") REFERENCES "bundle_versions"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    CREATE INDEX IF NOT EXISTS "subscription_bundles_pendingVersionEffectiveAt_idx"
        ON "subscription_bundles"("pendingVersionEffectiveAt");
END
$$;

COMMIT;
