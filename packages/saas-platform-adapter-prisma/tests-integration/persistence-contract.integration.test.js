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

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { persistenceAdapterContract } from '@saasicat/persistence-testing';
import {
    PrismaAuditAdapter,
    PrismaAuditQueryAdapter,
    PrismaMfaAdapter,
    PrismaPlanVersionRepository,
    PrismaPromoCodeRedemptionRepository,
    PrismaPromoCodeRepository,
    PrismaSubscriptionRepository,
    PrismaTransactionRunner,
} from '../dist/index.js';

const databaseUrl = process.env.SAASICAT_TEST_DATABASE_URL;
if (!databaseUrl) {
    throw new Error(
        'SAASICAT_TEST_DATABASE_URL is required for the integration tests — point it at a ' +
            'disposable PostgreSQL database (see the header of this file).',
    );
}

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const specRoot = dirname(require.resolve('@saasicat/spec/package.json'));
const workDir = join(packageRoot, '.integration-tmp');

function composeSchema() {
    const fragmentsDir = join(specRoot, 'prisma-fragments');
    const fragments = readdirSync(fragmentsDir)
        .filter((file) => file.endsWith('.prisma'))
        .sort()
        .map((file) => readFileSync(join(fragmentsDir, file), 'utf8'));
    const header = [
        '// Composed from @saasicat/spec prisma-fragments — generated for the',
        '// integration tests, do not edit.',
        'datasource db {',
        '    provider = "postgresql"',
        '    url      = env("SAASICAT_TEST_DATABASE_URL")',
        '}',
        'generator client {',
        '    provider = "prisma-client-js"',
        '    output   = "./generated-client"',
        '}',
        '',
    ].join('\n');
    return `${header}\n${fragments.join('\n')}`;
}

function generateClient() {
    rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });
    const schemaPath = join(workDir, 'schema.prisma');
    writeFileSync(schemaPath, composeSchema());
    execFileSync('pnpm', ['exec', 'prisma', 'generate', `--schema=${schemaPath}`], {
        cwd: packageRoot,
        env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
        stdio: 'inherit',
    });
}

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

generateClient();
const { PrismaClient } = require(join(workDir, 'generated-client'));
const prisma = new PrismaClient();

// Disposable-database contract: rebuild the schema from the normative
// reference DDL on every run.
await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
await prisma.$executeRawUnsafe('CREATE SCHEMA public');
for (const statement of sqlStatements(join(specRoot, 'sql', 'reference-schema.postgres.sql'))) {
    await prisma.$executeRawUnsafe(statement);
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
            transactionRunner: new PrismaTransactionRunner(prisma),
            subscriptionRepository: new PrismaSubscriptionRepository(prisma),
            planVersionRepository: new PrismaPlanVersionRepository(prisma),
            promoCodeRepository: new PrismaPromoCodeRepository(prisma),
            promoCodeRedemptionRepository: new PrismaPromoCodeRedemptionRepository(prisma),
            mfa: new PrismaMfaAdapter(prisma),
            audit: new PrismaAuditAdapter(prisma),
            auditQuery: new PrismaAuditQueryAdapter(prisma),
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
                        pendingPlanVersionId: input.pendingPlanVersionId ?? null,
                    },
                });
                return { subscriptionId: row.id };
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
