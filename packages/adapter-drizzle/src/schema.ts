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

import {
    bigint,
    boolean,
    customType,
    date,
    integer,
    jsonb,
    numeric,
    pgTable,
    serial,
    text,
    timestamp,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { precision: 3, mode: 'date' });

/**
 * The moment a row is written, on the application's clock.
 *
 * The canonical columns are `timestamp` without a time zone. Left to the
 * database, `now()` is stored as the session's wall time, and Drizzle reads it
 * back as UTC — so a database session outside UTC puts the column hours off,
 * and a comparison with a time the application wrote goes the wrong way.
 */
const writtenAt = (name: string) =>
    ts(name)
        .notNull()
        .$defaultFn(() => new Date());

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
    postTrialPlan: text('postTrialPlan'),
    pendingBillingCycle: text('pendingBillingCycle'),
    pendingChangeVersionId: text('pendingChangeVersionId'),
    pendingTermsVersion: text('pendingTermsVersion'),
    pendingCancellationNoticeDays: integer('pendingCancellationNoticeDays'),
    pendingAgreedAt: ts('pendingAgreedAt'),
    // A negotiated price and the note that explains it, a pilot window, the
    // offer this subscription came from, and the package as it was sold.
    customMonthlyNet: numeric('customMonthlyNet', { precision: 10, scale: 2 }),
    customNote: text('customNote'),
    pilotEndsAt: ts('pilotEndsAt'),
    pilotNote: text('pilotNote'),
    checkoutOfferId: text('checkoutOfferId'),
    packageSnapshot: jsonb('packageSnapshot'),
    createdAt: writtenAt('createdAt'),
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
    createdAt: writtenAt('createdAt'),
    updatedAt: ts('updatedAt').notNull(),
});

export const plans = pgTable('plans', {
    id: text('id').primaryKey(),
    planKey: text('planKey').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    icon: text('icon'),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: writtenAt('createdAt'),
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
    // Who the contract is between, copied when it was concluded.
    subscriberId: text('subscriberId').notNull(),
    subscriberSnapshot: jsonb('subscriberSnapshot').notNull(),
    issuerSnapshot: jsonb('issuerSnapshot'),
    partiesMigrated: boolean('partiesMigrated').notNull().default(false),
    // The tax adapter's answer when the contract was concluded, with its name
    // and version; null where no adapter was asked.
    taxTreatment: jsonb('taxTreatment'),
    // The days of notice of the contract's rhythm when it was written.
    cancellationNoticeDays: integer('cancellationNoticeDays').notNull(),
    // The version of the terms named when the contract was written; null where none was.
    termsVersion: text('termsVersion'),
    agreedAt: ts('agreedAt').notNull(),
    confirmationDue: boolean('confirmationDue').notNull().default(false),
    createdAt: writtenAt('createdAt'),
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
    createdAt: writtenAt('createdAt'),
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
    createdAt: writtenAt('createdAt'),
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
    heldCount: integer('heldCount').notNull().default(0),
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
    createdAt: writtenAt('createdAt'),
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
    redeemedAt: writtenAt('redeemedAt'),
    reversedAt: ts('reversedAt'),
});

export const promoCodeHolds = pgTable('promo_code_holds', {
    id: text('id').primaryKey(),
    promoCodeId: text('promoCodeId').notNull(),
    checkoutOfferId: text('checkoutOfferId').notNull(),
    expiresAt: ts('expiresAt').notNull(),
    handedOverTx: bigint('handedOverTx', { mode: 'bigint' }),
    createdAt: writtenAt('createdAt'),
});

