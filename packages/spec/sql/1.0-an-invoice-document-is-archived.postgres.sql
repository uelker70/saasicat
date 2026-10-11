-- =============================================================================
-- SaaSiCat 1.0 — an invoice's document is archived and checked.
-- =============================================================================
--
-- Where each invoice's document stands, and the database archive that keeps
-- the documents (#276 step 6). Needed where `tenantBilling.chargeJournal.invoices`
-- is configured. Run it AFTER `db push`, and after
-- `1.0-an-invoice-is-issued.postgres.sql`, whose `subscription_invoices` table
-- both point at:
--
--   psql "$DATABASE_URL" -f 1.0-an-invoice-document-is-archived.postgres.sql
--
-- After, because `db push` cannot create triggers, and on a database whose
-- invoices it has only just created, a run before it finds nothing to protect.
-- A run before it as well, as an entrypoint applying every shipped file makes,
-- does no harm; the start refuses invoices until the triggers are in place.
--
-- What it touches, in one transaction:
--
--   `subscription_invoice_documents` — created with its index and its foreign
--   key to `subscription_invoices`: the checksum recorded when an invoice's
--   document was rendered, when the archive confirmed it, which run holds its
--   mail, and when the mail took it.
--
--   `subscription_invoice_archive` — created with its foreign key to
--   `subscription_invoices`: one file per invoice. And two triggers that refuse
--   every UPDATE and DELETE of a row and every TRUNCATE of the table, whoever
--   asks — a TRUNCATE fires no row trigger, and one cascading from
--   `subscribers` would otherwise empty the archive: an archived invoice is
--   kept as it was issued. The triggers are the one part of this file a
--   database created from `reference-schema.postgres.sql` does not have yet,
--   because that file holds plain statements only.
--
-- Skipped, with a notice, where `subscription_invoices` is missing. Nothing is
-- backfilled: an invoice issued before this ran has no document recorded and
-- is rendered by the next run.
--
-- Safe to run again: every table and index is created only where it is
-- missing, each foreign key only where its name is not taken, and the trigger
-- function is replaced and the triggers created again in the same transaction.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscription_invoices') IS NULL THEN
        RAISE NOTICE 'subscription_invoices is not present — the invoice document tables are not created; run 1.0-an-invoice-is-issued.postgres.sql first.';
        RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS "subscription_invoice_documents" (
        "invoiceId" TEXT NOT NULL,
        "checksum" TEXT NOT NULL,
        "mediaType" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "renderedAt" TIMESTAMP(3) NOT NULL,
        "archivedAt" TIMESTAMP(3),
        "deliveryClaimedAt" TIMESTAMP(3),
        "deliveredAt" TIMESTAMP(3),
        "deliveredTo" TEXT,
        CONSTRAINT "subscription_invoice_documents_pkey" PRIMARY KEY ("invoiceId")
    );
    CREATE INDEX IF NOT EXISTS "subscription_invoice_documents_archivedAt_idx"
        ON "subscription_invoice_documents"("archivedAt");
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscription_invoice_documents_invoiceId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoice_documents"
            ADD CONSTRAINT "subscription_invoice_documents_invoiceId_fkey"
            FOREIGN KEY ("invoiceId") REFERENCES "subscription_invoices"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    CREATE TABLE IF NOT EXISTS "subscription_invoice_archive" (
        "invoiceId" TEXT NOT NULL,
        "checksum" TEXT NOT NULL,
        "mediaType" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "content" BYTEA NOT NULL,
        "archivedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "subscription_invoice_archive_pkey" PRIMARY KEY ("invoiceId")
    );
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscription_invoice_archive_invoiceId_fkey'
    ) THEN
        ALTER TABLE "subscription_invoice_archive"
            ADD CONSTRAINT "subscription_invoice_archive_invoiceId_fkey"
            FOREIGN KEY ("invoiceId") REFERENCES "subscription_invoices"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END
$$;

-- Outside the block above, because a function body cannot be created inside
-- one; guarded the same way, so the file still does nothing without the table.
CREATE OR REPLACE FUNCTION saasicat_subscription_invoice_archive_is_kept()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'An archived invoice document is kept as it was issued: % on subscription_invoice_archive is refused.', TG_OP
        USING ERRCODE = 'restrict_violation';
END
$$;

DO $$
BEGIN
    IF to_regclass('subscription_invoice_archive') IS NULL THEN
        RETURN;
    END IF;
    DROP TRIGGER IF EXISTS "subscription_invoice_archive_is_kept" ON "subscription_invoice_archive";
    CREATE TRIGGER "subscription_invoice_archive_is_kept"
        BEFORE UPDATE OR DELETE ON "subscription_invoice_archive"
        FOR EACH ROW EXECUTE FUNCTION saasicat_subscription_invoice_archive_is_kept();
    DROP TRIGGER IF EXISTS "subscription_invoice_archive_is_not_emptied" ON "subscription_invoice_archive";
    CREATE TRIGGER "subscription_invoice_archive_is_not_emptied"
        BEFORE TRUNCATE ON "subscription_invoice_archive"
        FOR EACH STATEMENT EXECUTE FUNCTION saasicat_subscription_invoice_archive_is_kept();
END
$$;

COMMIT;
