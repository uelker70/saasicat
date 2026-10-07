-- =============================================================================
-- SaaSiCat 1.0 — a feature is withdrawn for a reason outside the platform.
-- =============================================================================
--
-- One table, additive: `feature_withdrawals` keeps every feature an operator
-- withdraws because an external service stopped or a law changed — which
-- feature, why, from when, the reductions named, and when it was lifted. What
-- it means for each subscription is a `subscription_notices` row of kind
-- `feature-withdrawn`, which `1.0-a-subscriber-is-told-once.postgres.sql`
-- creates.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-a-feature-is-withdrawn.postgres.sql
--
-- The partial unique index is what holds a feature to one withdrawal not yet
-- lifted: every open row of a feature carries the same key, so a second one
-- collides, and a withdrawal that is lifted leaves the index.
--
-- Safe to run again: the table and both indexes are created only where they are
-- missing. On a database created from `reference-schema.postgres.sql` with
-- `constraints.postgres.sql` applied, the whole file does nothing at all.

BEGIN;

CREATE TABLE IF NOT EXISTS "feature_withdrawals" (
    "id" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "liftedFrom" TIMESTAMP(3),
    "reductions" JSONB NOT NULL DEFAULT '[]',
    "announcedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "announcedBy" TEXT NOT NULL,
    "liftedAt" TIMESTAMP(3),
    "liftedBy" TEXT,

    CONSTRAINT "feature_withdrawals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "feature_withdrawals_featureKey_idx"
    ON "feature_withdrawals"("featureKey");

CREATE UNIQUE INDEX IF NOT EXISTS feature_withdrawals_one_open_per_feature
    ON feature_withdrawals ("featureKey") WHERE "liftedFrom" IS NULL;

COMMIT;