export const promoCodeValidationLogs = pgTable('promo_code_validation_logs', {
    id: text('id').primaryKey(),
    promoCodeId: text('promoCodeId'),
    codeAttempt: text('codeAttempt').notNull(),
    ipHash: text('ipHash'),
    sessionId: text('sessionId'),
    result: text('result').notNull(),
    createdAt: writtenAt('createdAt'),
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
    createdAt: writtenAt('createdAt'),
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
    createdAt: writtenAt('createdAt'),
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
    createdAt: writtenAt('createdAt'),
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
    createdAt: writtenAt('createdAt'),
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
    // A switch to a newer version taken for the end of the booking's term: the
    // version it continues on, and from when. Both null where none is
    // scheduled.
    pendingBundleVersionId: text('pendingBundleVersionId'),
    pendingVersionEffectiveAt: ts('pendingVersionEffectiveAt'),
    pendingTermsVersion: text('pendingTermsVersion'),
    pendingCancellationNoticeDays: integer('pendingCancellationNoticeDays'),
    pendingAgreedAt: ts('pendingAgreedAt'),
    agreedTermsVersion: text('agreedTermsVersion'),
    agreedCancellationNoticeDays: integer('agreedCancellationNoticeDays'),
    agreedAt: ts('agreedAt'),
    canceledAt: ts('canceledAt'),
    canceledEffectiveAt: ts('canceledEffectiveAt'),
    createdAt: writtenAt('createdAt'),
    updatedAt: ts('updatedAt').notNull(),
});

// The record of the applied configuration — one row per installation, held to
// one by the `CHECK` in constraints.postgres.sql — and the changes noticed
// between two starts. `applied_settings.id` has a database default; the
// repository writes it anyway, because the CHECK is what decides and a caller
// that omits the id is not the caller it exists for.
export const appliedSettings = pgTable('applied_settings', {
    id: text('id').primaryKey().default('installation'),
    fingerprint: text('fingerprint').notNull(),
    settings: jsonb('settings').notNull(),
    source: text('source').notNull(),
    appliedAt: ts('appliedAt').notNull(),
});

export const settingsChanges = pgTable('settings_changes', {
    id: text('id').primaryKey(),
    // Numbered by the database at the write that recorded the change, and the
    // order the list is read in. Never set by the adapter.
    seq: serial('seq').notNull(),
    noticedAt: ts('noticedAt').notNull(),
    source: text('source').notNull(),
    previous: jsonb('previous').notNull(),
    current: jsonb('current').notNull(),
    acknowledgedAt: ts('acknowledgedAt'),
    acknowledgedBy: text('acknowledgedBy'),
});

// Maintenance windows — one row per window, at most one of them open. The
// partial unique index that holds the one is in constraints.postgres.sql.
export const maintenanceWindows = pgTable('maintenance_windows', {
    id: text('id').primaryKey(),
    startsAt: ts('startsAt'),
    endsAt: ts('endsAt'),
    message: text('message'),
    createdAt: writtenAt('createdAt'),
    createdBy: text('createdBy').notNull(),
    lockedAt: ts('lockedAt'),
    lockedBy: text('lockedBy'),
    endedAt: ts('endedAt'),
    endedBy: text('endedBy'),
});

// What each subscriber was told, once per subscription, kind and subject. The
// DDL authority, the unique key a second record of one notice collides with, is
// `subscription_notices_subscriptionId_kind_subject_key`.
export const subscriptionNotices = pgTable('subscription_notices', {
    id: text('id').primaryKey(),
    tenantId: text('tenantId').notNull(),
    subscriptionId: text('subscriptionId').notNull(),
    kind: text('kind').notNull(),
    subject: text('subject').notNull(),
    content: jsonb('content').notNull(),
    createdAt: writtenAt('createdAt'),
    claimedAt: ts('claimedAt'),
    deliveredAt: ts('deliveredAt'),
    recipients: jsonb('recipients'),
    channel: text('channel'),
});

// ---------------------------------------------------------------------------
// Retirement announcements — a plan version ended for the subscriptions on it
// ---------------------------------------------------------------------------
//
// The versions are values, not keys: the record outlives the catalogue entries
// it names. What it means for each subscription is a `subscription_notices` row
// of kind `version-retired`: its subject is the retired version, its content
// names this row's id as `retirementId`.

export const versionRetirements = pgTable('version_retirements', {
    id: text('id').primaryKey(),
    retiredPlanVersionId: text('retiredPlanVersionId').notNull(),
    retiredPlanKey: text('retiredPlanKey').notNull(),
    retiredVersion: integer('retiredVersion').notNull(),
    replacementPlanVersionId: text('replacementPlanVersionId').notNull(),
    replacementPlanKey: text('replacementPlanKey').notNull(),
    replacementVersion: integer('replacementVersion').notNull(),
    announcedAt: writtenAt('announcedAt'),
    announcedBy: text('announcedBy').notNull(),
});

