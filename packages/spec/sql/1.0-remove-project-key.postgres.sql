-- =============================================================================
-- SaaSiCat 1.0 — remove `projectKey` from the catalogue tables.
-- =============================================================================
--
-- project-key-history: this file names the retired identifier because dropping
-- it is what it does.
--
-- One installation serves one application, so a plan key, a bundle key, a
-- feature key and a quota key are unique for the installation. The column that
-- suggested otherwise never had a second value to hold: nothing in the platform
-- could configure a second project, and `subscriptions.tenantId` is unique
-- installation-wide, so two applications in one database was never a shape this
-- model could carry.
--
-- Run this ONCE against an existing database, inside the transaction it opens.
-- It is a one-way door: the values are dropped, not archived.
--
--   psql "$DATABASE_URL" -f 1.0-remove-project-key.postgres.sql
--
-- The first statement is a guard. If the affected tables between them hold rows
-- under more than one project, the migration STOPS and names the table each key
-- came from, rather than merging rows nobody meant to merge — two `STANDARD`
-- plans would otherwise collide on the new unique index, and which of them
-- survives is not a decision a migration should take.
--
-- The question is asked across the tables and not once per table. A per-table
-- count is one where `plans` holds only `alpha` and `bundles` only `beta`, and
-- that is a two-project installation whose evidence this migration would drop.
--
-- Applies to a database created from `reference-schema.postgres.sql` at 0.27 or
-- any release before 1.0.

BEGIN;

DO $$
DECLARE
    affected CONSTANT text[] := ARRAY[
        'plans',
        'bundles',
        'capability_catalog_entries',
        'feature_catalog_entries',
        'quota_catalog_entries',
        'marketing_projections',
        'marketing_settings',
        'promotions',
        'checkout_offers',
        'subscription_contracts'
    ];
    target text;
    keys_here text[];
    -- Every key seen anywhere, with the table it came from, so the message can
    -- say where the disagreement is rather than only that there is one.
    seen text[] := ARRAY[]::text[];
    witnesses text[] := ARRAY[]::text[];
BEGIN
    FOREACH target IN ARRAY affected LOOP
        IF to_regclass(format('%I', target)) IS NULL THEN
            CONTINUE;  -- an installation that never adopted this fragment
        END IF;
        EXECUTE format('SELECT array_agg(DISTINCT "projectKey") FROM %I', target)
            INTO keys_here;
        IF keys_here IS NULL THEN
            CONTINUE;  -- an empty table says nothing about the installation
        END IF;
        seen := ARRAY(SELECT DISTINCT unnest(seen || keys_here) ORDER BY 1);
        witnesses := witnesses || format('%s: %s', target, array_to_string(keys_here, ', '));
    END LOOP;

    IF array_length(seen, 1) > 1 THEN
        RAISE EXCEPTION
            'The catalogue holds rows under % different project keys (%). Removing the column '
            'would merge them, and a duplicate key would then collide on the new unique index. '
            'Per table: %. Decide which rows belong to this installation and delete the rest, '
            'then run this migration again.',
            array_length(seen, 1),
            array_to_string(seen, ', '),
            array_to_string(witnesses, ' | ');
    END IF;
END $$;

-- ─── The indexes that carried the column ───

DROP INDEX IF EXISTS "checkout_offers_projectKey_status_idx";
DROP INDEX IF EXISTS "plans_projectKey_deletedAt_idx";
DROP INDEX IF EXISTS "plans_projectKey_planKey_key";
DROP INDEX IF EXISTS "bundles_projectKey_deletedAt_idx";
DROP INDEX IF EXISTS "bundles_projectKey_bundleKey_key";
DROP INDEX IF EXISTS "capability_catalog_entries_projectKey_codeStatus_idx";
DROP INDEX IF EXISTS "capability_catalog_entries_projectKey_featureKey_idx";
DROP INDEX IF EXISTS "capability_catalog_entries_projectKey_capabilityKey_key";
DROP INDEX IF EXISTS "feature_catalog_entries_projectKey_discoveryStatus_idx";
DROP INDEX IF EXISTS "feature_catalog_entries_projectKey_plannedOnly_idx";
DROP INDEX IF EXISTS "feature_catalog_entries_projectKey_featureKey_key";
DROP INDEX IF EXISTS "quota_catalog_entries_projectKey_discoveryStatus_idx";
DROP INDEX IF EXISTS "quota_catalog_entries_projectKey_quotaKey_key";
DROP INDEX IF EXISTS "marketing_projections_projectKey_targetType_locale_priority_idx";
DROP INDEX IF EXISTS "marketing_settings_projectKey_key";
DROP INDEX IF EXISTS "promotions_projectKey_targetType_validFrom_validTo_idx";
DROP INDEX IF EXISTS "subscription_contracts_projectKey_status_idx";

