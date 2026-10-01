-- =============================================================================
-- SaaSiCat 1.0 — a newer version is only offered.
-- =============================================================================
--
-- A subscription keeps the plan version it is bound to, and a newer one reaches
-- it as an offer beside the plan (`SC-SUB-020`); taking it is a change like any
-- other. The pending version — announced, reminded about, accepted and rolled
-- forward at the end of the term — is gone, and so are the seven columns that
-- carried it. Dropping them discards every pending version still recorded,
-- accepted ones included: a newer version then reaches the subscription as an
-- offer.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-a-newer-version-is-only-offered.postgres.sql
--
-- Run it once nothing reads the columns any more: no running version of the
-- application, and no job of your own — a notice or renewal job that set or
-- rolled forward a pending version — still uses them. A column's index and its
-- foreign key go with it.
--
-- Safe to run again, and on a database without a subscriptions table: every
-- column is dropped only where it exists.

ALTER TABLE IF EXISTS "subscriptions"
    DROP COLUMN IF EXISTS "pendingPlanVersionId",
    DROP COLUMN IF EXISTS "pendingPlanVersionEffectiveAt",
    DROP COLUMN IF EXISTS "pendingPlanVersionAccepted",
    DROP COLUMN IF EXISTS "pendingPlanVersionAcceptedAt",
    DROP COLUMN IF EXISTS "pendingPlanVersionAcceptedByUserId",
    DROP COLUMN IF EXISTS "pendingPlanVersionNotifiedAt",
    DROP COLUMN IF EXISTS "pendingPlanVersionReminderSentAt";
