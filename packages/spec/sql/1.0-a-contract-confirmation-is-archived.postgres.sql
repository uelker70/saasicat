-- =============================================================================
-- SaaSiCat 1.0 — a contract's confirmation is archived and checked.
-- =============================================================================
--
-- Where each contract's confirmation stands, and the database archive that
-- keeps the confirmations (`SC-AUD-016`, 26-contract-confirmation.prisma).
-- Needed where `tenantBilling.chargeJournal.invoices` is configured. Run it
-- AFTER `db push`, and after `1.0-a-contract-is-confirmed.postgres.sql`:
--
--   psql "$DATABASE_URL" -f 1.0-a-contract-confirmation-is-archived.postgres.sql
--
-- After, because `db push` cannot create triggers, and on a database whose
-- contracts it has only just created, a run before it finds nothing to
-- protect. A run before it as well, as an entrypoint applying every shipped
-- file makes, does no harm; the start refuses invoices until the triggers are
-- in place.
--
-- What it touches, in one transaction:
--
--   `contract_confirmations` — created with its index and its foreign key to
--   `subscription_contracts`: the checksum recorded when a confirmation was
--   rendered, when the archive confirmed it, which run holds its mail, and
--   when the mail took it.
--
--   `contract_confirmation_archive` — created with its foreign key to
--   `subscription_contracts`: one file per contract. And two triggers that
--   refuse every UPDATE and DELETE of a row and every TRUNCATE of the table,
--   whoever asks — a TRUNCATE fires no row trigger: an archived confirmation
--   is kept as it was archived. The triggers are the one part of this file a
--   database created from `reference-schema.postgres.sql` does not have yet.
--
-- Skipped, with a notice, where `subscription_contracts` is missing. Nothing is
-- backfilled: a contract written before confirmations existed is not due one.
--
-- Safe to run again: every table and index is created only where it is
-- missing, each foreign key only where its name is not taken, and the trigger
-- function is replaced and the triggers created again in the same transaction.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscription_contracts') IS NULL THEN
        RAISE NOTICE 'subscription_contracts is not present — the confirmation tables are not created; run this file again after db push.';
        RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS "contract_confirmations" (
        "contractId" TEXT NOT NULL,
        "checksum" TEXT NOT NULL,
        "mediaType" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "renderedAt" TIMESTAMP(3) NOT NULL,
        "archivedAt" TIMESTAMP(3),
        "deliveryClaimedAt" TIMESTAMP(3),
        "deliveredAt" TIMESTAMP(3),
        "deliveredTo" TEXT,
        CONSTRAINT "contract_confirmations_pkey" PRIMARY KEY ("contractId")
    );
    CREATE INDEX IF NOT EXISTS "contract_confirmations_archivedAt_idx"
        ON "contract_confirmations"("archivedAt");
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contract_confirmations_contractId_fkey'
    ) THEN
        ALTER TABLE "contract_confirmations"
            ADD CONSTRAINT "contract_confirmations_contractId_fkey"
            FOREIGN KEY ("contractId") REFERENCES "subscription_contracts"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    CREATE TABLE IF NOT EXISTS "contract_confirmation_archive" (
        "contractId" TEXT NOT NULL,
        "checksum" TEXT NOT NULL,
        "mediaType" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "content" BYTEA NOT NULL,
        "archivedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "contract_confirmation_archive_pkey" PRIMARY KEY ("contractId")
    );
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'contract_confirmation_archive_contractId_fkey'
    ) THEN
        ALTER TABLE "contract_confirmation_archive"
            ADD CONSTRAINT "contract_confirmation_archive_contractId_fkey"
            FOREIGN KEY ("contractId") REFERENCES "subscription_contracts"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

-- Outside the block above, because a function body cannot be created inside
-- one; guarded the same way, so the file still does nothing without the table.
CREATE OR REPLACE FUNCTION saasicat_contract_confirmation_archive_is_kept()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'An archived contract confirmation is kept as it was archived: % on contract_confirmation_archive is refused.', TG_OP
        USING ERRCODE = 'restrict_violation';
END
$$;

DO $$
BEGIN
    IF to_regclass('contract_confirmation_archive') IS NULL THEN
        RETURN;
    END IF;
    DROP TRIGGER IF EXISTS "contract_confirmation_archive_is_kept" ON "contract_confirmation_archive";
    CREATE TRIGGER "contract_confirmation_archive_is_kept"
        BEFORE UPDATE OR DELETE ON "contract_confirmation_archive"
        FOR EACH ROW EXECUTE FUNCTION saasicat_contract_confirmation_archive_is_kept();
    DROP TRIGGER IF EXISTS "contract_confirmation_archive_is_not_emptied" ON "contract_confirmation_archive";
    CREATE TRIGGER "contract_confirmation_archive_is_not_emptied"
        BEFORE TRUNCATE ON "contract_confirmation_archive"
        FOR EACH STATEMENT EXECUTE FUNCTION saasicat_contract_confirmation_archive_is_kept();
END
$$;

COMMIT;