-- ─── The column ───

ALTER TABLE "plans"                       DROP COLUMN IF EXISTS "projectKey";
ALTER TABLE "bundles"                     DROP COLUMN IF EXISTS "projectKey";
ALTER TABLE "capability_catalog_entries"  DROP COLUMN IF EXISTS "projectKey";
ALTER TABLE "feature_catalog_entries"     DROP COLUMN IF EXISTS "projectKey";
ALTER TABLE "quota_catalog_entries"       DROP COLUMN IF EXISTS "projectKey";
ALTER TABLE "marketing_projections"       DROP COLUMN IF EXISTS "projectKey";
ALTER TABLE "marketing_settings"          DROP COLUMN IF EXISTS "projectKey";
ALTER TABLE "promotions"                  DROP COLUMN IF EXISTS "projectKey";
ALTER TABLE "checkout_offers"             DROP COLUMN IF EXISTS "projectKey";
ALTER TABLE "subscription_contracts"      DROP COLUMN IF EXISTS "projectKey";

-- ─── The tightened uniques, and the lookup indexes that shrank with them ───

CREATE UNIQUE INDEX IF NOT EXISTS "plans_planKey_key" ON "plans"("planKey");
CREATE INDEX IF NOT EXISTS "plans_deletedAt_idx" ON "plans"("deletedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "bundles_bundleKey_key" ON "bundles"("bundleKey");
CREATE INDEX IF NOT EXISTS "bundles_deletedAt_idx" ON "bundles"("deletedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "capability_catalog_entries_capabilityKey_key"
    ON "capability_catalog_entries"("capabilityKey");
CREATE INDEX IF NOT EXISTS "capability_catalog_entries_codeStatus_idx"
    ON "capability_catalog_entries"("codeStatus");
CREATE INDEX IF NOT EXISTS "capability_catalog_entries_featureKey_idx"
    ON "capability_catalog_entries"("featureKey");

CREATE UNIQUE INDEX IF NOT EXISTS "feature_catalog_entries_featureKey_key"
    ON "feature_catalog_entries"("featureKey");
CREATE INDEX IF NOT EXISTS "feature_catalog_entries_discoveryStatus_idx"
    ON "feature_catalog_entries"("discoveryStatus");
CREATE INDEX IF NOT EXISTS "feature_catalog_entries_plannedOnly_idx"
    ON "feature_catalog_entries"("plannedOnly");

CREATE UNIQUE INDEX IF NOT EXISTS "quota_catalog_entries_quotaKey_key"
    ON "quota_catalog_entries"("quotaKey");
CREATE INDEX IF NOT EXISTS "quota_catalog_entries_discoveryStatus_idx"
    ON "quota_catalog_entries"("discoveryStatus");

CREATE INDEX IF NOT EXISTS "marketing_projections_targetType_locale_priority_idx"
    ON "marketing_projections"("targetType", "locale", "priority");
CREATE INDEX IF NOT EXISTS "promotions_targetType_validFrom_validTo_idx"
    ON "promotions"("targetType", "validFrom", "validTo");
CREATE INDEX IF NOT EXISTS "checkout_offers_status_idx" ON "checkout_offers"("status");
CREATE INDEX IF NOT EXISTS "subscription_contracts_status_idx"
    ON "subscription_contracts"("status");

-- ─── `marketing_settings` becomes a singleton ───
--
-- The row was identified by its project; now it is identified by a constant
-- primary key, which is what caps the table at one row. An installation that
-- already has exactly one row keeps it under the new id; the guard above has
-- already refused anything else.

ALTER TABLE "marketing_settings" ALTER COLUMN "id" SET DEFAULT 'marketing-settings';
UPDATE "marketing_settings" SET "id" = 'marketing-settings';

COMMIT;