// ---------------------------------------------------------------------------
// Add-on retirement announcements — an add-on version ended for the bookings on it
// ---------------------------------------------------------------------------
//
// As above, for an add-on version: what it means for each booking is a
// `subscription_notices` row of kind `bundle-version-retired`, whose subject is
// the retired add-on version.

export const bundleVersionRetirements = pgTable('bundle_version_retirements', {
    id: text('id').primaryKey(),
    retiredBundleVersionId: text('retiredBundleVersionId').notNull(),
    retiredBundleKey: text('retiredBundleKey').notNull(),
    retiredVersion: integer('retiredVersion').notNull(),
    replacementBundleVersionId: text('replacementBundleVersionId').notNull(),
    replacementBundleKey: text('replacementBundleKey').notNull(),
    replacementVersion: integer('replacementVersion').notNull(),
    announcedAt: writtenAt('announcedAt'),
    announcedBy: text('announcedBy').notNull(),
});

// ---------------------------------------------------------------------------
// Feature withdrawals — a feature granted to nobody for a reason outside the platform
// ---------------------------------------------------------------------------
//
// What it means for each subscription is a `subscription_notices` row of kind
// `feature-withdrawn`, whose subject is this row's id. A feature has at most
// one withdrawal not lifted; the partial unique index that holds it is in
// `constraints.postgres.sql`.

export const featureWithdrawals = pgTable('feature_withdrawals', {
    id: text('id').primaryKey(),
    featureKey: text('featureKey').notNull(),
    reason: text('reason').notNull(),
    effectiveFrom: ts('effectiveFrom').notNull(),
    liftedFrom: ts('liftedFrom'),
    reductions: jsonb('reductions').notNull().default([]),
    announcedAt: writtenAt('announcedAt'),
    announcedBy: text('announcedBy').notNull(),
    liftedAt: ts('liftedAt'),
    liftedBy: text('liftedBy'),
    toldAt: ts('toldAt'),
});

// ---------------------------------------------------------------------------
// Subscribers — the party a contract is concluded with
// ---------------------------------------------------------------------------
//
// A subscriber has at most one live tenant and a tenant at most one live
// subscriber; the partial unique indexes that hold both are in
// `constraints.postgres.sql`, and a link that ended keeps its row.

export const subscribers = pgTable('subscribers', {
    id: text('id').primaryKey(),
    // Counted by the database, from where `constraints.postgres.sql` starts it.
    // Never set by the adapter.
    customerSequence: serial('customerSequence').notNull(),
    customerNumberPrefix: text('customerNumberPrefix').notNull().default(''),
    legalName: text('legalName').notNull(),
    vatId: text('vatId'),
    taxNumber: text('taxNumber'),
    addressLine1: text('addressLine1'),
    addressLine2: text('addressLine2'),
    postalCode: text('postalCode'),
    city: text('city'),
    country: text('country'),
    invoiceEmail: text('invoiceEmail'),
    // The tax origin beside the country and the VAT id: whether the subscriber
    // is a business; which recorded check of the VAT id counts now, as a
    // reference without a key; and since when the VAT id is held.
    business: boolean('business'),
    currentVatIdCheckId: text('currentVatIdCheckId'),
    vatIdSince: ts('vatIdSince'),
    migrated: boolean('migrated').notNull().default(false),
    createdAt: writtenAt('createdAt'),
    updatedAt: ts('updatedAt').notNull(),
});

export const subscriberTenants = pgTable('subscriber_tenants', {
    id: text('id').primaryKey(),
    subscriberId: text('subscriberId').notNull(),
    tenantId: text('tenantId').notNull(),
    linkedAt: writtenAt('linkedAt'),
    unlinkedAt: ts('unlinkedAt'),
});

// Numbered by the database in the order they were written, and read in it.
export const subscriberCorrections = pgTable('subscriber_corrections', {
    id: text('id').primaryKey(),
    seq: serial('seq').notNull(),
    subscriberId: text('subscriberId').notNull(),
    previous: jsonb('previous').notNull(),
    corrected: jsonb('corrected').notNull(),
    reason: text('reason').notNull(),
    correctedBy: text('correctedBy').notNull(),
    correctedAt: ts('correctedAt').notNull(),
});

