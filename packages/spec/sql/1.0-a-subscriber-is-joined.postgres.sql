-- =============================================================================
-- SaaSiCat 1.0 — a returning customer's new subscriber is joined into the one it had.
-- =============================================================================
--
-- The record of every join (`SC-ADM-027`, 27-subscriber-join.prisma), and the guard
-- that keeps a joined subscriber from being given anything afterwards. Needed
-- wherever subscribers are kept. Run it AFTER `db push`:
--
--   psql "$DATABASE_URL" -f 1.0-a-subscriber-is-joined.postgres.sql
--
-- After, because `db push` cannot create triggers. A run before it as well, as
-- an entrypoint applying every shipped file makes, does no harm; the start
-- refuses to join subscribers until the triggers are in place.
--
-- What it touches, in one transaction:
--
--   `subscriber_joins` — created with its indexes, its two foreign keys to
--   `subscribers` and a check that a subscriber is not joined into itself: who
--   was joined into whom, by whom, when, why, the digest of what the operator
--   was shown and what moved. At most one row per subscriber joined.
--
--   A trigger on every table that names a subscriber. A charge run, an
--   invoice run or a payment reads which subscriber a row belongs to before it
--   writes it, and nothing it reads is locked against a join. The trigger takes
--   the subscriber's row lock the way a foreign key check does — so a write
--   arriving while a join holds that row waits for it — and then refuses a row
--   for a subscriber that was joined into another. The write fails, and its
--   next attempt reads the subscriber the row belongs to now. The triggers are
--   the one part of this file a database created from
--   `reference-schema.postgres.sql` does not have yet.
--
-- Skipped, with a notice, where `subscribers` is missing; a table that names a
-- subscriber and is missing is skipped on its own, and gets its trigger when
-- the file is run again after it exists.
--
-- Safe to run again: the table and its indexes are created only where they are
-- missing, each constraint only where its name is not taken, and the trigger
-- function is replaced and the triggers created again in the same transaction.

BEGIN;

DO $$
BEGIN
    IF to_regclass('subscribers') IS NULL THEN
        RAISE NOTICE 'subscribers is not present — subscriber_joins is not created; run this file again after db push.';
        RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS "subscriber_joins" (
        "id" TEXT NOT NULL,
        "fromSubscriberId" TEXT NOT NULL,
        "intoSubscriberId" TEXT NOT NULL,
        "reason" TEXT NOT NULL,
        "joinedBy" TEXT NOT NULL,
        "joinedAt" TIMESTAMP(3) NOT NULL,
        "digest" TEXT NOT NULL,
        "moved" JSONB NOT NULL,
        CONSTRAINT "subscriber_joins_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_joins_fromSubscriberId_key"
        ON "subscriber_joins"("fromSubscriberId");
    CREATE INDEX IF NOT EXISTS "subscriber_joins_intoSubscriberId_idx"
        ON "subscriber_joins"("intoSubscriberId");
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriber_joins_fromSubscriberId_fkey'
    ) THEN
        ALTER TABLE "subscriber_joins"
            ADD CONSTRAINT "subscriber_joins_fromSubscriberId_fkey"
            FOREIGN KEY ("fromSubscriberId") REFERENCES "subscribers"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriber_joins_intoSubscriberId_fkey'
    ) THEN
        ALTER TABLE "subscriber_joins"
            ADD CONSTRAINT "subscriber_joins_intoSubscriberId_fkey"
            FOREIGN KEY ("intoSubscriberId") REFERENCES "subscribers"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriber_joins_not_into_itself'
    ) THEN
        ALTER TABLE "subscriber_joins"
            ADD CONSTRAINT "subscriber_joins_not_into_itself"
            CHECK ("fromSubscriberId" <> "intoSubscriberId");
    END IF;
END
$$;

-- Outside the blocks around it, because a function body cannot be created
-- inside one.
CREATE OR REPLACE FUNCTION saasicat_a_joined_subscriber_takes_nothing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- The lock a foreign key check takes: it waits for a join holding the row.
    PERFORM 1 FROM "subscribers" WHERE "id" = NEW."subscriberId" FOR KEY SHARE;
    IF EXISTS (SELECT 1 FROM "subscriber_joins" WHERE "fromSubscriberId" = NEW."subscriberId") THEN
        RAISE EXCEPTION 'Subscriber % was joined into another subscriber and takes nothing more: % on % is refused, and belongs to the subscriber it was joined into.', NEW."subscriberId", TG_OP, TG_TABLE_NAME
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END
$$;

DO $$
DECLARE
    owned TEXT;
BEGIN
    IF to_regclass('subscriber_joins') IS NULL THEN
        RETURN;
    END IF;
    FOREACH owned IN ARRAY ARRAY[
        'subscriber_tenants',
        'subscriber_corrections',
        'subscriber_tax_origin_changes',
        'subscriber_vat_id_checks',
        'subscriber_payment_methods',
        'subscriber_payment_method_setups',
        'subscriber_ledger_entries',
        'subscription_contracts',
        'subscription_invoices',
        'subscriber_payments',
        'subscriber_credits',
        'subscriber_refunds',
        'subscriber_reversals',
        'subscriber_reconciliation_cases'
    ] LOOP
        IF to_regclass(owned) IS NULL THEN
            CONTINUE;
        END IF;
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', owned || '_names_no_joined_subscriber', owned);
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "subscriberId" ON %I '
                'FOR EACH ROW EXECUTE FUNCTION saasicat_a_joined_subscriber_takes_nothing()',
            owned || '_names_no_joined_subscriber',
            owned
        );
    END LOOP;
END
$$;

COMMIT;
