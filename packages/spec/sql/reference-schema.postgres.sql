-- =============================================================================
-- SaaSiCat — PostgreSQL reference schema (DERIVED ARTIFACT).
-- =============================================================================
--
-- Generated via `pnpm run gen:sql` from the prisma-fragments:
--   prisma-fragments/01-subscription.prisma
--   prisma-fragments/02-promo-code.prisma
--   prisma-fragments/03-plan-versions.prisma
--   prisma-fragments/04-audit-log.prisma
--   prisma-fragments/05-bundle.prisma
--   prisma-fragments/06-catalog-entries.prisma
--   prisma-fragments/07-promotion.prisma
--   prisma-fragments/08-subscription-contract.prisma
--   prisma-fragments/09-pending-registration.prisma
--   prisma-fragments/10-super-admin.prisma
--   prisma-fragments/11-subscription-bundle.prisma
--   prisma-fragments/12-applied-settings.prisma
--   prisma-fragments/13-subscriber.prisma
--   prisma-fragments/14-payments.prisma
--   prisma-fragments/15-subscriber-ledger.prisma
-- plus the normative constraints from sql/constraints.postgres.sql.
-- Do not edit by hand — change the fragments/constraints and regenerate.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'PENDING_SALES');

-- CreateEnum
CREATE TYPE "PromoCodeValueType" AS ENUM ('PERCENT', 'ABSOLUTE');

-- CreateEnum
CREATE TYPE "PromoCodeDurationType" AS ENUM ('ONCE', 'MONTHS', 'BILLING_CYCLES');

