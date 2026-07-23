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

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { persistenceAdapterContract } from '@saasicat/persistence-testing';
import {
    DrizzleAuditAdapter,
    DrizzleAuditQueryAdapter,
    DrizzleMfaAdapter,
    DrizzlePlanVersionRepository,
    DrizzlePromoCodeRedemptionRepository,
    DrizzlePromoCodeRepository,
    DrizzleSubscriptionRepository,
    DrizzleTransactionRunner,
    saasicatSchema,
} from '../dist/index.js';

const databaseUrl = process.env.SAASICAT_TEST_DATABASE_URL;
if (!databaseUrl) {
    throw new Error(
        'SAASICAT_TEST_DATABASE_URL is required for the integration tests — point it at a ' +
            'disposable PostgreSQL database (see the header of this file).',
    );
}

const require = createRequire(import.meta.url);
const specRoot = dirname(require.resolve('@saasicat/spec/package.json'));

const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
const db = drizzle(pool);

function sqlStatements(file) {
    return readFileSync(file, 'utf8')
        .split(';')
        .map((statement) =>
            statement
                .split('\n')
                .filter((line) => !line.trim().startsWith('--'))
                .join('\n')
                .trim(),
        )
        .filter(Boolean);
}

// Disposable-database contract: rebuild the schema from the normative
// reference DDL on every run.
await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
await pool.query('CREATE SCHEMA public');
for (const statement of sqlStatements(join(specRoot, 'sql', 'reference-schema.postgres.sql'))) {
    await pool.query(statement);
}

const PLATFORM_TABLES = [
    'promo_code_redemptions',
    'promo_code_validation_logs',
    'promo_codes',
    'subscriptions',
    'plan_versions',
    'plans',
    'audit_logs',
    'super_admin_mfa',
    'super_admin_users',
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
            promoCodeRedemptionRepository: new DrizzlePromoCodeRedemptionRepository(db),
            mfa: new DrizzleMfaAdapter(db),
            audit: new DrizzleAuditAdapter(db),
            auditQuery: new DrizzleAuditQueryAdapter(db),
        },
        seed: {
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
                    updatedAt: new Date(),
                });
                return { subscriptionId: id };
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
