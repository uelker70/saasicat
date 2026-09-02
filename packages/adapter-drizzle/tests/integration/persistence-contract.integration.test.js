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
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { persistenceAdapterContract } from '@saasicat/persistence-testing';
import {
    DrizzleAuditAdapter,
    DrizzleAuditQueryAdapter,
    DrizzleMfaAdapter,
    DrizzlePlanVersionRepository,
    DrizzlePromoCodeRedemptionRepository,
    DrizzlePromoCodeRepository,
    DrizzlePromoSubscriptionLookup,
    DrizzleSubscriptionRepository,
    DrizzleTransactionRunner,
    saasicatSchema,
} from '../../dist/index.js';
import { DrizzleBundleRepository, DrizzleSubscriptionBundleRepository } from '../../dist/index.js';
import { DrizzleAppliedSettingsRepository } from '../../dist/index.js';
import {
    DrizzlePlanRepository,
    DrizzleSubscriptionContractRepository,
    DrizzleTenantSubscriptionWrite,
} from '../../dist/index.js';
import { openDisposableDatabase } from './support/disposable-database.mjs';

const { pool, db } = await openDisposableDatabase();

const PLATFORM_TABLES = [
    'promo_code_redemptions',
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
            mfa: new DrizzleMfaAdapter(db),
            audit: new DrizzleAuditAdapter(db),
            auditQuery: new DrizzleAuditQueryAdapter(db),
            subscriptionBundleRepository: new DrizzleSubscriptionBundleRepository(db),
            bundleRepository: new DrizzleBundleRepository(db, { validityWindows: true }),
            planRepository: new DrizzlePlanRepository(db, { validityWindows: true }),
            tenantSubscriptionWrite: new DrizzleTenantSubscriptionWrite(db),
            subscriptionContractRepository: new DrizzleSubscriptionContractRepository(db),
            appliedSettings: new DrizzleAppliedSettingsRepository(db),
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
                    pendingPlanVersionId: input.pendingPlanVersionId ?? null,
                    ...(input.billingCycle ? { billingCycle: input.billingCycle } : {}),
                    ...(input.startedAt ? { startedAt: input.startedAt } : {}),
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