// Numbered by the database in the order they were written, and read in it.
export const subscriberTaxOriginChanges = pgTable('subscriber_tax_origin_changes', {
    id: text('id').primaryKey(),
    seq: serial('seq').notNull(),
    subscriberId: text('subscriberId').notNull(),
    previous: jsonb('previous').notNull(),
    changed: jsonb('changed').notNull(),
    changedBy: text('changedBy').notNull(),
    changedAt: ts('changedAt').notNull(),
    reason: text('reason'),
});

// Every completed check of a subscriber's VAT id, never rewritten.
export const subscriberVatIdChecks = pgTable('subscriber_vat_id_checks', {
    id: text('id').primaryKey(),
    subscriberId: text('subscriberId').notNull(),
    vatId: text('vatId').notNull(),
    checkedAt: ts('checkedAt').notNull(),
    valid: boolean('valid').notNull(),
    service: text('service').notNull(),
    confirmation: jsonb('confirmation').notNull(),
    recordedAt: writtenAt('recordedAt'),
});

// A returning customer's new subscriber joined into the one it had, never rewritten.
export const subscriberJoins = pgTable('subscriber_joins', {
    id: text('id').primaryKey(),
    fromSubscriberId: text('fromSubscriberId').notNull(),
    intoSubscriberId: text('intoSubscriberId').notNull(),
    reason: text('reason').notNull(),
    joinedBy: text('joinedBy').notNull(),
    joinedAt: ts('joinedAt').notNull(),
    digest: text('digest').notNull(),
    moved: jsonb('moved').notNull(),
});

// ---------------------------------------------------------------------------
// Payments — gateway events and the payment methods they confirm
// ---------------------------------------------------------------------------
//
// An event is unique per gateway account, and a subscriber has at most one
// `ACTIVE` payment method; the unique indexes that hold both are in the
// reference schema and `constraints.postgres.sql`.

export const subscriberPaymentMethodSetups = pgTable('subscriber_payment_method_setups', {
    id: text('id').primaryKey(),
    subscriberId: text('subscriberId').notNull(),
    gatewayAccount: text('gatewayAccount').notNull(),
    sessionRef: text('sessionRef').notNull(),
    customerRef: text('customerRef').notNull(),
    startedAt: writtenAt('startedAt'),
    completedAt: ts('completedAt'),
});

export const paymentEventLog = pgTable('PaymentEventLog', {
    id: text('id').primaryKey(),
    gatewayAccount: text('gatewayAccount').notNull(),
    eventId: text('eventId').notNull(),
    provider: text('provider').notNull(),
    sessionId: text('sessionId'),
    status: text('status').notNull(),
    payload: jsonb('payload'),
    processedAt: writtenAt('processedAt'),
});

// The subscriber's account: one charge per contract line and period, written
// once. The DDL authority, the unique key a second derivation collides with,
// is `subscriber_ledger_entries_subscriptionId_source_sourceRef_p_key`.
export const subscriberLedgerEntries = pgTable('subscriber_ledger_entries', {
    id: text('id').primaryKey(),
    subscriberId: text('subscriberId').notNull(),
    tenantId: text('tenantId').notNull(),
    subscriptionId: text('subscriptionId').notNull(),
    contractId: text('contractId').notNull(),
    contractLineItemId: text('contractLineItemId').notNull(),
    origin: text('origin').notNull(),
    source: text('source').notNull(),
    sourceRef: text('sourceRef').notNull(),
    periodStart: ts('periodStart').notNull(),
    periodEnd: ts('periodEnd').notNull(),
    currency: text('currency').notNull(),
    amountNet: numeric('amountNet', { precision: 10, scale: 2 }).notNull(),
    bookedAt: ts('bookedAt').notNull(),
    // A correction's three parts, all set on a correction and none on any
    // other charge (`toSubscriberChargeRecord`).
    correctsChargeId: text('correctsChargeId'),
    correctedInvoiceId: text('correctedInvoiceId'),
    correctionReason: text('correctionReason'),
    createdAt: writtenAt('createdAt'),
});

/** A calendar day, read and written as its `YYYY-MM-DD` text. */
const day = (name: string) => date(name, { mode: 'string' });

