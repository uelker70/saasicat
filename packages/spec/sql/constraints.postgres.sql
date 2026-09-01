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
