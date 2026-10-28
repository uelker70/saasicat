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

import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import pg from 'pg';
import {
    CATALOG_ERROR_CODES,
    INVOICE_ARCHIVE_TRIGGERS,
    TERMS_ARCHIVE_TRIGGERS,
    CONFIRMATION_ARCHIVE_TRIGGERS,
    isPersistenceRefusal,
} from '@saasicat/core';
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
    PrismaSubscriptionInvoiceRepository,
    PrismaInvoiceArchive,
    PrismaTermsArchive,
    PrismaContractConfirmationRepository,
    PrismaContractConfirmationArchive,
    PrismaInvoiceCollectionRepository,
    PrismaSubscriberPaymentRepository,
    PrismaSubscriberRepository,
    PrismaSubscriberJoinRepository,
    PrismaSubscriptionContractRepository,
    PrismaSubscriptionRepository,
    PrismaTenantSubscriptionWriteAdapter,
    PrismaTransactionRunner,
    PrismaSubscriptionUsageAdapter,
    PrismaVersionRetirementRepository,
    PrismaBundleVersionRetirementRepository,
    PrismaFeatureWithdrawalRepository,
} from '../../dist/index.js';
import { generatedPrismaClient, rebuildFromReferenceSchema, testDatabaseUrl } from './database.js';

testDatabaseUrl();
const PrismaClient = generatedPrismaClient('persistence-contract');
const prisma = new PrismaClient();

// Disposable-database contract: rebuild the schema from the normative
// reference DDL on every run.
await rebuildFromReferenceSchema(prisma);
// The guard of a join is a set of triggers, which the reference DDL cannot
// carry: the shipped migration adds them, as it does after `db push`.
await applyShippedMigration('1.0-a-subscriber-is-joined.postgres.sql');

const PLATFORM_TABLES = [
    'subscriber_joins',
    'subscriber_credit_entries',
    'subscriber_refunds',
    'subscriber_credits',
    'subscription_invoice_settlements',
    'subscriber_payments',
    'subscription_invoice_collections',
    'contract_confirmation_archive',
    'contract_confirmations',
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
            bundleRepository: new PrismaBundleRepository(prisma),
            subscriptionBundleRepository: new PrismaSubscriptionBundleRepository(prisma),
            planRepository: new PrismaPlanRepository(prisma),
            planCatalogReadSink: new PrismaPlanCatalogReadSink(prisma),
            subscriptionContractRepository: new PrismaSubscriptionContractRepository(prisma),
            subscriberRepository: new PrismaSubscriberRepository(prisma),
            subscriberJoinRepository: new PrismaSubscriberJoinRepository(prisma),
            paymentEventLog: new PrismaPaymentEventLog(prisma),
            subscriberPaymentMethodRepository: new PrismaSubscriberPaymentMethodRepository(prisma),
            subscriberLedgerRepository: new PrismaSubscriberLedgerRepository(prisma),
            subscriptionInvoiceRepository: new PrismaSubscriptionInvoiceRepository(prisma),
            invoiceArchive: new PrismaInvoiceArchive(prisma),
            termsArchive: new PrismaTermsArchive(prisma),
            contractConfirmationRepository: new PrismaContractConfirmationRepository(prisma),
            contractConfirmationArchive: new PrismaContractConfirmationArchive(prisma),
            invoiceCollectionRepository: new PrismaInvoiceCollectionRepository(prisma),
            subscriberPaymentRepository: new PrismaSubscriberPaymentRepository(prisma),
            appliedSettings: new PrismaAppliedSettingsRepository(prisma),
            maintenanceWindows: new PrismaMaintenanceWindowRepository(prisma),
            subscriptionNotices: new PrismaSubscriptionNoticeRepository(prisma),
            versionRetirements: new PrismaVersionRetirementRepository(prisma),
            bundleVersionRetirements: new PrismaBundleVersionRetirementRepository(prisma),
            featureWithdrawals: new PrismaFeatureWithdrawalRepository(prisma),
            subscriptionUsage: new PrismaSubscriptionUsageAdapter(prisma),
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
            async markContractWrittenBeforeConfirmations(contractId) {
                await prisma.subscriptionContract.update({
                    where: { id: contractId },
                    data: { confirmationDue: false },
                });
            },
            async createSubscriber(input) {
                const row = await prisma.subscriber.create({
                    data: { legalName: input.legalName },
                });
                return { subscriberId: row.id };
            },
            async closeTenantLink(subscriberId, at) {
                await prisma.subscriberTenant.updateMany({
                    where: { subscriberId, unlinkedAt: null },
                    data: { unlinkedAt: at },
                });
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

/** Applies the shipped migration `file` whole, over the simple protocol its function bodies need. */
async function applyShippedMigration(file) {
    const database = new pg.Client({ connectionString: testDatabaseUrl() });
    await database.connect();
    try {
        await database.query(
            readFileSync(
                join(
                    dirname(createRequire(import.meta.url).resolve('@saasicat/spec/package.json')),
                    'sql',
                    file,
                ),
                'utf8',
            ),
        );
    } finally {
        await database.end();
    }
}

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
    // The migration's function bodies are dollar-quoted: run as the file it is,
    // over the simple protocol, rather than split into statements.
    const database = new pg.Client({ connectionString: testDatabaseUrl() });
    before(() => database.connect());
    after(async () => {
        for (const trigger of triggers) {
            await database.query(`DROP TRIGGER IF EXISTS "${trigger}" ON ${table}`);
        }
        await database.end();
    });
    return {
        apply: () => database.query(statements),
        disable: (trigger) => database.query(`ALTER TABLE ${table} DISABLE TRIGGER "${trigger}"`),
    };
}

// @requirement SC-AUD-014 — An invoice downloaded later is the document that was issued, not a new rendering
describe('the database archive says whether it keeps what it holds', () => {
    const archive = new PrismaInvoiceArchive(prisma);
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
        const [, notEmptied] = INVOICE_ARCHIVE_TRIGGERS;
        await migration.disable(notEmptied);

        const problem = await archive.protectionProblem();

        assert.ok(problem.includes(`lacks ${notEmptied},`), problem);
    });
});