// The invoices issued from the charge journal. The DDL authority, the unique
// keys a second issue of the same charges and a second draw of one number
// collide with, are `subscription_invoice_lines_chargeId_chainStep_key` and
// `subscription_invoices_numberYear_numberSequence_key`.
export const subscriptionInvoices = pgTable('subscription_invoices', {
    id: text('id').primaryKey(),
    number: text('number').notNull(),
    numberPrefix: text('numberPrefix').notNull(),
    numberYear: integer('numberYear').notNull(),
    numberSequence: integer('numberSequence').notNull(),
    tenantId: text('tenantId').notNull(),
    subscriberId: text('subscriberId').notNull(),
    subscriptionId: text('subscriptionId').notNull(),
    contractId: text('contractId').notNull(),
    chainId: text('chainId').notNull(),
    chainStep: integer('chainStep').notNull().default(0),
    issuedAt: ts('issuedAt').notNull(),
    issueDate: day('issueDate').notNull(),
    dueDate: day('dueDate').notNull(),
    servicePeriodFrom: day('servicePeriodFrom').notNull(),
    servicePeriodUntil: day('servicePeriodUntil').notNull(),
    payment: jsonb('payment'),
    collectionDate: day('collectionDate'),
    currency: text('currency').notNull(),
    issuerParty: jsonb('issuerParty').notNull(),
    subscriberParty: jsonb('subscriberParty').notNull(),
    footer: jsonb('footer').notNull().default([]),
    taxTreatment: jsonb('taxTreatment').notNull(),
    taxes: jsonb('taxes').notNull(),
    totalNet: numeric('totalNet', { precision: 12, scale: 2 }).notNull(),
    totalTax: numeric('totalTax', { precision: 12, scale: 2 }).notNull(),
    totalGross: numeric('totalGross', { precision: 12, scale: 2 }).notNull(),
    paidOnIssue: numeric('paidOnIssue', { precision: 12, scale: 2 }).notNull().default('0'),
    createdAt: writtenAt('createdAt'),
});

export const subscriptionInvoiceLines = pgTable('subscription_invoice_lines', {
    id: text('id').primaryKey(),
    invoiceId: text('invoiceId').notNull(),
    position: integer('position').notNull(),
    chargeId: text('chargeId').notNull(),
    contractLineItemId: text('contractLineItemId').notNull(),
    chainStep: integer('chainStep').notNull().default(0),
    correctedPosition: integer('correctedPosition'),
    correctsPosition: integer('correctsPosition'),
    title: text('title').notNull(),
    origin: text('origin').notNull(),
    source: text('source').notNull(),
    periodFrom: day('periodFrom').notNull(),
    periodUntil: day('periodUntil').notNull(),
    amountNet: numeric('amountNet', { precision: 10, scale: 2 }).notNull(),
    taxRate: numeric('taxRate', { precision: 5, scale: 2 }).notNull(),
});

/**
 * A cancellation: the invoice it cancels, the cancellation invoice, the
 * replacement. The DDL authority, the unique key a second cancellation of the
 * same invoice collides with, is
 * `subscription_invoice_cancellations_cancelledInvoiceId_key`.
 */
export const subscriptionInvoiceCancellations = pgTable('subscription_invoice_cancellations', {
    id: text('id').primaryKey(),
    cancelledInvoiceId: text('cancelledInvoiceId').notNull(),
    cancellationInvoiceId: text('cancellationInvoiceId').notNull(),
    replacementInvoiceId: text('replacementInvoiceId'),
    reason: text('reason').notNull(),
    correctedSubscriber: jsonb('correctedSubscriber'),
    deliverTo: text('deliverTo'),
    cancelledBy: text('cancelledBy').notNull(),
    cancelledAt: ts('cancelledAt').notNull(),
});

/** One row per year: the last invoice number drawn in it. */
export const subscriptionInvoiceNumbers = pgTable('subscription_invoice_numbers', {
    year: integer('year').primaryKey(),
    last: integer('last').notNull(),
});

export const subscriptionInvoiceDocuments = pgTable('subscription_invoice_documents', {
    invoiceId: text('invoiceId').primaryKey(),
    checksum: text('checksum').notNull(),
    mediaType: text('mediaType').notNull(),
    fileName: text('fileName').notNull(),
    size: integer('size').notNull(),
    renderedAt: ts('renderedAt').notNull(),
    archivedAt: ts('archivedAt'),
    deliveryClaimedAt: ts('deliveryClaimedAt'),
    deliveredAt: ts('deliveredAt'),
    deliveredTo: text('deliveredTo'),
});

