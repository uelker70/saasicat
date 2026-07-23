-- =============================================================================
-- SaaSicat — PostgreSQL reference schema (DERIVED ARTIFACT).
-- =============================================================================
--
-- Generated via `pnpm run gen:sql` from the prisma-fragments:
--   prisma-fragments/01-subscription.prisma
--   prisma-fragments/02-promo-code.prisma
--   prisma-fragments/03-plan-versions.prisma
--   prisma-fragments/04-audit-log.prisma
--   prisma-fragments/05-bundle-business-type.prisma
--   prisma-fragments/06-catalog-entries.prisma
--   prisma-fragments/07-promotion.prisma
--   prisma-fragments/08-subscription-contract.prisma
--   prisma-fragments/09-pending-registration.prisma
--   prisma-fragments/10-super-admin.prisma
--   prisma-fragments/11-subscription-bundle.prisma
-- plus the normative constraints from sql/constraints.postgres.sql.
-- Do not edit by hand — change the fragments/constraints and regenerate.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'PENDING_SALES');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentType" AS ENUM ('CARD', 'SEPA', 'PAYPAL', 'KLARNA', 'INVOICE');

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
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "planVersionId" TEXT,
    "pendingPlanVersionId" TEXT,
    "pendingPlanVersionEffectiveAt" TIMESTAMP(3),
    "pendingPlanVersionAccepted" BOOLEAN NOT NULL DEFAULT false,
    "pendingPlanVersionAcceptedAt" TIMESTAMP(3),
    "pendingPlanVersionAcceptedByUserId" TEXT,
    "pendingPlanVersionNotifiedAt" TIMESTAMP(3),
    "pendingPlanVersionReminderSentAt" TIMESTAMP(3),
    "businessTypeVersionId" TEXT,
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
CREATE TABLE "subscription_payment_methods" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" "SubscriptionPaymentType" NOT NULL,
    "cardName" TEXT,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "cardExp" TEXT,
    "ibanLast4" TEXT,
    "ibanName" TEXT,
    "paypalEmail" TEXT,
    "klarnaPlan" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_offers" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
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
    "appliesToPlans" TEXT[],
    "appliesToBilling" "BillingCycle",
    "firstTimeCustomersOnly" BOOLEAN NOT NULL DEFAULT true,
    "minimumPlanAmountGross" DECIMAL(10,2),
    "allowZeroInvoice" BOOLEAN NOT NULL DEFAULT false,
    "status" "PromoCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "campaignTag" TEXT,
    "revenueDeductionAccount" TEXT,
    "createdById" TEXT NOT NULL,
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
    "projectKey" TEXT NOT NULL,
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
    "projectKey" TEXT NOT NULL,
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
    "createdByUserId" TEXT,
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bundle_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_types" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "businessTypeKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "business_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_type_versions" (
    "id" TEXT NOT NULL,
    "businessTypeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "baseVersionId" TEXT,
    "quotaOverrides" JSONB NOT NULL DEFAULT '{}',
    "monthlyNet" DECIMAL(10,2),
    "yearlyNet" DECIMAL(10,2),
    "marketed" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "publishedChanges" JSONB,
    "changeNote" TEXT NOT NULL DEFAULT '',
    "nonRegressive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_type_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_type_bundles" (
    "businessTypeVersionId" TEXT NOT NULL,
    "bundleVersionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "business_type_bundles_pkey" PRIMARY KEY ("businessTypeVersionId","bundleVersionId")
);

-- CreateTable
CREATE TABLE "capability_catalog_entries" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
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
    "projectKey" TEXT NOT NULL,
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
    "projectKey" TEXT NOT NULL,
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
    "projectKey" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "activeLocales" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
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
    "projectKey" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
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
    "checkoutSessionId" TEXT,
    "checkoutStartedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEventLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sessionId" TEXT,
    "status" TEXT NOT NULL,
    "payload" JSONB,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEventLog_pkey" PRIMARY KEY ("id")
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
    "canceledAt" TIMESTAMP(3),
    "canceledEffectiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_bundles_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "subscriptions_businessTypeVersionId_idx" ON "subscriptions"("businessTypeVersionId");

-- CreateIndex
CREATE INDEX "subscriptions_currentPeriodEnd_idx" ON "subscriptions"("currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payment_methods_subscriptionId_key" ON "subscription_payment_methods"("subscriptionId");

-- CreateIndex
CREATE INDEX "checkout_offers_projectKey_status_idx" ON "checkout_offers"("projectKey", "status");

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
CREATE INDEX "promo_code_validation_logs_codeAttempt_createdAt_idx" ON "promo_code_validation_logs"("codeAttempt", "createdAt");

-- CreateIndex
CREATE INDEX "promo_code_validation_logs_ipHash_createdAt_idx" ON "promo_code_validation_logs"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "promo_code_validation_logs_sessionId_createdAt_idx" ON "promo_code_validation_logs"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "plans_projectKey_deletedAt_idx" ON "plans"("projectKey", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "plans_projectKey_planKey_key" ON "plans"("projectKey", "planKey");

-- CreateIndex
CREATE INDEX "plan_versions_planId_supersededAt_idx" ON "plan_versions"("planId", "supersededAt");

-- CreateIndex
CREATE INDEX "plan_versions_planId_publishedAt_idx" ON "plan_versions"("planId", "publishedAt");

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
CREATE INDEX "bundles_projectKey_deletedAt_idx" ON "bundles"("projectKey", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bundles_projectKey_bundleKey_key" ON "bundles"("projectKey", "bundleKey");

-- CreateIndex
CREATE INDEX "bundle_versions_bundleId_supersededAt_idx" ON "bundle_versions"("bundleId", "supersededAt");

-- CreateIndex
CREATE INDEX "bundle_versions_bundleId_publishedAt_idx" ON "bundle_versions"("bundleId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_versions_bundleId_version_key" ON "bundle_versions"("bundleId", "version");

-- CreateIndex
CREATE INDEX "business_types_projectKey_deletedAt_idx" ON "business_types"("projectKey", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_types_projectKey_businessTypeKey_key" ON "business_types"("projectKey", "businessTypeKey");

-- CreateIndex
CREATE INDEX "business_type_versions_businessTypeId_supersededAt_idx" ON "business_type_versions"("businessTypeId", "supersededAt");

-- CreateIndex
CREATE INDEX "business_type_versions_businessTypeId_publishedAt_idx" ON "business_type_versions"("businessTypeId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_type_versions_businessTypeId_version_key" ON "business_type_versions"("businessTypeId", "version");

-- CreateIndex
CREATE INDEX "business_type_bundles_bundleVersionId_idx" ON "business_type_bundles"("bundleVersionId");

-- CreateIndex
CREATE INDEX "capability_catalog_entries_projectKey_codeStatus_idx" ON "capability_catalog_entries"("projectKey", "codeStatus");

-- CreateIndex
CREATE INDEX "capability_catalog_entries_projectKey_featureKey_idx" ON "capability_catalog_entries"("projectKey", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "capability_catalog_entries_projectKey_capabilityKey_key" ON "capability_catalog_entries"("projectKey", "capabilityKey");

-- CreateIndex
CREATE INDEX "feature_catalog_entries_projectKey_discoveryStatus_idx" ON "feature_catalog_entries"("projectKey", "discoveryStatus");

-- CreateIndex
CREATE INDEX "feature_catalog_entries_projectKey_plannedOnly_idx" ON "feature_catalog_entries"("projectKey", "plannedOnly");

-- CreateIndex
CREATE UNIQUE INDEX "feature_catalog_entries_projectKey_featureKey_key" ON "feature_catalog_entries"("projectKey", "featureKey");

-- CreateIndex
CREATE INDEX "quota_catalog_entries_projectKey_discoveryStatus_idx" ON "quota_catalog_entries"("projectKey", "discoveryStatus");

-- CreateIndex
CREATE UNIQUE INDEX "quota_catalog_entries_projectKey_quotaKey_key" ON "quota_catalog_entries"("projectKey", "quotaKey");

-- CreateIndex
CREATE INDEX "marketing_projections_projectKey_targetType_locale_priority_idx" ON "marketing_projections"("projectKey", "targetType", "locale", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_projections_targetType_targetVersionId_locale_key" ON "marketing_projections"("targetType", "targetVersionId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_settings_projectKey_key" ON "marketing_settings"("projectKey");

-- CreateIndex
CREATE INDEX "promotions_projectKey_targetType_validFrom_validTo_idx" ON "promotions"("projectKey", "targetType", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "subscription_contracts_tenantId_status_effectiveFrom_idx" ON "subscription_contracts"("tenantId", "status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "subscription_contracts_projectKey_status_idx" ON "subscription_contracts"("projectKey", "status");

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
CREATE UNIQUE INDEX "PaymentEventLog_eventId_key" ON "PaymentEventLog"("eventId");

-- CreateIndex
CREATE INDEX "PaymentEventLog_sessionId_idx" ON "PaymentEventLog"("sessionId");

-- CreateIndex
CREATE INDEX "PaymentEventLog_status_processedAt_idx" ON "PaymentEventLog"("status", "processedAt");

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

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pendingPlanVersionId_fkey" FOREIGN KEY ("pendingPlanVersionId") REFERENCES "plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_businessTypeVersionId_fkey" FOREIGN KEY ("businessTypeVersionId") REFERENCES "business_type_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payment_methods" ADD CONSTRAINT "subscription_payment_methods_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_redemptions" ADD CONSTRAINT "promo_code_redemptions_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_code_validation_logs" ADD CONSTRAINT "promo_code_validation_logs_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_versions" ADD CONSTRAINT "bundle_versions_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_versions" ADD CONSTRAINT "bundle_versions_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "bundle_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_type_versions" ADD CONSTRAINT "business_type_versions_businessTypeId_fkey" FOREIGN KEY ("businessTypeId") REFERENCES "business_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_type_versions" ADD CONSTRAINT "business_type_versions_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "business_type_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_type_bundles" ADD CONSTRAINT "business_type_bundles_businessTypeVersionId_fkey" FOREIGN KEY ("businessTypeVersionId") REFERENCES "business_type_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_type_bundles" ADD CONSTRAINT "business_type_bundles_bundleVersionId_fkey" FOREIGN KEY ("bundleVersionId") REFERENCES "bundle_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_line_items" ADD CONSTRAINT "contract_line_items_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "subscription_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_bundles" ADD CONSTRAINT "subscription_bundles_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_bundles" ADD CONSTRAINT "subscription_bundles_bundleVersionId_fkey" FOREIGN KEY ("bundleVersionId") REFERENCES "bundle_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
