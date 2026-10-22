// Runs the @saasicat/persistence-testing contract against a REAL PostgreSQL
// database: schema applied verbatim from the NORMATIVE artifact
// `@saasicat/spec/sql/reference-schema.postgres.sql`, queried through
// drizzle-orm/node-postgres. Together with the adapter-prisma run this
// proves both adapters deliver the same semantics on the same schema.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database —
// the harness DROPS and recreates its `public` schema. CI provides a
// postgres service; locally:
//
//   docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=test postgres:16
//   SAASICAT_TEST_DATABASE_URL=postgresql://postgres:test@localhost:5432/postgres \
//       pnpm --filter @saasicat/adapter-drizzle test:integration

// @requirement SC-COMP-011 — Every data-access implementation is held to the same executable contract
// @requirement SC-COMP-012 — Where one implementation cannot do what another can, the gap is recorded

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { INVOICE_ARCHIVE_TRIGGERS, TERMS_ARCHIVE_TRIGGERS } from '@saasicat/core';
import { persistenceAdapterContract } from '@saasicat/persistence-testing';
import {
    DrizzleAuditAdapter,
    DrizzleAuditQueryAdapter,
    DrizzleMfaAdapter,
    DrizzlePlanVersionRepository,
    DrizzlePromoCodeHoldRepository,
    DrizzlePromoCodeRedemptionRepository,
    DrizzlePromoCodeRepository,
    DrizzlePromoSubscriptionLookup,
    DrizzleSubscriptionRepository,
    DrizzleTransactionRunner,
    saasicatSchema,
    DrizzleSubscriptionUsageAdapter,
    DrizzleVersionRetirementRepository,
    DrizzleBundleVersionRetirementRepository,
    DrizzleFeatureWithdrawalRepository,
} from '../../dist/index.js';
import { DrizzleBundleRepository, DrizzleSubscriptionBundleRepository } from '../../dist/index.js';
import {
    DrizzleAppliedSettingsRepository,
    DrizzleMaintenanceWindowRepository,
    DrizzleSubscriptionNoticeRepository,
} from '../../dist/index.js';
import {
    DrizzlePlanCatalogReadSink,
    DrizzlePlanRepository,
    DrizzlePaymentEventLog,
    DrizzleSubscriberPaymentMethodRepository,
    DrizzleSubscriberLedgerRepository,
    DrizzleSubscriptionInvoiceRepository,
    DrizzleInvoiceArchive,
    DrizzleTermsArchive,
    DrizzleInvoiceCollectionRepository,
    DrizzleSubscriberPaymentRepository,
    DrizzleSubscriberRepository,
    DrizzleSubscriptionContractRepository,
    DrizzleTenantSubscriptionWrite,
} from '../../dist/index.js';
import { openDisposableDatabase } from './support/disposable-database.mjs';

const { pool, db } = await openDisposableDatabase();

const PLATFORM_TABLES = [
    'subscriber_credit_entries',
    'subscriber_refunds',
    'subscriber_credits',
    'subscription_invoice_settlements',
    'subscriber_payments',
    'subscription_invoice_collections',
    'subscription_invoice_archive',
    'terms_versions',
    'subscription_invoice_documents',
    'subscription_invoice_lines',
    'subscription_invoices',
    'subscription_invoice_numbers',
    'promo_code_redemptions',
    'promo_code_holds',
    'promo_code_validation_logs',
    'promo_codes',
    'subscription_bundles',
    'subscriptions',
    'bundle_versions',
    'bundles',
    'plan_versions',
    'plans',
    'audit_logs',
    'super_admin_mfa',
    'super_admin_users',
    'applied_settings',
    'settings_changes',
    'maintenance_windows',
    'subscription_notices',
    'version_retirements',
    'bundle_version_retirements',
    'feature_withdrawals',
    'subscriber_payment_methods',
    'subscriber_payment_method_setups',
    '"PaymentEventLog"',
    'subscriber_tax_origin_changes',
    'subscriber_corrections',
    'subscriber_tenants',
    'subscribers',
];