// @requirement SC-CFG-038 — The terms are a version and a file, and an archived version stays as it was
describe('the terms archive says whether it keeps the versions it holds', () => {
    const archive = new PrismaTermsArchive(prisma);
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

    test('with the one against an update or a delete disabled, that one', async () => {
        const [kept] = TERMS_ARCHIVE_TRIGGERS;
        await migration.disable(kept);

        const problem = await archive.protectionProblem();

        assert.ok(problem.includes(`lacks ${kept},`), problem);
    });
});

// @requirement SC-AUD-016 — Concluding or changing a contract gives the subscriber a confirmation to keep
describe('the confirmation archive says whether it keeps the confirmations it holds', () => {
    const archive = new PrismaContractConfirmationArchive(prisma);
    const migration = aProtectingMigration({
        file: '1.0-a-contract-confirmation-is-archived.postgres.sql',
        table: 'contract_confirmation_archive',
        triggers: CONFIRMATION_ARCHIVE_TRIGGERS,
    });

    test('built from the reference schema alone, it names both triggers', async () => {
        const problem = await archive.protectionProblem();

        assert.ok(
            problem.includes(`lacks ${CONFIRMATION_ARCHIVE_TRIGGERS.join(' and ')},`),
            problem,
        );
    });

    test('with the migration applied, nothing', async () => {
        await migration.apply();

        assert.equal(await archive.protectionProblem(), null);
    });

    test('with the one against a truncate disabled, that one', async () => {
        const [, notEmptied] = CONFIRMATION_ARCHIVE_TRIGGERS;
        await migration.disable(notEmptied);

        const problem = await archive.protectionProblem();

        assert.ok(problem.includes(`lacks ${notEmptied},`), problem);
    });
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

// @requirement SC-ADM-050 — A join moves everything in one step, and a subscriber joined is given nothing afterwards
describe('a join says what would let a subscriber joined be given a row', () => {
    const GUARD = 'subscriber_payments_names_no_joined_subscriber';
    const database = new pg.Client({ connectionString: testDatabaseUrl() });
    before(() => database.connect());
    after(async () => {
        await database.query(`ALTER TABLE subscriber_payments ENABLE TRIGGER "${GUARD}"`);
        await database.end();
    });

    test('names a table whose trigger does not fire, and none where every one does', async () => {
        const joins = new PrismaSubscriberJoinRepository(prisma);
        assert.equal(await joins.protectionProblem(), null);

        await database.query(`ALTER TABLE subscriber_payments DISABLE TRIGGER "${GUARD}"`);
        try {
            const problem = await joins.protectionProblem();
            assert.ok(
                problem?.startsWith('subscriber_payments lacks its trigger, which refuses'),
                problem,
            );
        } finally {
            await database.query(`ALTER TABLE subscriber_payments ENABLE TRIGGER "${GUARD}"`);
        }
    });

    test('names a model the client was generated without, which it would leave rows in', async () => {
        // The delegates of the generated client, but the charge journal's.
        const without = { $queryRaw: prisma.$queryRaw.bind(prisma), subscriber: prisma.subscriber };
        for (const delegate of [
            'subscriberJoin',
            'subscriberTenant',
            'subscriberCorrection',
            'subscriberTaxOriginChange',
            'subscriberVatIdCheck',
            'subscriberPaymentMethod',
            'subscriberPaymentMethodSetup',
            'subscriptionContract',
            'subscriptionInvoice',
            'subscriberPayment',
            'subscriberCredit',
            'subscriberRefund',
            'subscriberReversal',
            'subscriberReconciliationCase',
        ]) {
            without[delegate] = prisma[delegate];
        }

        const problem = await new PrismaSubscriberJoinRepository(without).protectionProblem();

        assert.ok(
            problem?.startsWith(
                'The schema lacks SubscriberLedgerEntry (subscriber_ledger_entries), which a join',
            ),
            problem,
        );
        assert.equal(
            await new PrismaSubscriberJoinRepository(without, [
                'SubscriberLedgerEntry',
            ]).protectionProblem(),
            null,
            'a model named in notAdopted is not asked for',
        );
    });
});