/** An attempt to collect an invoice, with the request it made and what became of it. */
export const subscriptionInvoiceCollections = pgTable('subscription_invoice_collections', {
    id: text('id').primaryKey(),
    invoiceId: text('invoiceId').notNull(),
    attempt: integer('attempt').notNull(),
    attemptKey: text('attemptKey').notNull(),
    gatewayAccount: text('gatewayAccount').notNull(),
    paymentMethodId: text('paymentMethodId').notNull(),
    paymentMethodType: text('paymentMethodType').notNull(),
    customerRef: text('customerRef').notNull(),
    paymentMethodRef: text('paymentMethodRef').notNull(),
    invoiceNumber: text('invoiceNumber').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    paymentRef: text('paymentRef'),
    failureReason: text('failureReason'),
    failureCode: text('failureCode'),
    submittedAt: ts('submittedAt'),
    heldAt: ts('heldAt'),
    resolvedAt: ts('resolvedAt'),
    collectOn: day('collectOn'),
    announcedAt: ts('announcedAt'),
    followedUpAt: ts('followedUpAt'),
});

/** A payment the gateway confirmed for an invoice's collection attempt. */
export const subscriberPayments = pgTable('subscriber_payments', {
    id: text('id').primaryKey(),
    subscriberId: text('subscriberId').notNull(),
    tenantId: text('tenantId').notNull(),
    invoiceId: text('invoiceId').notNull(),
    collectionId: text('collectionId').notNull(),
    gatewayAccount: text('gatewayAccount').notNull(),
    provider: text('provider').notNull(),
    gatewayRef: text('gatewayRef').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    recordedAt: ts('recordedAt').notNull().defaultNow(),
});

/**
 * What a payment settles of an invoice, what a reversal opens of it again,
 * what a reinstatement settles again, and what a cancellation moves of it onto
 * the replacement.
 */
export const subscriptionInvoiceSettlements = pgTable('subscription_invoice_settlements', {
    id: text('id').primaryKey(),
    invoiceId: text('invoiceId').notNull(),
    paymentId: text('paymentId').notNull(),
    kind: text('kind').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    reversalId: text('reversalId'),
    cancellationId: text('cancellationId'),
    recordedAt: ts('recordedAt').notNull().defaultNow(),
});

/**
 * Money the operator owes a subscriber: a payment's surplus, an invoice whose
 * total is negative, what a reversal given back brought beyond what was owed,
 * or a payment's share of a cancelled invoice its replacement did not take.
 */
export const subscriberCredits = pgTable('subscriber_credits', {
    id: text('id').primaryKey(),
    subscriberId: text('subscriberId').notNull(),
    tenantId: text('tenantId').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    originPaymentId: text('originPaymentId'),
    originInvoiceId: text('originInvoiceId'),
    originReversalId: text('originReversalId'),
    originCancellationId: text('originCancellationId'),
    createdAt: ts('createdAt').notNull().defaultNow(),
});

/** What paid a credit out, or gave it back: a refund, its failure, a payout, a reversal, its give-back. */
export const subscriberCreditEntries = pgTable('subscriber_credit_entries', {
    id: text('id').primaryKey(),
    creditId: text('creditId').notNull(),
    kind: text('kind').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    refundId: text('refundId'),
    reversalId: text('reversalId'),
    reference: text('reference'),
    paidOn: day('paidOn'),
    recordedBy: text('recordedBy'),
    note: text('note'),
    recordedAt: ts('recordedAt').notNull().defaultNow(),
});

/** A refund the operator made in the gateway, against the payment it pays back. */
export const subscriberRefunds = pgTable('subscriber_refunds', {
    id: text('id').primaryKey(),
    subscriberId: text('subscriberId').notNull(),
    paymentId: text('paymentId').notNull(),
    gatewayAccount: text('gatewayAccount').notNull(),
    gatewayRef: text('gatewayRef').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull(),
    recordedAt: ts('recordedAt').notNull().defaultNow(),
    endedAt: ts('endedAt'),
});

