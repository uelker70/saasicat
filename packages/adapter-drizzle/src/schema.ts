// Query-side Drizzle table map of the canonical SaaSiCat tables. The DDL
// authority is `@saasicat/spec/sql/reference-schema.postgres.sql` — these
// definitions only DESCRIBE the existing tables for the query builder, they
// are not meant for `drizzle-kit` migrations.
//
// Conventions mirrored from the reference schema:
//   - column names are camelCase, table names snake_case;
//   - `id` and `updatedAt` have NO database defaults (Prisma generates them
//     client-side) — every adapter write sets them explicitly;
//   - Postgres enum columns (BillingCycle, PromoCodeStatus, …) are declared
//     as `text`: parameterized values are coerced by Postgres, and reads
//     come back as strings — exactly what the platform records expect.

import { boolean, integer, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { precision: 3, mode: 'date' });

export const subscriptions = pgTable('subscriptions', {
    id: text('id').primaryKey(),
    tenantId: text('tenantId').notNull(),
    plan: text('plan').notNull(),
    billingCycle: text('billingCycle').notNull().default('YEARLY'),
    status: text('status').notNull().default('TRIAL'),
    trialEntitlementPlan: text('trialEntitlementPlan'),
    pendingPlan: text('pendingPlan'),
    pendingEffectiveAt: ts('pendingEffectiveAt'),
    customLimits: jsonb('customLimits'),
    planVersionId: text('planVersionId').notNull(),
    pendingPlanVersionId: text('pendingPlanVersionId'),
    isPilot: boolean('isPilot').notNull().default(false),
    startedAt: ts('startedAt'),
    // Entitlement resolution ends a subscription by reading these two, so the
    // query map has to describe them: a column this file omits is a column the
    // repository cannot return, and the platform then treats a subscription
    // that ended last January as running.
    canceledAt: ts('canceledAt'),
    canceledEffectiveAt: ts('canceledEffectiveAt'),
    // The billing window, the commitment and the day it is billed on. Omitted
    // until 2026-08-27, and a column this file omits is one the repositories
    // cannot return — which is why the renewal, plan-change and cancellation
    // paths could not be served from this adapter at all.
    trialEndsAt: ts('trialEndsAt'),
    currentPeriodStart: ts('currentPeriodStart'),
    currentPeriodEnd: ts('currentPeriodEnd'),
    minimumTermUntil: ts('minimumTermUntil'),
    billingAnchorDay: integer('billingAnchorDay'),
    // A pending version change and how far it has got: announced, reminded
    // about, accepted, and the date it lands.
    pendingPlanVersionEffectiveAt: ts('pendingPlanVersionEffectiveAt'),
    pendingPlanVersionAccepted: boolean('pendingPlanVersionAccepted').notNull().default(false),
    pendingPlanVersionAcceptedAt: ts('pendingPlanVersionAcceptedAt'),
    pendingPlanVersionAcceptedByUserId: text('pendingPlanVersionAcceptedByUserId'),
    pendingPlanVersionNotifiedAt: ts('pendingPlanVersionNotifiedAt'),
    pendingPlanVersionReminderSentAt: ts('pendingPlanVersionReminderSentAt'),
    postTrialPlan: text('postTrialPlan'),
    pendingBillingCycle: text('pendingBillingCycle'),
    // A negotiated price and the note that explains it, a pilot window, the
    // offer this subscription came from, and the package as it was sold.
    customMonthlyNet: numeric('customMonthlyNet', { precision: 10, scale: 2 }),
    customNote: text('customNote'),
    pilotEndsAt: ts('pilotEndsAt'),
    pilotNote: text('pilotNote'),
    checkoutOfferId: text('checkoutOfferId'),
    packageSnapshot: jsonb('packageSnapshot'),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
});

export const planVersions = pgTable('plan_versions', {
    id: text('id').primaryKey(),
    planId: text('planId').notNull(),
    version: integer('version').notNull(),
    baseVersionId: text('baseVersionId'),
    features: jsonb('features').notNull(),
    quotas: jsonb('quotas').notNull(),
    monthlyNet: numeric('monthlyNet', { precision: 10, scale: 2 }).notNull(),
    yearlyNet: numeric('yearlyNet', { precision: 10, scale: 2 }).notNull(),
    marketed: boolean('marketed').notNull().default(true),
    publishedAt: ts('publishedAt'),
    supersededAt: ts('supersededAt'),
    publishedChanges: jsonb('publishedChanges'),
    changeNote: text('changeNote').notNull(),
    nonRegressive: boolean('nonRegressive').notNull().default(true),
    // The booking window for new subscriptions, and the day the plan itself
    // stops. All three nullable, so a schema that predates them stays valid and
    // an adapter that does not maintain them says so rather than writing them.
    validFrom: ts('validFrom'),
    validUntil: ts('validUntil'),
    endsAt: ts('endsAt'),
    createdByUserId: text('createdByUserId'),
    publishedByUserId: text('publishedByUserId'),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
});

