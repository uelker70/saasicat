-- =============================================================================
-- SaaSicat — normative PostgreSQL constraints the Prisma DSL cannot express.
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

CREATE UNIQUE INDEX IF NOT EXISTS business_type_versions_draft_per_business_type
    ON business_type_versions ("businessTypeId") WHERE "publishedAt" IS NULL;

-- A subscription binds a PlanVersion, a BusinessTypeVersion, or both —
-- never neither (SPEC_V2 §11.1 M5).
ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_plan_or_bt_check
    CHECK ("planVersionId" IS NOT NULL OR "businessTypeVersionId" IS NOT NULL);