function createHarness() {
    return {
        adapter: {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: false,
                advisoryLocks: false,
            },
            transactionRunner: new DrizzleTransactionRunner(db),
            subscriptionRepository: new DrizzleSubscriptionRepository(db),
            planVersionRepository: new DrizzlePlanVersionRepository(db),
            promoCodeRepository: new DrizzlePromoCodeRepository(db),
            promoSubscriptionLookup: new DrizzlePromoSubscriptionLookup(db),
            promoCodeRedemptionRepository: new DrizzlePromoCodeRedemptionRepository(db),
            promoCodeHoldRepository: new DrizzlePromoCodeHoldRepository(db),
            mfa: new DrizzleMfaAdapter(db),
            audit: new DrizzleAuditAdapter(db),
            auditQuery: new DrizzleAuditQueryAdapter(db),
            subscriptionBundleRepository: new DrizzleSubscriptionBundleRepository(db),
            bundleRepository: new DrizzleBundleRepository(db),
            planRepository: new DrizzlePlanRepository(db),
            planCatalogReadSink: new DrizzlePlanCatalogReadSink(db),
            tenantSubscriptionWrite: new DrizzleTenantSubscriptionWrite(db),
            subscriptionContractRepository: new DrizzleSubscriptionContractRepository(db),
            subscriberRepository: new DrizzleSubscriberRepository(db),
            paymentEventLog: new DrizzlePaymentEventLog(db),
            subscriberPaymentMethodRepository: new DrizzleSubscriberPaymentMethodRepository(db),
            subscriberLedgerRepository: new DrizzleSubscriberLedgerRepository(db),
            subscriptionInvoiceRepository: new DrizzleSubscriptionInvoiceRepository(db),
            invoiceArchive: new DrizzleInvoiceArchive(db),
            termsArchive: new DrizzleTermsArchive(db),
            invoiceCollectionRepository: new DrizzleInvoiceCollectionRepository(db),
            subscriberPaymentRepository: new DrizzleSubscriberPaymentRepository(db),
            appliedSettings: new DrizzleAppliedSettingsRepository(db),
            maintenanceWindows: new DrizzleMaintenanceWindowRepository(db),
            subscriptionNotices: new DrizzleSubscriptionNoticeRepository(db),
            versionRetirements: new DrizzleVersionRetirementRepository(db),
            bundleVersionRetirements: new DrizzleBundleVersionRetirementRepository(db),
            featureWithdrawals: new DrizzleFeatureWithdrawalRepository(db),
            subscriptionUsage: new DrizzleSubscriptionUsageAdapter(db),
        },
        seed: {
            async createBundleVersion(input) {
                const bundleId = randomUUID();
                await db.insert(saasicatSchema.bundles).values({
                    id: bundleId,
                    bundleKey: input.bundleKey,
                    label: input.bundleKey,
                    sortOrder: 0,
                    i18n: {},
                    updatedAt: new Date(),
                });
                const id = randomUUID();
                await db.insert(saasicatSchema.bundleVersions).values({
                    id,
                    bundleId,
                    version: 1,
                    features: input.features,
                    quotas: {},
                    compatibility: {},
                    pricingOverrides: [],
                    monthlyNet: '9.90',
                    yearlyNet: '99.00',
                    changeNote: 'seed',
                    publishedAt: new Date(),
                    updatedAt: new Date(),
                });
                return { bundleVersionId: id };
            },
            async createPlanVersion(input) {
                const id = randomUUID();
                await db.insert(saasicatSchema.planVersions).values({
                    id,
                    planId: input.planKey,
                    version: input.version,
                    features: input.features,
                    quotas: input.quotas,
                    monthlyNet: '9.90',
                    yearlyNet: '99.00',
                    changeNote: 'seed',
                    publishedAt: input.published ? new Date() : null,
                    supersededAt: input.superseded ? new Date() : null,
                    updatedAt: new Date(),
                });
                return { planVersionId: id };
            },
            async createSubscription(input) {
                const id = randomUUID();
                await db.insert(saasicatSchema.subscriptions).values({
                    id,
                    tenantId: input.tenantId,
                    plan: input.plan,
                    status: input.status ?? 'ACTIVE',
                    planVersionId: input.planVersionId,
                    pendingChangeVersionId: input.pendingChangeVersionId ?? null,
                    ...(input.billingCycle ? { billingCycle: input.billingCycle } : {}),
                    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
                    ...(input.customLimits !== undefined
                        ? { customLimits: input.customLimits }
                        : {}),
                    updatedAt: new Date(),
                });
                return { subscriptionId: id };
            },
            async clearBookingRequestDate(subscriptionBundleId) {
                await db
                    .update(saasicatSchema.subscriptionBundles)
                    .set({ canceledAt: null })
                    .where(eq(saasicatSchema.subscriptionBundles.id, subscriptionBundleId));
            },
            async setBookingCycle(subscriptionBundleId, billingCycle) {
                await db
                    .update(saasicatSchema.subscriptionBundles)
                    .set({ billingCycle })
                    .where(eq(saasicatSchema.subscriptionBundles.id, subscriptionBundleId));
            },
            async createSubscriber(input) {
                const id = randomUUID();
                await db.insert(saasicatSchema.subscribers).values({
                    id,
                    legalName: input.legalName,
                    updatedAt: new Date(),
                });
                return { subscriberId: id };
            },
            async createPromoCode(input) {
                const id = randomUUID();
                await db.insert(saasicatSchema.promoCodes).values({
                    id,
                    code: input.code,
                    status: input.status ?? 'ACTIVE',
                    valueType: 'PERCENT',
                    value: '10.00',
                    maxRedemptions: input.maxRedemptions,
                    createdById: 'seed-admin',
                    updatedAt: new Date(),
                });
                return { promoCodeId: id };
            },
        },
        async reset() {
            await db.execute(
                sql.raw(`TRUNCATE TABLE ${PLATFORM_TABLES.join(', ')} RESTART IDENTITY CASCADE`),
            );
        },
    };
}

persistenceAdapterContract({
    name: 'adapter-drizzle @ postgres (canonical reference schema)',
    create: async () => createHarness(),
    // The adapter ships no CheckoutOfferRepository: an application implements
    // that port against its own table, and wires it into its own harness.
    gaps: ['checkoutOffers'],
});

