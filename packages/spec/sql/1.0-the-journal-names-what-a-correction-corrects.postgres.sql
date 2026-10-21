-- =============================================================================
-- SaaSiCat 1.0 — a correction in the journal names what it corrects.
-- =============================================================================
--
-- A counter-entry (`origin = 'correction'`) names the charge it corrects, the
-- invoice that charge stood on — the one cancelled — and the reason, so a
-- cancellation can say a charge was not owed, or not in full, without editing
-- it (`SC-PRIC-020`, #334 step 6e-2). Needed where `tenantBilling.chargeJournal`
-- is configured. Run it BEFORE `db push`, and after
-- `1.0-a-subscriber-account-records-its-charges.postgres.sql`, which creates
-- the journal:
--
--   psql "$DATABASE_URL" -f 1.0-the-journal-names-what-a-correction-corrects.postgres.sql
--
-- What it touches, in one transaction, on `subscriber_ledger_entries`:
--
--   `correctsChargeId`, `correctedInvoiceId`, `correctionReason` — added,
--   empty on every charge there is. Nothing writes a correction before this
--   release, so there is nothing to fill.
--   An index and a foreign key on `correctsChargeId`, to the charge it names.
--   The check `subscriber_ledger_entries_correction_names_its_charge` from
--   `constraints.postgres.sql`: a correction names all three, with a reason
--   that says something, and moves its charge by an amount, and no other
--   charge names any. Refused, with a sentence, where a `correction` row is
--   already there that does not — written by hand, since no release wrote one.
--
-- Skipped, with a notice, where the journal is not there.
--
-- Safe to run again: each column and the index are added only where missing,
-- the foreign key only where its name is not taken. The check is dropped and
-- added again on every run, after the refusal above: `ADD CONSTRAINT` has no
-- `IF NOT EXISTS`, and a check of its name that asks for something else would
-- otherwise stay. On a database created from `reference-schema.postgres.sql`
-- the whole file leaves the schema as it found it.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscriber_ledger_entries') IS NULL THEN
        RAISE NOTICE 'subscriber_ledger_entries is not present — no charge journal, so nothing names a correction.';
        RETURN;
    END IF;

    ALTER TABLE "subscriber_ledger_entries" ADD COLUMN IF NOT EXISTS "correctsChargeId" TEXT;
    ALTER TABLE "subscriber_ledger_entries" ADD COLUMN IF NOT EXISTS "correctedInvoiceId" TEXT;
    ALTER TABLE "subscriber_ledger_entries" ADD COLUMN IF NOT EXISTS "correctionReason" TEXT;

    CREATE INDEX IF NOT EXISTS "subscriber_ledger_entries_correctsChargeId_idx"
        ON "subscriber_ledger_entries"("correctsChargeId");

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'subscriber_ledger_entries_correctsChargeId_fkey'
    ) THEN
        ALTER TABLE "subscriber_ledger_entries"
            ADD CONSTRAINT "subscriber_ledger_entries_correctsChargeId_fkey"
            FOREIGN KEY ("correctsChargeId") REFERENCES "subscriber_ledger_entries"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF EXISTS (
        SELECT 1 FROM "subscriber_ledger_entries"
         WHERE "origin" = 'correction'
           AND NOT COALESCE(
                   "correctsChargeId" IS NOT NULL AND "correctedInvoiceId" IS NOT NULL
                   AND "correctionReason" IS NOT NULL
                   AND "correctionReason" ~ '\S' AND "amountNet" <> 0,
                   false)
    ) THEN
        RAISE EXCEPTION 'subscriber_ledger_entries holds a correction that does not name the charge it corrects, the invoice it stood on and a reason, or that moves it by nothing. No release wrote one: find it, make it name what it corrects and move it by an amount, or remove it, and run this file again.';
    END IF;
    ALTER TABLE "subscriber_ledger_entries"
        DROP CONSTRAINT IF EXISTS "subscriber_ledger_entries_correction_names_its_charge";
    ALTER TABLE "subscriber_ledger_entries"
        ADD CONSTRAINT "subscriber_ledger_entries_correction_names_its_charge"
        CHECK (CASE WHEN "origin" = 'correction'
            THEN "correctsChargeId" IS NOT NULL AND "correctedInvoiceId" IS NOT NULL
                AND "correctionReason" IS NOT NULL
                AND "correctionReason" ~ '\S' AND "amountNet" <> 0
            ELSE "correctsChargeId" IS NULL AND "correctedInvoiceId" IS NULL
                AND "correctionReason" IS NULL END);
END
$$;

COMMIT;
