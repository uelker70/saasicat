-- =============================================================================
-- SaaSiCat 1.0 — a payment method is the gateway's reference, kept for the subscriber.
-- =============================================================================
--
-- SaaSiCat takes payment methods through a payment gateway: the person enters
-- the card or the IBAN in the gateway's own form, and SaaSiCat keeps the
-- gateway's reference with the masked details, for the subscriber (ADR 0012).
-- Run it BEFORE `db push`, and after
-- `1.0-a-contract-names-its-subscriber.postgres.sql`, whose `subscribers` table
-- it points at:
--
--   psql "$DATABASE_URL" -f 1.0-a-payment-method-is-a-gateway-reference.postgres.sql
--
-- What it touches, in one transaction, each part only where its table is there:
--
--   1. `subscriber_payment_methods` — created with its indexes, its foreign key
--      to `subscribers` and the partial unique index that allows one payment
--      method in use per subscriber. Skipped where `subscribers` is missing.
--   2. `"PaymentEventLog"` — gains `gatewayAccount`. An event identifier is
--      unique only within the gateway account that sent it, so the unique index
--      on `eventId` alone is replaced by one on both. An event recorded before
--      this file carries no account; it is given its `provider` as one, which
--      keeps the old identifiers unique and matches no account a gateway sends
--      from now on.
--   3. `"PendingRegistration"` — gains the billing details step 4 asks for,
--      `checkoutGatewayAccount` and `gatewayCustomerRef`. A sign-up whose
--      checkout started before this file has no account beside its session, so
--      no confirmation can find it; the person repeats step 4.
--
-- What it leaves alone: `subscription_payment_methods` and the enum
-- `SubscriptionPaymentType`. The fragments no longer declare them, and nothing
-- in SaaSiCat reads them, but an application may still write there and the rows
-- are its own. Drop both once nothing does — `docs/guides/upgrade-to-1.0.md`
-- has the statements. `db push` offers to drop them as well.
--
-- Safe to run again: every table, column and index is created only where it is
-- missing, the foreign key only where its name is not taken, the event log's
-- account is filled only where it is empty, and the old unique index is dropped
-- only where it still exists. On a database created from
-- `reference-schema.postgres.sql` the whole file does nothing at all.

BEGIN;

DO $$
BEGIN
    -- 1. The payment methods, for the subscriber ------------------------------

    IF to_regclass('subscribers') IS NULL THEN
        RAISE NOTICE 'subscribers is not present — subscriber_payment_methods is not created; run 1.0-a-contract-names-its-subscriber.postgres.sql first where contracts are kept.';
    ELSE
        CREATE TABLE IF NOT EXISTS "subscriber_payment_methods" (
            "id" TEXT NOT NULL,
            "subscriberId" TEXT NOT NULL,
            "gatewayAccount" TEXT NOT NULL,
            "provider" TEXT NOT NULL,
            "customerRef" TEXT NOT NULL,
            "paymentMethodRef" TEXT NOT NULL,
            "type" TEXT NOT NULL,
            "brand" TEXT,
            "last4" TEXT NOT NULL,
            "expiryMonth" INTEGER,
            "expiryYear" INTEGER,
            "country" TEXT,
            "bankCode" TEXT,
            "mandateReference" TEXT,
            "status" TEXT NOT NULL DEFAULT 'ACTIVE',
            "confirmedAt" TIMESTAMP(3) NOT NULL,
            "replacedAt" TIMESTAMP(3),
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "subscriber_payment_methods_pkey" PRIMARY KEY ("id")
        );
        CREATE INDEX IF NOT EXISTS "subscriber_payment_methods_subscriberId_status_idx"
            ON "subscriber_payment_methods"("subscriberId", "status");
        CREATE INDEX IF NOT EXISTS "subscriber_payment_methods_gatewayAccount_status_idx"
            ON "subscriber_payment_methods"("gatewayAccount", "status");
        CREATE UNIQUE INDEX IF NOT EXISTS "subscriber_payment_methods_gatewayAccount_paymentMethodRef_key"
            ON "subscriber_payment_methods"("gatewayAccount", "paymentMethodRef");
        CREATE UNIQUE INDEX IF NOT EXISTS subscriber_payment_methods_active_per_subscriber
            ON subscriber_payment_methods ("subscriberId") WHERE "status" = 'ACTIVE';

        -- `ADD CONSTRAINT` has no `IF NOT EXISTS`.
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conrelid = to_regclass('subscriber_payment_methods')
               AND conname = 'subscriber_payment_methods_subscriberId_fkey'
        ) THEN
            ALTER TABLE "subscriber_payment_methods"
                ADD CONSTRAINT "subscriber_payment_methods_subscriberId_fkey"
                FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id")
                ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
    END IF;

    -- 2. Gateway events, per account ------------------------------------------

    IF to_regclass('"PaymentEventLog"') IS NULL THEN
        RAISE NOTICE 'PaymentEventLog is not present — an installation without self-registration; left alone.';
    ELSE
        ALTER TABLE "PaymentEventLog" ADD COLUMN IF NOT EXISTS "gatewayAccount" TEXT;
        UPDATE "PaymentEventLog" SET "gatewayAccount" = "provider" WHERE "gatewayAccount" IS NULL;
        ALTER TABLE "PaymentEventLog" ALTER COLUMN "gatewayAccount" SET NOT NULL;
        DROP INDEX IF EXISTS "PaymentEventLog_eventId_key";
        CREATE UNIQUE INDEX IF NOT EXISTS "PaymentEventLog_gatewayAccount_eventId_key"
            ON "PaymentEventLog"("gatewayAccount", "eventId");
    END IF;

    -- 3. Sign-up: billing details and the account a session belongs to -------

    IF to_regclass('"PendingRegistration"') IS NULL THEN
        RAISE NOTICE 'PendingRegistration is not present — an installation without self-registration; left alone.';
    ELSE
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "addressLine1" TEXT;
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "addressLine2" TEXT;
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "city" TEXT;
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "country" TEXT;
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "vatId" TEXT;
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "taxNumber" TEXT;
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "checkoutGatewayAccount" TEXT;
        ALTER TABLE "PendingRegistration" ADD COLUMN IF NOT EXISTS "gatewayCustomerRef" TEXT;
        CREATE INDEX IF NOT EXISTS "PendingRegistration_checkoutGatewayAccount_checkoutSessionI_idx"
            ON "PendingRegistration"("checkoutGatewayAccount", "checkoutSessionId");
    END IF;
END $$;

COMMIT;
