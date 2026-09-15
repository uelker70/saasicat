-- =============================================================================
-- SaaSiCat — normative PostgreSQL constraints the Prisma DSL cannot express.
-- =============================================================================
--
-- Consumers add these statements to their SQL migration after creating the
-- tables from the prisma-fragments. The adapter contract tests
-- (@saasicat/persistence-testing) run against a database with these
-- constraints applied — they are part of the canonical schema, not optional
-- hardening.
--
-- Column names are camelCase (the fragments map table names via @@map but
-- keep Prisma's default field→column naming), hence the quoting.

-- At most ONE draft (publishedAt IS NULL) per version lineage.
CREATE UNIQUE INDEX IF NOT EXISTS plan_versions_draft_per_plan
    ON plan_versions ("planId") WHERE "publishedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bundle_versions_draft_per_bundle
    ON bundle_versions ("bundleId") WHERE "publishedAt" IS NULL;

-- `marketing_settings` holds at most ONE row.
--
-- The Prisma DSL cannot say this, and the constant default on `id` does not: a
-- default applies only where the caller omits the value, and a primary key
-- accepts every distinct one. A consumer writing the row directly could make as
-- many as it liked, and the repository would then read one and ignore the rest.
--
-- `ADD CONSTRAINT` has no `IF NOT EXISTS`, and this file is applied again on
-- every deployment — so it is dropped first. Two plain statements rather than a
-- dollar-quoted `DO` block on purpose: every consumer of this file splits it at
-- the statement separator, and a dollar-quoted body would need each of those
-- splitters to become a SQL lexer. For the same reason no comment in this file
-- may contain that separator — one here did, and three splitters cut the
-- sentence in half.
ALTER TABLE marketing_settings
    DROP CONSTRAINT IF EXISTS marketing_settings_is_a_singleton;
ALTER TABLE marketing_settings
    ADD CONSTRAINT marketing_settings_is_a_singleton CHECK ("id" = 'marketing-settings');

-- `applied_settings` holds at most ONE row: the installation's.
--
-- Same reasoning as above, and the same two plain statements. The row mirrors
-- the settings the installation applied at its last start, and an installation
-- serves one application, so there is exactly one configuration to record.
ALTER TABLE applied_settings
    DROP CONSTRAINT IF EXISTS applied_settings_is_a_singleton;
ALTER TABLE applied_settings
    ADD CONSTRAINT applied_settings_is_a_singleton CHECK ("id" = 'installation');

-- A subscriber is live for at most ONE tenant, and a tenant has at most ONE
-- live subscriber. A link that ended keeps its row with `unlinkedAt` set, so the
-- tenants a subscriber had before stay in its history. Two partial unique
-- indexes, because a link that is over must not count against the next one.
CREATE UNIQUE INDEX IF NOT EXISTS subscriber_tenants_live_per_tenant
    ON subscriber_tenants ("tenantId") WHERE "unlinkedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriber_tenants_live_per_subscriber
    ON subscriber_tenants ("subscriberId") WHERE "unlinkedAt" IS NULL;

-- A subscriber has at most ONE payment method in use. The one a newer payment
-- method replaced keeps its row as `REPLACED`, so it does not count here.
CREATE UNIQUE INDEX IF NOT EXISTS subscriber_payment_methods_active_per_subscriber
    ON subscriber_payment_methods ("subscriberId") WHERE "status" = 'ACTIVE';

-- A gateway session is confirmed ONCE.
--
-- A gateway delivers every event at least once, and it may report one session
-- through more than one event — a completed form and the payment method behind
-- it can arrive as two. `eventId` tells those apart, so both would be claimed,
-- and both would record the session's payment method: for a sign-up that means
-- a second tenant for one registration.
--
-- Both adapters claim with `ON CONFLICT DO NOTHING` and no conflict target, so
-- this index turns the second confirmation into no row rather than an error,
-- and the caller reads it as the duplicate it is. Partial on the kind, because
-- a failed setup and an event SaaSiCat does not act on say nothing about the
-- session being confirmed. A claim carrying no session does not collide:
-- PostgreSQL counts nulls as distinct in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS payment_event_log_confirmation_per_session
    ON "PaymentEventLog" ("gatewayAccount", "sessionId")
    WHERE "status" = 'payment-method-confirmed';

-- Customer numbers count from 10001, so a number has five digits up to 99999
-- and none reads as a count of subscribers. Two statements: the first makes
-- 10001 where the sequence starts over, which a restart of its identity reads,
-- and the second moves a sequence that has never handed out a number there. A
-- second run finds the start already set and the sequence used, and an
-- installation without the subscriber tables has no such sequence.
ALTER SEQUENCE IF EXISTS "subscribers_customerSequence_seq" START WITH 10001;

SELECT setval(format('%I.%I', schemaname, sequencename)::regclass, 10001, false)
  FROM pg_sequences
 WHERE schemaname = current_schema()
   AND sequencename = 'subscribers_customerSequence_seq'
   AND last_value IS NULL;
