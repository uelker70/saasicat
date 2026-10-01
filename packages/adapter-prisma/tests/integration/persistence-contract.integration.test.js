// Runs the @saasicat/persistence-testing contract against a REAL PostgreSQL
// database. The schema comes from the NORMATIVE artifact
// `@saasicat/spec/sql/reference-schema.postgres.sql` (applied verbatim);
// the Prisma client is generated from the composed prisma-fragments — so
// this suite proves fragments, reference SQL and adapters agree.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database —
// the harness DROPS and recreates its `public` schema. CI provides a
// postgres service; locally:
//
//   docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=test postgres:16
//   SAASICAT_TEST_DATABASE_URL=postgresql://postgres:test@localhost:5432/postgres \
//       pnpm --filter @saasicat/adapter-prisma test:integration

// @requirement SC-COMP-011 — Every data-access implementation is held to the same executable contract
// @requirement SC-COMP-012 — Where one implementation cannot do what another can, the gap is recorded

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_ERROR_CODES, isPersistenceRefusal } from '@saasicat/core';
import { persistenceAdapterContract } from '@saasicat/persistence-testing';
import {
    PrismaAuditAdapter,
    PrismaAuditQueryAdapter,
    PrismaBundleRepository,
    PrismaSubscriptionBundleRepository,
    PrismaMfaAdapter,
    PrismaPlanCatalogReadSink,
    PrismaPlanRepository,
    PrismaPlanVersionRepository,
    PrismaPromoCodeHoldRepository,
    PrismaPromoCodeRedemptionRepository,
    PrismaPromoCodeRepository,
    PrismaPromoSubscriptionLookup,
    PrismaAppliedSettingsRepository,
    PrismaMaintenanceWindowRepository,
    PrismaSubscriptionNoticeRepository,
    PrismaMarketingProjectionRepository,
    PrismaPaymentEventLog,
    PrismaSubscriberPaymentMethodRepository,
    PrismaSubscriberLedgerRepository,
    PrismaSubscriberRepository,
    PrismaSubscriptionContractRepository,
    PrismaSubscriptionRepository,
    PrismaTenantSubscriptionWriteAdapter,
    PrismaTransactionRunner,
} from '../../dist/index.js';
import { generatedPrismaClient, rebuildFromReferenceSchema, testDatabaseUrl } from './database.js';

testDatabaseUrl();
const PrismaClient = generatedPrismaClient('persistence-contract');
const prisma = new PrismaClient();

// Disposable-database contract: rebuild the schema from the normative
// reference DDL on every run.
await rebuildFromReferenceSchema(prisma);

