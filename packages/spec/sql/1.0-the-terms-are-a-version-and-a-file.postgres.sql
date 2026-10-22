-- =============================================================================
-- SaaSiCat 1.0 — the operator's terms are a version and a file.
-- =============================================================================
--
-- `config/saas.yaml#terms` names a version of the operator's terms and its PDF.
-- The start archives each new version once, with its checksum, in
-- `terms_versions`. Every contract records the version and the days of notice
-- the subscriber agreed to, and when: a change they schedule records them
-- with it, and the contract it ends in takes the later agreement
-- (`SC-CFG-038`, `SC-CANC-026`, `SC-AUD-016`). Run it once, BEFORE `db push`:
--
--   psql "$DATABASE_URL" -f 1.0-the-terms-are-a-version-and-a-file.postgres.sql
--
-- What it does, in one transaction:
--
--   `terms_versions` — created in the shape fragment 25 declares, where it is
--   missing.
--   `subscription_contracts."termsVersion"` — added, empty on every contract
--   there is: no version was recorded before this release, and none is made
--   up.
--   `subscription_contracts."agreedAt"` — when the subscriber agreed to the
--   contract's terms and notice period. Required in fragment 08, which
--   `db push` cannot add to a table holding rows, so it is added nullable,
--   filled with the moment each contract was written, and only then
--   tightened. A table that row-level security hides rows of from this role
--   stops it with a sentence naming what to do, and nothing is filled.
--   `subscriptions` and `subscription_bundles` — the columns in which a
--   scheduled change, a scheduled add-on switch and a booking record what the
--   subscriber agreed to (fragments 01 and 11), empty on every row there is:
--   such a change takes the file's when it lands, as before.
--   Two triggers on `terms_versions` that refuse every UPDATE and DELETE of a
--   row and every TRUNCATE of the table, whoever asks: a version is archived
--   once and kept as it was agreed. The statement trigger is there because a
--   TRUNCATE fires no row trigger.
--
-- Each table this does not find is skipped with a notice.
--
-- Safe to run again: the table and the columns are created only where
-- missing, only contracts without the moment are filled, tightening a column
-- that is already NOT NULL is a no-op, the function is replaced, and each
-- trigger is dropped and created again. On a database created from
-- `reference-schema.postgres.sql` it adds the triggers, which a schema built
-- from the fragments alone cannot have.

BEGIN;

CREATE TABLE IF NOT EXISTS "terms_versions" (
    "version" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terms_versions_pkey" PRIMARY KEY ("version")
);

DO $$
DECLARE
    still_nullable boolean;
BEGIN
    IF to_regclass('subscription_contracts') IS NULL THEN
        RAISE NOTICE 'subscription_contracts is not present — no contracts, so none records a version of the terms.';
    ELSE
        ALTER TABLE "subscription_contracts" ADD COLUMN IF NOT EXISTS "termsVersion" TEXT;
        ALTER TABLE "subscription_contracts" ADD COLUMN IF NOT EXISTS "agreedAt" TIMESTAMP(3);

        SELECT NOT attnotnull INTO still_nullable
          FROM pg_attribute
         WHERE attrelid = to_regclass('subscription_contracts')
           AND attname = 'agreedAt';

        -- Once the column is required no contract is without a value, so a
        -- second run asks nothing of the rows and nothing of the role.
        IF still_nullable THEN
            -- A table under row-level security shows this role only the rows
            -- its policies allow, and a hidden contract left without the moment
            -- would fail the tightening with a message about null values.
            IF EXISTS (
                SELECT 1 FROM pg_class c
                 WHERE c.oid = to_regclass('subscription_contracts')
                   AND c.relrowsecurity
                   AND (c.relforcerowsecurity OR NOT pg_has_role(current_user, c.relowner, 'USAGE'))
                   AND NOT EXISTS (
                       SELECT 1 FROM pg_roles r
                        WHERE r.rolname = current_user AND (r.rolsuper OR r.rolbypassrls)
                   )
            ) THEN
                RAISE EXCEPTION 'Cannot see every row of subscription_contracts under row-level security as role %, so a contract it hides would be left without the moment its terms were agreed. Run this file as a role that bypasses row-level security. Nothing was filled.', current_user;
            END IF;

            UPDATE "subscription_contracts" SET "agreedAt" = "createdAt" WHERE "agreedAt" IS NULL;
        END IF;

        ALTER TABLE "subscription_contracts" ALTER COLUMN "agreedAt" SET NOT NULL;
    END IF;

    IF to_regclass('subscriptions') IS NULL THEN
        RAISE NOTICE 'subscriptions is not present — no change is scheduled, so none records an agreement.';
    ELSE
        ALTER TABLE "subscriptions"
            ADD COLUMN IF NOT EXISTS "pendingTermsVersion" TEXT,
            ADD COLUMN IF NOT EXISTS "pendingCancellationNoticeDays" INTEGER,
            ADD COLUMN IF NOT EXISTS "pendingAgreedAt" TIMESTAMP(3);
    END IF;

    IF to_regclass('subscription_bundles') IS NULL THEN
        RAISE NOTICE 'subscription_bundles is not present — no add-on is booked, so none records an agreement.';
    ELSE
        ALTER TABLE "subscription_bundles"
            ADD COLUMN IF NOT EXISTS "pendingTermsVersion" TEXT,
            ADD COLUMN IF NOT EXISTS "pendingCancellationNoticeDays" INTEGER,
            ADD COLUMN IF NOT EXISTS "pendingAgreedAt" TIMESTAMP(3),
            ADD COLUMN IF NOT EXISTS "agreedTermsVersion" TEXT,
            ADD COLUMN IF NOT EXISTS "agreedCancellationNoticeDays" INTEGER,
            ADD COLUMN IF NOT EXISTS "agreedAt" TIMESTAMP(3);
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION saasicat_terms_versions_are_kept()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'An archived version of the terms is kept as it was agreed: % on terms_versions is refused.', TG_OP
        USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS "terms_versions_are_kept" ON "terms_versions";
CREATE TRIGGER "terms_versions_are_kept"
    BEFORE UPDATE OR DELETE ON "terms_versions"
    FOR EACH ROW EXECUTE FUNCTION saasicat_terms_versions_are_kept();

DROP TRIGGER IF EXISTS "terms_versions_are_not_emptied" ON "terms_versions";
CREATE TRIGGER "terms_versions_are_not_emptied"
    BEFORE TRUNCATE ON "terms_versions"
    FOR EACH STATEMENT EXECUTE FUNCTION saasicat_terms_versions_are_kept();

COMMIT;