export const plans = pgTable('plans', {
    id: text('id').primaryKey(),
    planKey: text('planKey').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    icon: text('icon'),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
    deletedAt: ts('deletedAt'),
});

// ─── Contracts: what was actually sold, and never rewritten ───
//
// Append-only by design. An existing contract is terminated, never edited, and
// its line items are never touched — that is what makes it a billing source
// rather than a cache of the current plan. Every `…Snapshot` column is a copy
// taken at signing, for the same reason: what was sold has to stay readable
// after the catalogue has moved on.

export const subscriptionContracts = pgTable('subscription_contracts', {
    id: text('id').primaryKey(),
    tenantId: text('tenantId').notNull(),
    // Postgres enum, declared as text: parameterized values are coerced and
    // reads come back as strings, which is what the records expect.
    status: text('status').notNull().default('active'),
    effectiveFrom: ts('effectiveFrom').notNull(),
    effectiveUntil: ts('effectiveUntil'),
    originalOfferId: text('originalOfferId'),
    originalPlanVersionId: text('originalPlanVersionId'),
    originalBundleVersionIds: jsonb('originalBundleVersionIds').notNull(),
    entitlementSnapshot: jsonb('entitlementSnapshot'),
    priceSnapshot: jsonb('priceSnapshot').notNull(),
    promotionSnapshots: jsonb('promotionSnapshots').notNull(),
    promoCodeSnapshots: jsonb('promoCodeSnapshots').notNull(),
    termsSnapshot: jsonb('termsSnapshot'),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
});

export const contractLineItems = pgTable('contract_line_items', {
    id: text('id').primaryKey(),
    contractId: text('contractId').notNull(),
    kind: text('kind').notNull(),
    sourceKey: text('sourceKey').notNull(),
    sourceVersionId: text('sourceVersionId'),
    titleSnapshot: text('titleSnapshot').notNull(),
    descriptionSnapshot: text('descriptionSnapshot'),
    quantity: integer('quantity').notNull().default(1),
    unit: text('unit'),
    priceNet: numeric('priceNet', { precision: 10, scale: 2 }).notNull(),
    priceGross: numeric('priceGross', { precision: 10, scale: 2 }).notNull(),
    billingCycle: text('billingCycle').notNull(),
    currency: text('currency').notNull(),
    taxRate: numeric('taxRate', { precision: 5, scale: 2 }).notNull(),
    taxAmount: numeric('taxAmount', { precision: 10, scale: 2 }).notNull(),
    minimumTermUntil: ts('minimumTermUntil'),
    featuresSnapshot: jsonb('featuresSnapshot').notNull(),
    quotaEffectsSnapshot: jsonb('quotaEffectsSnapshot').notNull(),
    metadata: jsonb('metadata'),
    createdAt: ts('createdAt').notNull().defaultNow(),
});

export const featureCatalogEntries = pgTable('feature_catalog_entries', {
    id: text('id').primaryKey(),
    featureKey: text('featureKey').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    marketingLabel: text('marketingLabel'),
    marketingDescription: text('marketingDescription'),
    icon: text('icon'),
    tier: text('tier'),
    core: boolean('core').notNull().default(false),
    requires: text('requires').array(),
    replaces: text('replaces').array(),
    successorKey: text('successorKey'),
    discoveryStatus: text('discoveryStatus').notNull().default('pending'),
    approvedAt: ts('approvedAt'),
    approvedBy: text('approvedBy'),
    approvedSignature: text('approvedSignature'),
    plannedOnly: boolean('plannedOnly').notNull().default(false),
    i18n: jsonb('i18n').notNull().default({}),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
    deletedAt: ts('deletedAt'),
});

export const promoCodes = pgTable('promo_codes', {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    valueType: text('valueType').notNull(),
    value: numeric('value', { precision: 8, scale: 2 }).notNull(),
    durationType: text('durationType').notNull().default('ONCE'),
    durationValue: integer('durationValue'),
    validFrom: ts('validFrom'),
    validUntil: ts('validUntil'),
    maxRedemptions: integer('maxRedemptions'),
    redemptionsCount: integer('redemptionsCount').notNull().default(0),
    appliesToPlans: text('appliesToPlans').array(),
    appliesToBilling: text('appliesToBilling'),
    firstTimeCustomersOnly: boolean('firstTimeCustomersOnly').notNull().default(true),
    minimumPlanAmountGross: numeric('minimumPlanAmountGross', { precision: 10, scale: 2 }),
    allowZeroInvoice: boolean('allowZeroInvoice').notNull().default(false),
    status: text('status').notNull().default('ACTIVE'),
    description: text('description'),
    campaignTag: text('campaignTag'),
    revenueDeductionAccount: text('revenueDeductionAccount'),
    createdById: text('createdById').notNull(),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
    deletedAt: ts('deletedAt'),
});