const PLATFORM_TABLES = [
    'promo_code_redemptions',
    'promo_code_holds',
    'promo_code_validation_logs',
    'promo_codes',
    'subscriptions',
    'plan_versions',
    'plans',
    'bundle_versions',
    'bundles',
    'audit_logs',
    'super_admin_mfa',
    'super_admin_users',
    'applied_settings',
    'settings_changes',
    'maintenance_windows',
    'subscription_notices',
    'subscriber_payment_methods',
    'subscriber_payment_method_setups',
    '"PaymentEventLog"',
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
            transactionRunner: new PrismaTransactionRunner(prisma),
            subscriptionRepository: new PrismaSubscriptionRepository(prisma),
            planVersionRepository: new PrismaPlanVersionRepository(prisma),
            promoCodeRepository: new PrismaPromoCodeRepository(prisma),
            promoSubscriptionLookup: new PrismaPromoSubscriptionLookup(prisma),
            promoCodeRedemptionRepository: new PrismaPromoCodeRedemptionRepository(prisma),
            promoCodeHoldRepository: new PrismaPromoCodeHoldRepository(prisma),
            mfa: new PrismaMfaAdapter(prisma),
            audit: new PrismaAuditAdapter(prisma),
            auditQuery: new PrismaAuditQueryAdapter(prisma),
            // Binding the plan version is the default, so the contract proves the
            // default rather than an option set for it.
            tenantSubscriptionWrite: new PrismaTenantSubscriptionWriteAdapter(prisma, {
                tenantSubscription: { atomicOnboardingSelection: true },
            }),
            bundleRepository: new PrismaBundleRepository(prisma, {
                validityWindows: true,
            }),
            subscriptionBundleRepository: new PrismaSubscriptionBundleRepository(prisma),
            planRepository: new PrismaPlanRepository(prisma),
            planCatalogReadSink: new PrismaPlanCatalogReadSink(prisma),
            subscriptionContractRepository: new PrismaSubscriptionContractRepository(prisma),
            subscriberRepository: new PrismaSubscriberRepository(prisma),
            paymentEventLog: new PrismaPaymentEventLog(prisma),
            subscriberPaymentMethodRepository: new PrismaSubscriberPaymentMethodRepository(prisma),
            subscriberLedgerRepository: new PrismaSubscriberLedgerRepository(prisma),
            appliedSettings: new PrismaAppliedSettingsRepository(prisma),
            maintenanceWindows: new PrismaMaintenanceWindowRepository(prisma),
            subscriptionNotices: new PrismaSubscriptionNoticeRepository(prisma),
        },
        seed: {
            async createPlanVersion(input) {
                const row = await prisma.planVersion.create({
                    data: {
                        planId: input.planKey,
                        version: input.version,
                        features: input.features,
                        quotas: input.quotas,
                        monthlyNet: '9.90',
                        yearlyNet: '99.00',
                        marketed: true,
                        changeNote: 'seed',
                        publishedAt: input.published ? new Date() : null,
                        supersededAt: input.superseded ? new Date() : null,
                    },
                });
                return { planVersionId: row.id };
            },
            async createSubscription(input) {
                const row = await prisma.subscription.create({
                    data: {
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
                    },
                });
                return { subscriptionId: row.id };
            },
            async createBundleVersion(input) {
                const bundle = await prisma.bundle.create({
                    data: { bundleKey: input.bundleKey, label: input.bundleKey },
                });
                const row = await prisma.bundleVersion.create({
                    data: {
                        bundleId: bundle.id,
                        version: 1,
                        features: input.features,
                        quotas: {},
                        monthlyNet: '9.90',
                        yearlyNet: '99.00',
                        changeNote: 'seed',
                        publishedAt: new Date(),
                    },
                });
                return { bundleVersionId: row.id };
            },
            async clearBookingRequestDate(subscriptionBundleId) {
                await prisma.subscriptionBundle.update({
                    where: { id: subscriptionBundleId },
                    data: { canceledAt: null },
                });
            },
            async setBookingCycle(subscriptionBundleId, billingCycle) {
                await prisma.subscriptionBundle.update({
                    where: { id: subscriptionBundleId },
                    data: { billingCycle },
                });
            },
            async createSubscriber(input) {
                const row = await prisma.subscriber.create({
                    data: { legalName: input.legalName },
                });
                return { subscriberId: row.id };
            },
            async createPromoCode(input) {
                const row = await prisma.promoCode.create({
                    data: {
                        code: input.code,
                        status: input.status ?? 'ACTIVE',
                        valueType: 'PERCENT',
                        value: '10.00',
                        durationType: 'ONCE',
                        maxRedemptions: input.maxRedemptions,
                        createdById: 'seed-admin',
                    },
                });
                return { promoCodeId: row.id };
            },
        },
        async reset() {
            await prisma.$executeRawUnsafe(
                `TRUNCATE TABLE ${PLATFORM_TABLES.join(', ')} RESTART IDENTITY CASCADE`,
            );
        },
    };
}

persistenceAdapterContract({
    name: 'adapter-prisma @ postgres (canonical fragments schema)',
    create: async () => createHarness(),
    // The adapter ships no CheckoutOfferRepository: an application implements
    // that port against its own table, and wires it into its own harness.
    gaps: ['checkoutOffers'],
});