/** What the gateway took back from the operator for a payment, and gave back of it. */
export const subscriberReversals = pgTable('subscriber_reversals', {
    id: text('id').primaryKey(),
    subscriberId: text('subscriberId').notNull(),
    tenantId: text('tenantId').notNull(),
    paymentId: text('paymentId').notNull(),
    gatewayAccount: text('gatewayAccount').notNull(),
    gatewayRef: text('gatewayRef').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    fromCredit: numeric('fromCredit', { precision: 12, scale: 2 }).notNull(),
    reinstated: numeric('reinstated', { precision: 12, scale: 2 }).notNull(),
    reinstatedToCases: numeric('reinstatedToCases', { precision: 12, scale: 2 })
        .notNull()
        .default('0'),
    recordedAt: ts('recordedAt').notNull().defaultNow(),
    reinstatedAt: ts('reinstatedAt'),
});

/** What the gateway reported and nothing matched, for the operator to reconcile. */
export const subscriberReconciliationCases = pgTable('subscriber_reconciliation_cases', {
    id: text('id').primaryKey(),
    subscriberId: text('subscriberId').notNull(),
    tenantId: text('tenantId').notNull(),
    kind: text('kind').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    paymentId: text('paymentId').notNull(),
    refundId: text('refundId'),
    reversalId: text('reversalId'),
    gatewayAccount: text('gatewayAccount').notNull(),
    gatewayRef: text('gatewayRef').notNull(),
    recordedAt: ts('recordedAt').notNull().defaultNow(),
    closedAt: ts('closedAt'),
    closedBy: text('closedBy'),
    note: text('note'),
});

/** A `bytea` column, read and written as bytes. */
const bytes = customType<{ data: Uint8Array; driverData: Buffer }>({
    dataType: () => 'bytea',
    toDriver: (value) => Buffer.from(value),
    fromDriver: (value) => new Uint8Array(value),
});

export const subscriptionInvoiceArchive = pgTable('subscription_invoice_archive', {
    invoiceId: text('invoiceId').primaryKey(),
    checksum: text('checksum').notNull(),
    mediaType: text('mediaType').notNull(),
    fileName: text('fileName').notNull(),
    content: bytes('content').notNull(),
    archivedAt: ts('archivedAt').notNull(),
});

/** The versions of the operator's terms, one PDF each, written once (fragment 25). */
export const termsVersions = pgTable('terms_versions', {
    version: text('version').primaryKey(),
    checksum: text('checksum').notNull(),
    mediaType: text('mediaType').notNull(),
    fileName: text('fileName').notNull(),
    content: bytes('content').notNull(),
    archivedAt: ts('archivedAt').notNull(),
});

/** Where a contract's confirmation stands, recorded once before its file is archived. */
export const contractConfirmations = pgTable('contract_confirmations', {
    contractId: text('contractId').primaryKey(),
    checksum: text('checksum').notNull(),
    mediaType: text('mediaType').notNull(),
    fileName: text('fileName').notNull(),
    size: integer('size').notNull(),
    renderedAt: ts('renderedAt').notNull(),
    archivedAt: ts('archivedAt'),
    deliveryClaimedAt: ts('deliveryClaimedAt'),
    deliveredAt: ts('deliveredAt'),
    deliveredTo: text('deliveredTo'),
});

/** The file of a contract's confirmation, written once. */
export const contractConfirmationArchive = pgTable('contract_confirmation_archive', {
    contractId: text('contractId').primaryKey(),
    checksum: text('checksum').notNull(),
    mediaType: text('mediaType').notNull(),
    fileName: text('fileName').notNull(),
    content: bytes('content').notNull(),
    archivedAt: ts('archivedAt').notNull(),
});

export const subscriberPaymentMethods = pgTable('subscriber_payment_methods', {
    id: text('id').primaryKey(),
    subscriberId: text('subscriberId').notNull(),
    gatewayAccount: text('gatewayAccount').notNull(),
    provider: text('provider').notNull(),
    customerRef: text('customerRef').notNull(),
    paymentMethodRef: text('paymentMethodRef').notNull(),
    type: text('type').notNull(),
    brand: text('brand'),
    last4: text('last4').notNull(),
    expiryMonth: integer('expiryMonth'),
    expiryYear: integer('expiryYear'),
    country: text('country'),
    bankCode: text('bankCode'),
    mandateReference: text('mandateReference'),
    status: text('status').notNull().default('ACTIVE'),
    confirmedAt: ts('confirmedAt').notNull(),
    replacedAt: ts('replacedAt'),
    createdAt: writtenAt('createdAt'),
});