export const promoCodeRedemptions = pgTable('promo_code_redemptions', {
    id: text('id').primaryKey(),
    promoCodeId: text('promoCodeId').notNull(),
    subscriptionId: text('subscriptionId').notNull(),
    tenantId: text('tenantId').notNull(),
    appliedValueType: text('appliedValueType').notNull(),
    appliedValue: numeric('appliedValue', { precision: 8, scale: 2 }).notNull(),
    appliedDurationType: text('appliedDurationType').notNull(),
    appliedDurationValue: integer('appliedDurationValue'),
    startsAt: ts('startsAt').notNull(),
    endsAt: ts('endsAt'),
    status: text('status').notNull().default('ACTIVE'),
    redeemedAt: ts('redeemedAt').notNull().defaultNow(),
    reversedAt: ts('reversedAt'),
});

export const promoCodeValidationLogs = pgTable('promo_code_validation_logs', {
    id: text('id').primaryKey(),
    promoCodeId: text('promoCodeId'),
    codeAttempt: text('codeAttempt').notNull(),
    ipHash: text('ipHash'),
    sessionId: text('sessionId'),
    result: text('result').notNull(),
    createdAt: ts('createdAt').notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
    id: text('id').primaryKey(),
    tenantId: text('tenantId'),
    userId: text('userId'),
    entity: text('entity').notNull(),
    entityId: text('entityId').notNull(),
    action: text('action').notNull(),
    changes: jsonb('changes'),
    actorTag: text('actorTag'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    createdAt: ts('createdAt').notNull().defaultNow(),
});

export const superAdminUsers = pgTable('super_admin_users', {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('passwordHash').notNull(),
    firstName: text('firstName'),
    lastName: text('lastName'),
    platformRole: text('platformRole').notNull().default('SUPER_ADMIN'),
    isActive: boolean('isActive').notNull().default(true),
    lastLoginAt: ts('lastLoginAt'),
    deletedAt: ts('deletedAt'),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
});

export const superAdminMfa = pgTable('super_admin_mfa', {
    userId: text('userId').primaryKey(),
    secret: text('secret'),
    enabledAt: ts('enabledAt'),
    updatedAt: ts('updatedAt').notNull(),
});

// ─── Bundles: the add-on catalogue and what a tenant booked from it ───
//
// A bundle is a versioned grouping of features and quota effects, sold on top
// of a plan. `subscription_bundles` is the junction: one row per booking,
// pinned to one concrete `BundleVersion` so what was bought stays what was
// bought when the catalogue moves on.

export const bundles = pgTable('bundles', {
    id: text('id').primaryKey(),
    bundleKey: text('bundleKey').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    icon: text('icon'),
    sortOrder: integer('sortOrder').notNull().default(0),
    i18n: jsonb('i18n').notNull(),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
    deletedAt: ts('deletedAt'),
});

export const bundleVersions = pgTable('bundle_versions', {
    id: text('id').primaryKey(),
    bundleId: text('bundleId').notNull(),
    version: integer('version').notNull(),
    baseVersionId: text('baseVersionId'),
    features: jsonb('features').notNull(),
    quotas: jsonb('quotas').notNull(),
    compatibility: jsonb('compatibility').notNull(),
    pricingOverrides: jsonb('pricingOverrides').notNull(),
    // Nullable, unlike a plan version's: a bundle may carry no base price and
    // resolve one per plan through `pricingOverrides` instead.
    monthlyNet: numeric('monthlyNet', { precision: 10, scale: 2 }),
    yearlyNet: numeric('yearlyNet', { precision: 10, scale: 2 }),
    marketed: boolean('marketed').notNull().default(true),
    publishedAt: ts('publishedAt'),
    supersededAt: ts('supersededAt'),
    publishedChanges: jsonb('publishedChanges'),
    changeNote: text('changeNote').notNull(),
    nonRegressive: boolean('nonRegressive').notNull().default(true),
    validFrom: ts('validFrom'),
    validUntil: ts('validUntil'),
    createdByUserId: text('createdByUserId'),
    publishedByUserId: text('publishedByUserId'),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
});

export const subscriptionBundles = pgTable('subscription_bundles', {
    id: text('id').primaryKey(),
    subscriptionId: text('subscriptionId').notNull(),
    bundleVersionId: text('bundleVersionId').notNull(),
    startedAt: ts('startedAt').notNull(),
    minimumTermEndsAt: ts('minimumTermEndsAt'),
    // The rhythm this booking is billed in and the window it is billed for. A
    // bundle's periods end on the day the plan's do; all three are null on a
    // booking made before these columns existed, and on one whose plan had no
    // period to align to — a trial, or a subscription awaiting sales.
    billingCycle: text('billingCycle'),
    currentPeriodStart: ts('currentPeriodStart'),
    currentPeriodEnd: ts('currentPeriodEnd'),
    canceledAt: ts('canceledAt'),
    canceledEffectiveAt: ts('canceledEffectiveAt'),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
});
