// Query-side Drizzle table map of the canonical SaaSicat tables. The DDL
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
    createdByUserId: text('createdByUserId'),
    publishedByUserId: text('publishedByUserId'),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
});

export const plans = pgTable('plans', {
    id: text('id').primaryKey(),
    projectKey: text('projectKey').notNull(),
    planKey: text('planKey').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    icon: text('icon'),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: ts('createdAt').notNull().defaultNow(),
    updatedAt: ts('updatedAt').notNull(),
    deletedAt: ts('deletedAt'),
});

export const featureCatalogEntries = pgTable('feature_catalog_entries', {
    id: text('id').primaryKey(),
    projectKey: text('projectKey').notNull(),
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
