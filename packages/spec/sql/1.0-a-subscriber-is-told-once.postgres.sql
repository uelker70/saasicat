-- =============================================================================
-- SaaSiCat 1.0 — a subscriber is told once.
-- =============================================================================
--
-- One table, additive: `subscription_notices` keeps the record of every notice
-- a subscriber is due — that a newer version of their plan is offered to them —
-- with when it went out, to whom and how. The platform writes it where
-- `tenantBilling.versionNotices` is turned on, and the unique key is what makes
-- each notice once rather than once per run.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-a-subscriber-is-told-once.postgres.sql
--
-- The record outlives the subscription, as the subscriber's account does, so
-- the table keeps the tenant and the subscription as values and has no foreign
-- key: nothing else has to exist for it to be created.
--
-- Safe to run again: the table and both indexes are created only where they are
-- missing. On a database created from `reference-schema.postgres.sql` the whole
-- file does nothing at all.

BEGIN;

CREATE TABLE IF NOT EXISTS "subscription_notices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "recipients" JSONB,
    "channel" TEXT,

    CONSTRAINT "subscription_notices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "subscription_notices_kind_subject_idx"
    ON "subscription_notices"("kind", "subject");

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_notices_subscriptionId_kind_subject_key"
    ON "subscription_notices"("subscriptionId", "kind", "subject");

COMMIT;