// @requirement SC-OPS-016 — A request that loses a race reads what the check says, not a server error
describe('a create the store refuses', () => {
    test('a marketing projection for a target and locale that has one is refused by code', async () => {
        const repository = new PrismaMarketingProjectionRepository(prisma);
        const target = { targetType: 'plan', targetVersionId: 'pv-refused', locale: 'de' };
        await repository.create({ ...target, displayLabel: 'Pro', description: '' });
        await assert.rejects(
            repository.create({ ...target, displayLabel: 'Pro again', description: '' }),
            (error) => {
                assert.ok(isPersistenceRefusal(error), String(error));
                assert.equal(error.code, CATALOG_ERROR_CODES.MARKETING_PROJECTION_ALREADY_EXISTS);
                assert.deepEqual(error.params, target);
                return true;
            },
        );
    });

    test("a unique index of the application's own is not reported as a key taken", async () => {
        await prisma.$executeRawUnsafe(
            'CREATE UNIQUE INDEX "plans_label_of_the_application" ON plans (label)',
        );
        try {
            const plans = new PrismaPlanRepository(prisma);
            await plans.create({ planKey: 'OWN-INDEX-A', label: 'Same label' });
            await assert.rejects(
                plans.create({ planKey: 'OWN-INDEX-B', label: 'Same label' }),
                (error) => {
                    assert.equal(isPersistenceRefusal(error), false, String(error));
                    assert.match(error.message, /unique index other than its key/);
                    return true;
                },
            );
        } finally {
            await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "plans_label_of_the_application"');
        }
    });

    test("leaves the caller's transaction usable, where a failed insert would abort it", async () => {
        const planKey = 'TAKEN-IN-A-TRANSACTION';
        await new PrismaPlanRepository(prisma).create({ planKey, label: 'First' });
        const readAfterwards = await prisma.$transaction(async (tx) => {
            await assert.rejects(
                new PrismaPlanRepository(tx).create({ planKey, label: 'Second' }),
                (error) =>
                    isPersistenceRefusal(error) &&
                    error.code === CATALOG_ERROR_CODES.PLAN_ALREADY_EXISTS,
            );
            return tx.plan.findFirst({ where: { planKey } });
        });
        assert.equal(readAfterwards?.label, 'First');
    });
});

describe('canonical schema structure', () => {
    after(async () => {
        await prisma.$disconnect();
    });

    test('partial unique draft indexes exist', async () => {
        const rows = await prisma.$queryRawUnsafe(
            `SELECT indexname FROM pg_indexes WHERE indexname IN
             ('plan_versions_draft_per_plan', 'bundle_versions_draft_per_bundle')`,
        );
        assert.equal(rows.length, 2, 'both draft-per-identity partial unique indexes');
    });

    test('one draft per plan lineage is enforced by the database', async () => {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE plan_versions RESTART IDENTITY CASCADE`);
        await prisma.planVersion.create({
            data: {
                planId: 'STARTER',
                version: 2,
                features: [],
                quotas: {},
                monthlyNet: '0.00',
                yearlyNet: '0.00',
                changeNote: 'draft 1',
            },
        });
        await assert.rejects(
            prisma.planVersion.create({
                data: {
                    planId: 'STARTER',
                    version: 3,
                    features: [],
                    quotas: {},
                    monthlyNet: '0.00',
                    yearlyNet: '0.00',
                    changeNote: 'draft 2',
                },
            }),
            'second draft in the same lineage must violate the partial unique index',
        );
    });

    test('subscriptions require planVersionId', async () => {
        await assert.rejects(
            prisma.subscription.create({
                data: { tenantId: 'tenant-check', plan: 'STARTER' },
            }),
            'required planVersionId must reject',
        );
    });
});