-- CreateEnum
CREATE TYPE "PromoCodeStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXHAUSTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PromoCodeRedemptionStatus" AS ENUM ('ACTIVE', 'REVERSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionContractStatus" AS ENUM ('active', 'scheduled', 'terminated', 'superseded');

-- CreateEnum
CREATE TYPE "ContractLineItemKind" AS ENUM ('plan', 'bundle', 'quota', 'feature', 'discount');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING_EMAIL_VERIFICATION', 'EMAIL_VERIFIED', 'PLAN_SELECTED', 'CHECKOUT_STARTED', 'EXPIRED', 'DELETED');

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'YEARLY',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trialEndsAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "canceledEffectiveAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "minimumTermUntil" TIMESTAMP(3),
    "billingAnchorDay" INTEGER,
    "planVersionId" TEXT NOT NULL,
    "pendingPlanVersionId" TEXT,
    "pendingPlanVersionEffectiveAt" TIMESTAMP(3),
    "pendingPlanVersionAccepted" BOOLEAN NOT NULL DEFAULT false,
    "pendingPlanVersionAcceptedAt" TIMESTAMP(3),
    "pendingPlanVersionAcceptedByUserId" TEXT,
    "pendingPlanVersionNotifiedAt" TIMESTAMP(3),
    "pendingPlanVersionReminderSentAt" TIMESTAMP(3),
    "trialEntitlementPlan" TEXT,
    "postTrialPlan" TEXT,
    "pendingPlan" TEXT,
    "pendingBillingCycle" "BillingCycle",
    "pendingEffectiveAt" TIMESTAMP(3),
    "customMonthlyNet" DECIMAL(10,2),
    "customLimits" JSONB,
    "customNote" TEXT,
    "isPilot" BOOLEAN NOT NULL DEFAULT false,
    "pilotEndsAt" TIMESTAMP(3),
    "pilotNote" TEXT,
    "checkoutOfferId" TEXT,
    "packageSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_offers" (
    "id" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "planVersionId" TEXT,
    "billingCycle" TEXT NOT NULL,
    "promotionId" TEXT,
    "promoCode" TEXT,
    "bundles" JSONB NOT NULL DEFAULT '[]',
    "bundleVersionIds" JSONB NOT NULL DEFAULT '[]',
    "priceBreakdown" JSONB NOT NULL,
    "lineItems" JSONB NOT NULL DEFAULT '[]',
    "promotionSnapshots" JSONB NOT NULL DEFAULT '[]',
    "promoCodeSnapshot" JSONB,
    "locale" TEXT NOT NULL DEFAULT 'de',
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "valueType" "PromoCodeValueType" NOT NULL,
    "value" DECIMAL(8,2) NOT NULL,
    "durationType" "PromoCodeDurationType" NOT NULL DEFAULT 'ONCE',
    "durationValue" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "redemptionsCount" INTEGER NOT NULL DEFAULT 0,
    "heldCount" INTEGER NOT NULL DEFAULT 0,
    "appliesToPlans" TEXT[],
    "appliesToBilling" "BillingCycle",
    "firstTimeCustomersOnly" BOOLEAN NOT NULL DEFAULT true,
    "minimumPlanAmountGross" DECIMAL(10,2),
    "allowZeroInvoice" BOOLEAN NOT NULL DEFAULT false,
    "status" "PromoCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "campaignTag" TEXT,
    "revenueDeductionAccount" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_redemptions" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "appliedValueType" "PromoCodeValueType" NOT NULL,
    "appliedValue" DECIMAL(8,2) NOT NULL,
    "appliedDurationType" "PromoCodeDurationType" NOT NULL,
    "appliedDurationValue" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "status" "PromoCodeRedemptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_holds" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "checkoutOfferId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "handedOverTx" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_validation_logs" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT,
    "codeAttempt" TEXT NOT NULL,
    "ipHash" TEXT,
    "sessionId" TEXT,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_validation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_versions" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "baseVersionId" TEXT,
    "features" JSONB NOT NULL,
    "quotas" JSONB NOT NULL,
    "monthlyNet" DECIMAL(10,2) NOT NULL,
    "yearlyNet" DECIMAL(10,2) NOT NULL,
    "marketed" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "publishedChanges" JSONB,
    "changeNote" TEXT NOT NULL,
    "nonRegressive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "actorTag" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundles" (
    "id" TEXT NOT NULL,
    "bundleKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "i18n" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_versions" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "baseVersionId" TEXT,
    "features" JSONB NOT NULL,
    "quotas" JSONB NOT NULL DEFAULT '{}',
    "compatibility" JSONB NOT NULL DEFAULT '{}',
    "pricingOverrides" JSONB NOT NULL DEFAULT '[]',
    "monthlyNet" DECIMAL(10,2),
    "yearlyNet" DECIMAL(10,2),
    "marketed" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "publishedChanges" JSONB,
    "changeNote" TEXT NOT NULL DEFAULT '',
    "nonRegressive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bundle_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capability_catalog_entries" (
    "id" TEXT NOT NULL,
    "capabilityKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "featureKey" TEXT,
    "bundleKey" TEXT,
    "codeStatus" TEXT NOT NULL DEFAULT 'active',
    "owner" TEXT,
    "kind" TEXT NOT NULL,
    "replacementKey" TEXT,
    "deprecatedAt" TIMESTAMP(3),
    "removalPlannedAt" TIMESTAMP(3),
    "reason" TEXT,
    "i18n" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "capability_catalog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_catalog_entries" (
    "id" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "marketingLabel" TEXT,
    "marketingDescription" TEXT,
    "icon" TEXT,
    "tier" TEXT,
    "core" BOOLEAN NOT NULL DEFAULT false,
    "requires" TEXT[],
    "replaces" TEXT[],
    "successorKey" TEXT,
    "discoveryStatus" TEXT NOT NULL DEFAULT 'pending',
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedSignature" TEXT,
    "plannedOnly" BOOLEAN NOT NULL DEFAULT false,
    "i18n" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "feature_catalog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_catalog_entries" (
    "id" TEXT NOT NULL,
    "quotaKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL,
    "featureKey" TEXT,
    "usageProvider" TEXT,
    "enforcementMode" TEXT NOT NULL DEFAULT 'soft',
    "discoveryStatus" TEXT NOT NULL DEFAULT 'pending',
    "replaces" TEXT[],
    "successorKey" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedSignature" TEXT,
    "i18n" JSONB NOT NULL DEFAULT '{}',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "quota_catalog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_projections" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetVersionId" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'de',
    "displayLabel" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "badge" TEXT NOT NULL DEFAULT '',
    "topFeatures" JSONB NOT NULL DEFAULT '[]',
    "trialEnabled" BOOLEAN NOT NULL DEFAULT false,
    "trialDays" INTEGER NOT NULL DEFAULT 30,
    "priceTag" TEXT,
    "ctaLabel" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_settings" (
    "id" TEXT NOT NULL DEFAULT 'marketing-settings',
    "activeLocales" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "internalLabel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT 'PLAN',
    "appliesTo" JSONB NOT NULL DEFAULT '[]',
    "billingCycle" TEXT NOT NULL DEFAULT 'both',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "onlyLocales" JSONB,
    "requiresCoupon" BOOLEAN NOT NULL DEFAULT false,
    "codes" JSONB NOT NULL DEFAULT '[]',
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "i18n" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "subscriberSnapshot" JSONB NOT NULL,
    "issuerSnapshot" JSONB,
    "partiesMigrated" BOOLEAN NOT NULL DEFAULT false,
    "status" "SubscriptionContractStatus" NOT NULL DEFAULT 'active',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "originalOfferId" TEXT,
    "originalPlanVersionId" TEXT,
    "originalBundleVersionIds" JSONB NOT NULL DEFAULT '[]',
    "entitlementSnapshot" JSONB,
    "priceSnapshot" JSONB NOT NULL,
    "promotionSnapshots" JSONB NOT NULL DEFAULT '[]',
    "promoCodeSnapshots" JSONB NOT NULL DEFAULT '[]',
    "termsSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_line_items" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" "ContractLineItemKind" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceVersionId" TEXT,
    "titleSnapshot" TEXT NOT NULL,
    "descriptionSnapshot" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT,
    "priceNet" DECIMAL(10,2) NOT NULL,
    "priceGross" DECIMAL(10,2) NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "taxRate" DECIMAL(5,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "minimumTermUntil" TIMESTAMP(3),
    "featuresSnapshot" JSONB NOT NULL DEFAULT '[]',
    "quotaEffectsSnapshot" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingRegistration" (
    "id" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "tenantSlug" TEXT,
    "salutation" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'de',
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING_EMAIL_VERIFICATION',
    "currentStep" INTEGER NOT NULL DEFAULT 2,
    "emailVerifiedAt" TIMESTAMP(3),
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpSendCount" INTEGER NOT NULL DEFAULT 1,
    "lastOtpSentAt" TIMESTAMP(3),
    "otpAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "selectedPlanId" TEXT,
    "configJson" JSONB,
    "billingCycle" TEXT,
    "appliedPromoCode" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT,
    "vatId" TEXT,
    "taxNumber" TEXT,
    "checkoutSessionId" TEXT,
    "checkoutGatewayAccount" TEXT,
    "gatewayCustomerRef" TEXT,
    "checkoutStartedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "super_admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "platformRole" TEXT NOT NULL DEFAULT 'SUPER_ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "super_admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "super_admin_mfa" (
    "userId" TEXT NOT NULL,
    "secret" TEXT,
    "enabledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "super_admin_mfa_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "subscription_bundles" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "bundleVersionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "minimumTermEndsAt" TIMESTAMP(3),
    "billingCycle" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "canceledEffectiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applied_settings" (
    "id" TEXT NOT NULL DEFAULT 'installation',
    "fingerprint" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applied_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings_changes" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "noticedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "current" JSONB NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,

    CONSTRAINT "settings_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscribers" (
    "id" TEXT NOT NULL,
    "customerSequence" SERIAL NOT NULL,
    "customerNumberPrefix" TEXT NOT NULL DEFAULT '',
    "legalName" TEXT NOT NULL,
    "vatId" TEXT,
    "taxNumber" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "country" TEXT,
    "invoiceEmail" TEXT,
    "migrated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriber_tenants" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlinkedAt" TIMESTAMP(3),

    CONSTRAINT "subscriber_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriber_corrections" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "previous" JSONB NOT NULL,
    "corrected" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedBy" TEXT NOT NULL,
    "correctedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriber_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriber_payment_methods" (
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

-- CreateTable
CREATE TABLE "subscriber_payment_method_setups" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "gatewayAccount" TEXT NOT NULL,
    "sessionRef" TEXT NOT NULL,
    "customerRef" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "subscriber_payment_method_setups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEventLog" (
    "id" TEXT NOT NULL,
    "gatewayAccount" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriber_ledger_entries" (
    "id" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "contractLineItemId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "amountNet" DECIMAL(10,2) NOT NULL,
    "bookedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriber_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenantId_key" ON "subscriptions"("tenantId");

-- CreateIndex
CREATE INDEX "subscriptions_tenantId_idx" ON "subscriptions"("tenantId");

-- CreateIndex
CREATE INDEX "subscriptions_planVersionId_idx" ON "subscriptions"("planVersionId");

-- CreateIndex
CREATE INDEX "subscriptions_pendingPlanVersionId_idx" ON "subscriptions"("pendingPlanVersionId");

-- CreateIndex
CREATE INDEX "subscriptions_currentPeriodEnd_idx" ON "subscriptions"("currentPeriodEnd");

-- CreateIndex
CREATE INDEX "checkout_offers_status_idx" ON "checkout_offers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_codes_status_validFrom_validUntil_idx" ON "promo_codes"("status", "validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "promo_codes_campaignTag_idx" ON "promo_codes"("campaignTag");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_redemptions_subscriptionId_key" ON "promo_code_redemptions"("subscriptionId");

-- CreateIndex
CREATE INDEX "promo_code_redemptions_tenantId_idx" ON "promo_code_redemptions"("tenantId");

-- CreateIndex
CREATE INDEX "promo_code_redemptions_promoCodeId_status_idx" ON "promo_code_redemptions"("promoCodeId", "status");

-- CreateIndex
CREATE INDEX "promo_code_redemptions_startsAt_endsAt_idx" ON "promo_code_redemptions"("startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_holds_checkoutOfferId_key" ON "promo_code_holds"("checkoutOfferId");

-- CreateIndex
CREATE INDEX "promo_code_holds_promoCodeId_expiresAt_idx" ON "promo_code_holds"("promoCodeId", "expiresAt");

-- CreateIndex
CREATE INDEX "promo_code_holds_expiresAt_idx" ON "promo_code_holds"("expiresAt");

-- CreateIndex
CREATE INDEX "promo_code_validation_logs_codeAttempt_createdAt_idx" ON "promo_code_validation_logs"("codeAttempt", "createdAt");

-- CreateIndex
CREATE INDEX "promo_code_validation_logs_ipHash_createdAt_idx" ON "promo_code_validation_logs"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "promo_code_validation_logs_sessionId_createdAt_idx" ON "promo_code_validation_logs"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "plans_deletedAt_idx" ON "plans"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "plans_planKey_key" ON "plans"("planKey");

-- CreateIndex
CREATE INDEX "plan_versions_planId_supersededAt_idx" ON "plan_versions"("planId", "supersededAt");

-- CreateIndex
CREATE INDEX "plan_versions_planId_publishedAt_idx" ON "plan_versions"("planId", "publishedAt");

-- CreateIndex
CREATE INDEX "plan_versions_planId_validFrom_idx" ON "plan_versions"("planId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "plan_versions_planId_version_key" ON "plan_versions"("planId", "version");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entity_entityId_idx" ON "audit_logs"("tenantId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_action_createdAt_idx" ON "audit_logs"("entity", "action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorTag_createdAt_idx" ON "audit_logs"("actorTag", "createdAt");

-- CreateIndex
CREATE INDEX "bundles_deletedAt_idx" ON "bundles"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bundles_bundleKey_key" ON "bundles"("bundleKey");

-- CreateIndex
CREATE INDEX "bundle_versions_bundleId_supersededAt_idx" ON "bundle_versions"("bundleId", "supersededAt");

-- CreateIndex
CREATE INDEX "bundle_versions_bundleId_publishedAt_idx" ON "bundle_versions"("bundleId", "publishedAt");

-- CreateIndex
CREATE INDEX "bundle_versions_bundleId_validFrom_idx" ON "bundle_versions"("bundleId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_versions_bundleId_version_key" ON "bundle_versions"("bundleId", "version");

-- CreateIndex
CREATE INDEX "capability_catalog_entries_codeStatus_idx" ON "capability_catalog_entries"("codeStatus");

-- CreateIndex
CREATE INDEX "capability_catalog_entries_featureKey_idx" ON "capability_catalog_entries"("featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "capability_catalog_entries_capabilityKey_key" ON "capability_catalog_entries"("capabilityKey");

-- CreateIndex
CREATE INDEX "feature_catalog_entries_discoveryStatus_idx" ON "feature_catalog_entries"("discoveryStatus");

-- CreateIndex
CREATE INDEX "feature_catalog_entries_plannedOnly_idx" ON "feature_catalog_entries"("plannedOnly");

-- CreateIndex
CREATE UNIQUE INDEX "feature_catalog_entries_featureKey_key" ON "feature_catalog_entries"("featureKey");

-- CreateIndex
CREATE INDEX "quota_catalog_entries_discoveryStatus_idx" ON "quota_catalog_entries"("discoveryStatus");

-- CreateIndex
CREATE UNIQUE INDEX "quota_catalog_entries_quotaKey_key" ON "quota_catalog_entries"("quotaKey");

-- CreateIndex
CREATE INDEX "marketing_projections_targetType_locale_priority_idx" ON "marketing_projections"("targetType", "locale", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_projections_targetType_targetVersionId_locale_key" ON "marketing_projections"("targetType", "targetVersionId", "locale");

-- CreateIndex
CREATE INDEX "promotions_targetType_validFrom_validTo_idx" ON "promotions"("targetType", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "subscription_contracts_tenantId_status_effectiveFrom_idx" ON "subscription_contracts"("tenantId", "status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "subscription_contracts_subscriberId_idx" ON "subscription_contracts"("subscriberId");

-- CreateIndex
CREATE INDEX "subscription_contracts_status_idx" ON "subscription_contracts"("status");

-- CreateIndex
CREATE INDEX "subscription_contracts_originalOfferId_idx" ON "subscription_contracts"("originalOfferId");

-- CreateIndex
CREATE INDEX "contract_line_items_contractId_kind_idx" ON "contract_line_items"("contractId", "kind");

-- CreateIndex
CREATE INDEX "contract_line_items_sourceVersionId_idx" ON "contract_line_items"("sourceVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "PendingRegistration_email_key" ON "PendingRegistration"("email");

-- CreateIndex
CREATE INDEX "PendingRegistration_status_expiresAt_idx" ON "PendingRegistration"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PendingRegistration_tenantSlug_idx" ON "PendingRegistration"("tenantSlug");

-- CreateIndex
CREATE INDEX "PendingRegistration_checkoutGatewayAccount_checkoutSessionI_idx" ON "PendingRegistration"("checkoutGatewayAccount", "checkoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "super_admin_users_email_key" ON "super_admin_users"("email");

-- CreateIndex
CREATE INDEX "super_admin_users_isActive_deletedAt_idx" ON "super_admin_users"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "subscription_bundles_subscriptionId_idx" ON "subscription_bundles"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_bundles_bundleVersionId_idx" ON "subscription_bundles"("bundleVersionId");

-- CreateIndex
CREATE INDEX "subscription_bundles_canceledEffectiveAt_idx" ON "subscription_bundles"("canceledEffectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "settings_changes_seq_key" ON "settings_changes"("seq");

-- CreateIndex
CREATE INDEX "settings_changes_acknowledgedAt_noticedAt_idx" ON "settings_changes"("acknowledgedAt", "noticedAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_customerSequence_key" ON "subscribers"("customerSequence");

-- CreateIndex
CREATE INDEX "subscriber_tenants_tenantId_idx" ON "subscriber_tenants"("tenantId");

-- CreateIndex
CREATE INDEX "subscriber_tenants_subscriberId_idx" ON "subscriber_tenants"("subscriberId");

-- CreateIndex
CREATE INDEX "subscriber_corrections_subscriberId_correctedAt_idx" ON "subscriber_corrections"("subscriberId", "correctedAt");

-- CreateIndex
CREATE INDEX "subscriber_payment_methods_subscriberId_status_idx" ON "subscriber_payment_methods"("subscriberId", "status");

-- CreateIndex
CREATE INDEX "subscriber_payment_methods_gatewayAccount_status_idx" ON "subscriber_payment_methods"("gatewayAccount", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriber_payment_methods_gatewayAccount_paymentMethodRef_key" ON "subscriber_payment_methods"("gatewayAccount", "paymentMethodRef");

-- CreateIndex
CREATE INDEX "subscriber_payment_method_setups_subscriberId_idx" ON "subscriber_payment_method_setups"("subscriberId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriber_payment_method_setups_gatewayAccount_sessionRef_key" ON "subscriber_payment_method_setups"("gatewayAccount", "sessionRef");

-- CreateIndex
CREATE INDEX "PaymentEventLog_sessionId_idx" ON "PaymentEventLog"("sessionId");

-- CreateIndex
CREATE INDEX "PaymentEventLog_status_processedAt_idx" ON "PaymentEventLog"("status", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEventLog_gatewayAccount_eventId_key" ON "PaymentEventLog"("gatewayAccount", "eventId");

-- CreateIndex
CREATE INDEX "subscriber_ledger_entries_subscriberId_bookedAt_idx" ON "subscriber_ledger_entries"("subscriberId", "bookedAt");

-- CreateIndex
CREATE INDEX "subscriber_ledger_entries_contractLineItemId_idx" ON "subscriber_ledger_entries"("contractLineItemId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriber_ledger_entries_subscriptionId_source_sourceRef_p_key" ON "subscriber_ledger_entries"("subscriptionId", "source", "sourceRef", "periodStart", "origin");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "plan_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pendingPlanVersionId_fkey" FOREIGN KEY ("pendingPlanVersionId") REFERENCES "plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_holds" ADD CONSTRAINT "promo_code_holds_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_validation_logs" ADD CONSTRAINT "promo_code_validation_logs_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_versions" ADD CONSTRAINT "bundle_versions_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_versions" ADD CONSTRAINT "bundle_versions_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "bundle_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_contracts" ADD CONSTRAINT "subscription_contracts_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_line_items" ADD CONSTRAINT "contract_line_items_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "subscription_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_bundles" ADD CONSTRAINT "subscription_bundles_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_bundles" ADD CONSTRAINT "subscription_bundles_bundleVersionId_fkey" FOREIGN KEY ("bundleVersionId") REFERENCES "bundle_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_tenants" ADD CONSTRAINT "subscriber_tenants_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_corrections" ADD CONSTRAINT "subscriber_corrections_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_payment_methods" ADD CONSTRAINT "subscriber_payment_methods_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_payment_method_setups" ADD CONSTRAINT "subscriber_payment_method_setups_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_ledger_entries" ADD CONSTRAINT "subscriber_ledger_entries_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_ledger_entries" ADD CONSTRAINT "subscriber_ledger_entries_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "subscription_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_ledger_entries" ADD CONSTRAINT "subscriber_ledger_entries_contractLineItemId_fkey" FOREIGN KEY ("contractLineItemId") REFERENCES "contract_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- A subscriber is live for at most ONE tenant, and a tenant has at most ONE
-- live subscriber. A link that ended keeps its row with `unlinkedAt` set, so the
-- tenants a subscriber had before stay in its history. Two partial unique
-- indexes, because a link that is over must not count against the next one.
CREATE UNIQUE INDEX IF NOT EXISTS subscriber_tenants_live_per_tenant
    ON subscriber_tenants ("tenantId") WHERE "unlinkedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriber_tenants_live_per_subscriber
    ON subscriber_tenants ("subscriberId") WHERE "unlinkedAt" IS NULL;

-- A subscriber has at most ONE payment method in use. The one a newer payment
-- method replaced keeps its row as `REPLACED`, so it does not count here.
CREATE UNIQUE INDEX IF NOT EXISTS subscriber_payment_methods_active_per_subscriber
    ON subscriber_payment_methods ("subscriberId") WHERE "status" = 'ACTIVE';

-- A gateway session is confirmed ONCE.
--
-- A gateway delivers every event at least once, and it may report one session
-- through more than one event — a completed form and the payment method behind
-- it can arrive as two. `eventId` tells those apart, so both would be claimed,
-- and both would record the session's payment method: for a sign-up that means
-- a second tenant for one registration.
--
-- Both adapters claim with `ON CONFLICT DO NOTHING` and no conflict target, so
-- this index turns the second confirmation into no row rather than an error,
-- and the caller reads it as the duplicate it is. Partial on the kind, because
-- a failed setup and an event SaaSiCat does not act on say nothing about the
-- session being confirmed. A claim carrying no session does not collide:
-- PostgreSQL counts nulls as distinct in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS payment_event_log_confirmation_per_session
    ON "PaymentEventLog" ("gatewayAccount", "sessionId")
    WHERE "status" = 'payment-method-confirmed';

-- Customer numbers count from 10001, so a number has five digits up to 99999
-- and none reads as a count of subscribers. Two statements: the first makes
-- 10001 where the sequence starts over, which a restart of its identity reads,
-- and the second moves a sequence that has never handed out a number there. A
-- second run finds the start already set and the sequence used, and an
-- installation without the subscriber tables has no such sequence.
ALTER SEQUENCE IF EXISTS "subscribers_customerSequence_seq" START WITH 10001;

SELECT setval(format('%I.%I', schemaname, sequencename)::regclass, 10001, false)
  FROM pg_sequences
 WHERE schemaname = current_schema()
   AND sequencename = 'subscribers_customerSequence_seq'
   AND last_value IS NULL;