/**
 * The shipped migration that protects `table` with `triggers`, to apply whole,
 * and one of its triggers to disable. The triggers would refuse the `TRUNCATE`
 * the tests after these start with, so they are dropped again at the end.
 */
function aProtectingMigration({ file, table, triggers }) {
    const statements = readFileSync(
        join(
            dirname(createRequire(import.meta.url).resolve('@saasicat/spec/package.json')),
            'sql',
            file,
        ),
        'utf8',
    );
    after(async () => {
        for (const trigger of triggers) {
            await pool.query(`DROP TRIGGER IF EXISTS "${trigger}" ON ${table}`);
        }
    });
    return {
        // Run as the file it is, over the simple protocol: its function bodies
        // are dollar-quoted, and a split at each statement would cut them.
        apply: () => pool.query(statements),
        disable: (trigger) => pool.query(`ALTER TABLE ${table} DISABLE TRIGGER "${trigger}"`),
    };
}

// @requirement SC-AUD-014 — An invoice downloaded later is the document that was issued, not a new rendering
describe('the database archive says whether it keeps what it holds', () => {
    const archive = new DrizzleInvoiceArchive(db);
    const migration = aProtectingMigration({
        file: '1.0-an-invoice-document-is-archived.postgres.sql',
        table: 'subscription_invoice_archive',
        triggers: INVOICE_ARCHIVE_TRIGGERS,
    });

    test('built from the reference schema alone, it names the triggers it lacks', async () => {
        const problem = await archive.protectionProblem();

        assert.ok(problem.includes(`lacks ${INVOICE_ARCHIVE_TRIGGERS.join(' and ')},`), problem);
    });

    test('with the migration applied, it keeps what it holds', async () => {
        await migration.apply();

        assert.equal(await archive.protectionProblem(), null);
    });

    test('with one of its triggers disabled, it names that one', async () => {
        const [kept] = INVOICE_ARCHIVE_TRIGGERS;
        await migration.disable(kept);

        const problem = await archive.protectionProblem();

        assert.ok(problem.includes(`lacks ${kept},`), problem);
    });
});

// @requirement SC-CFG-038 — The terms are a version and a file, and an archived version stays as it was
describe('the terms archive says whether it keeps the versions it holds', () => {
    const archive = new DrizzleTermsArchive(db);
    const migration = aProtectingMigration({
        file: '1.0-the-terms-are-a-version-and-a-file.postgres.sql',
        table: 'terms_versions',
        triggers: TERMS_ARCHIVE_TRIGGERS,
    });

    test('built from the reference schema alone, it names both triggers', async () => {
        const problem = await archive.protectionProblem();

        assert.ok(problem.includes(`lacks ${TERMS_ARCHIVE_TRIGGERS.join(' and ')},`), problem);
    });

    test('with the migration applied, nothing', async () => {
        await migration.apply();

        assert.equal(await archive.protectionProblem(), null);
    });

    test('with the one against a truncate disabled, that one', async () => {
        const [, notEmptied] = TERMS_ARCHIVE_TRIGGERS;
        await migration.disable(notEmptied);

        const problem = await archive.protectionProblem();

        assert.ok(problem.includes(`lacks ${notEmptied},`), problem);
    });
});

describe('drizzle-specific schema interop', () => {
    after(async () => {
        await pool.end();
    });

    test('text-declared enum columns round-trip against Postgres enum types', async () => {
        await db.execute(sql.raw('TRUNCATE TABLE subscriptions, plan_versions CASCADE'));
        const versionId = randomUUID();
        await db.insert(saasicatSchema.planVersions).values({
            id: versionId,
            planId: 'STARTER',
            version: 1,
            features: [],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
            changeNote: 'enum-check',
            publishedAt: new Date(),
            updatedAt: new Date(),
        });
        await db.insert(saasicatSchema.subscriptions).values({
            id: randomUUID(),
            tenantId: 'enum-check',
            plan: 'STARTER',
            status: 'TRIAL',
            billingCycle: 'MONTHLY',
            planVersionId: versionId,
            updatedAt: new Date(),
        });

        const rows = await db
            .select({
                status: saasicatSchema.subscriptions.status,
                billingCycle: saasicatSchema.subscriptions.billingCycle,
            })
            .from(saasicatSchema.subscriptions);
        assert.deepEqual(rows, [{ status: 'TRIAL', billingCycle: 'MONTHLY' }]);
    });

    test('the required planVersionId constraint bites through the drizzle write path', async () => {
        await db.execute(sql.raw('TRUNCATE TABLE subscriptions CASCADE'));
        await assert.rejects(
            db.insert(saasicatSchema.subscriptions).values({
                id: randomUUID(),
                tenantId: 'check-violation',
                plan: 'STARTER',
                updatedAt: new Date(),
            }),
            // drizzle wraps the pg error ("Failed query: ..."). PostgreSQL
            // exposes NOT NULL violations as 23502 and identifies the column
            // on the underlying cause.
            (err) => err.cause?.code === '23502' && err.cause?.column === 'planVersionId',
        );
    });
});
