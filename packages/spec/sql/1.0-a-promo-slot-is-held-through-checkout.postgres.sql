-- =============================================================================
-- SaaSiCat 1.0 — a promo code's slot is held from the start of a checkout.
-- =============================================================================
--
-- A sign-up that starts its checkout with a promo code keeps a slot of that
-- code until the checkout concludes, or until a confirmation of its payment
-- form can no longer arrive, so that a customer who reaches the payment form is
-- not refused afterwards because somebody else took the code's last redemption
-- in between. Run it the same way as the other files in
-- this directory, before `db push` where you use one:
--
--   psql "$DATABASE_URL" -f 1.0-a-promo-slot-is-held-through-checkout.postgres.sql
--
-- What it touches, in one transaction, and only where `promo_codes` is there:
--
--   1. `promo_codes` — gains `heldCount`, the slots held for checkouts, next to
--      `redemptionsCount`. Every existing code starts at 0: no checkout held a
--      slot before this file.
--   2. `promo_code_holds` — created with its indexes and its foreign key to
--      `promo_codes`. One row per checkout offer holding a slot; the row is
--      deleted when the hold ends, so the table stays small.
--
-- Safe to run again: the column, the table and the indexes are created only
-- where they are missing, and the foreign key only where its name is not taken.
-- On a database created from `reference-schema.postgres.sql` the whole file does
-- nothing at all.

BEGIN;

DO $$
BEGIN
    IF to_regclass('promo_codes') IS NULL THEN
        RAISE NOTICE 'promo_codes is not present — nothing to do; this installation takes no promo codes.';
        RETURN;
    END IF;

    ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "heldCount" INTEGER NOT NULL DEFAULT 0;

    CREATE TABLE IF NOT EXISTS "promo_code_holds" (
        "id" TEXT NOT NULL,
        "promoCodeId" TEXT NOT NULL,
        "checkoutOfferId" TEXT NOT NULL,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "handedOverTx" BIGINT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "promo_code_holds_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "promo_code_holds_checkoutOfferId_key"
        ON "promo_code_holds"("checkoutOfferId");
    CREATE INDEX IF NOT EXISTS "promo_code_holds_promoCodeId_expiresAt_idx"
        ON "promo_code_holds"("promoCodeId", "expiresAt");
    CREATE INDEX IF NOT EXISTS "promo_code_holds_expiresAt_idx"
        ON "promo_code_holds"("expiresAt");

    -- `ADD CONSTRAINT` has no `IF NOT EXISTS`.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('promo_code_holds')
           AND conname = 'promo_code_holds_promoCodeId_fkey'
    ) THEN
        ALTER TABLE "promo_code_holds"
            ADD CONSTRAINT "promo_code_holds_promoCodeId_fkey"
            FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
