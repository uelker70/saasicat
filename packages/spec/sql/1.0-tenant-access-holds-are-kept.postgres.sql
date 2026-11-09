-- =============================================================================
-- SaaSiCat 1.0 — the reasons a tenant is held back are kept.
-- =============================================================================
--
-- One table, additive: `tenant_access_holds` holds one row per reason a tenant
-- is held back (`SC-ADM-052`) — a suspension, an invoice unpaid on its due
-- date, a subscription that ended, a deletion under way. The platform reads a
-- tenant's open reasons on every request of that tenant.
--
-- Run it the same way as the other files in this directory, before `db push`
-- where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-tenant-access-holds-are-kept.postgres.sql
--
-- A suspension the application recorded in its own tenant table before this
-- release is not carried over: the platform cannot name that table. Suspend
-- such a tenant again from the administration after the deploy, or insert its
-- row here with `kind = 'suspended'`.
--
-- The unique index is what holds a tenant to one open reason per kind and
-- reference; the check holds `kind` to the four the platform knows.
--
-- Safe to run again: the table and its indexes are created only where they are
-- missing, and the check is dropped before it is added. On a database created
-- from `reference-schema.postgres.sql` the file changes nothing.

BEGIN;

CREATE TABLE IF NOT EXISTS "tenant_access_holds" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "since" TIMESTAMP(3) NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "liftedAt" TIMESTAMP(3),
    "liftedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_access_holds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tenant_access_holds_tenantId_liftedAt_idx"
    ON "tenant_access_holds"("tenantId", "liftedAt");

CREATE UNIQUE INDEX IF NOT EXISTS tenant_access_holds_one_open
    ON tenant_access_holds ("tenantId", "kind", (COALESCE("reference", ''))) WHERE "liftedAt" IS NULL;

ALTER TABLE tenant_access_holds DROP CONSTRAINT IF EXISTS tenant_access_holds_known_kind;
ALTER TABLE tenant_access_holds
    ADD CONSTRAINT tenant_access_holds_known_kind
    CHECK ("kind" IN ('suspended', 'overdue', 'ended', 'deleting'));

COMMIT;
