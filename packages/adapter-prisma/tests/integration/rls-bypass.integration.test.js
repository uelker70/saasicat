// The bundle's RLS bypass against a real, forced row policy.
//
// A policy is only tested by a role it applies to: a superuser skips every
// policy, FORCE or not. So this suite builds its tables in a database of its
// own, puts a tenant policy on two of them — the one the policy docs in the
// README describe — and runs the bundle as a role without BYPASSRLS. Every
// kind of statement the platform issues inside the bypass has to see across
// tenants: a read, a write through a shipped repository, a raw statement, and
// a transaction the platform's runner opens. And nothing outside the bypass
// may.
//
// Requires SAASICAT_TEST_DATABASE_URL, as the contract suite does. It creates
// the database `<name>_rls` and the role `saasicat_rls_probe` beside it.

// @requirement SC-COMP-019 — Under row-level security, the Prisma bundle lifts it for cross-tenant work

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PrismaRlsBypass, prismaPersistence } from '../../dist/index.js';
import { generatedPrismaClient, rebuildFromReferenceSchema, testDatabaseUrl } from './database.js';

const PROBE_ROLE = 'saasicat_rls_probe';
const PROBE_PASSWORD = 'rls-probe';
const TENANT_TABLE = 'promo_code_redemptions';

const adminUrl = new URL(testDatabaseUrl());
const databaseName = `${adminUrl.pathname.slice(1)}_rls`;
const ownerUrl = withDatabase(adminUrl, databaseName);
const probeUrl = new URL(ownerUrl);
probeUrl.username = PROBE_ROLE;
probeUrl.password = PROBE_PASSWORD;

function withDatabase(url, name) {
    const next = new URL(url);
    next.pathname = `/${name}`;
    return next;
}

const PrismaClient = generatedPrismaClient('rls-bypass');

/** The policy the README gives an installation, on one table. */
function tenantPolicy(table) {
    const visible =
        `"tenantId" = current_setting('app.tenant_id', true) ` +
        `OR current_setting('app.bypass_rls', true) = 'true'`;
    return [
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
        `CREATE POLICY tenant_rows ON "${table}" USING (${visible}) WITH CHECK (${visible})`,
    ];
}

async function prepareDatabase() {
    const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
    try {
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
        const roles = await admin.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = ${PROBE_ROLE}`;
        if (roles.length === 0) {
            await admin.$executeRawUnsafe(
                `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}' NOSUPERUSER NOBYPASSRLS`,
            );
        }
    } finally {
        await admin.$disconnect();
    }

    const owner = new PrismaClient({ datasourceUrl: ownerUrl.toString() });
    try {
        await rebuildFromReferenceSchema(owner);
        await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
        await owner.$executeRawUnsafe(
            `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`,
        );
        for (const statement of tenantPolicy(TENANT_TABLE))
            await owner.$executeRawUnsafe(statement);
        await seedTwoTenants(owner);
    } finally {
        await owner.$disconnect();
    }
}

const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');
const TENANTS = ['tenant-a', 'tenant-b'];

/** A subscription and a redemption that has run out, for each of two tenants. */
async function seedTwoTenants(owner) {
    const version = await owner.planVersion.create({
        data: {
            planId: 'PRO',
            version: 1,
            features: [],
            quotas: {},
            monthlyNet: '9.90',
            yearlyNet: '99.00',
            changeNote: 'seed',
        },
    });
    for (const tenantId of TENANTS) {
        const code = await owner.promoCode.create({
            data: { code: `CODE-${tenantId}`, valueType: 'PERCENT', value: '10.00' },
        });
        const subscription = await owner.subscription.create({
            data: { tenantId, plan: 'PRO', planVersionId: version.id },
        });
        await owner.promoCodeRedemption.create({
            data: {
                promoCodeId: code.id,
                subscriptionId: subscription.id,
                tenantId,
                appliedValueType: 'PERCENT',
                appliedValue: '10.00',
                appliedDurationType: 'ONCE',
                startsAt: LONG_AGO,
                endsAt: LONG_AGO,
            },
        });
    }
}

await prepareDatabase();

describe('the bundle lifts a forced tenant policy inside the bypass, and only there', () => {
    const probe = new PrismaClient({ datasourceUrl: probeUrl.toString() });
    const rls = new PrismaRlsBypass();
    const bundle = prismaPersistence({ client: probe, rlsIntegration: rls });
    const bypass = bundle.core.rlsBypass;
    const runner = bundle.core.transactionRunner;
    const redemptions = bundle.promo.redemptionRepository;
    // The client every adapter of the bundle runs its statements through.
    const lifted = rls.extend(probe);

    before(async () => {
        await probe.$connect();
    });
    after(async () => {
        await probe.$disconnect();
    });

    test('the port the platform calls is the one the adapters answer to', () => {
        assert.equal(bypass, rls.port);
    });

    test('outside the bypass the policy hides every row: the probe is subject to it', async () => {
        assert.equal(await lifted.promoCodeRedemption.count(), 0);
        assert.equal(await probe.promoCodeRedemption.count(), 0);
    });

    test('a read inside the bypass sees every tenant', async () => {
        const count = await bypass.runWithBypass(() => lifted.promoCodeRedemption.count());
        assert.equal(count, TENANTS.length);
    });

    test('a raw statement inside the bypass sees every tenant', async () => {
        const [row] = await bypass.runWithBypass(
            () => lifted.$queryRaw`SELECT count(*)::int AS n FROM promo_code_redemptions`,
        );
        assert.equal(row.n, TENANTS.length);
    });

    test("a shipped repository's write inside the bypass reaches every tenant", async () => {
        const expired = await bypass.runWithBypass(() =>
            redemptions.expireDueRedemptions(new Date()),
        );
        assert.equal(expired, TENANTS.length);
    });

    test('a transaction the runner opens inside the bypass reads and writes every tenant', async () => {
        const { seen, reversed } = await bypass.runWithBypass(() =>
            runner.run(async (tx) => ({
                seen: await tx.promoCodeRedemption.count(),
                reversed: (
                    await tx.promoCodeRedemption.updateMany({
                        where: { status: 'EXPIRED' },
                        data: { status: 'REVERSED', reversedAt: new Date() },
                    })
                ).count,
            })),
        );
        assert.equal(seen, TENANTS.length);
        assert.equal(reversed, TENANTS.length);
    });

    test('a transaction a repository opens on the client itself is lifted, and stays one transaction', async () => {
        // Seen from inside, every tenant's rows; and a failure rolls back what
        // it wrote, which it would not if its statements had each gone out as
        // a batch of their own.
        const reversed = () =>
            bypass.runWithBypass(() =>
                lifted.promoCodeRedemption.count({ where: { status: 'REVERSED' } }),
            );
        const before = await reversed();

        await assert.rejects(
            () =>
                bypass.runWithBypass(() =>
                    lifted.$transaction(async (tx) => {
                        const { count } = await tx.promoCodeRedemption.updateMany({
                            data: { status: 'ACTIVE' },
                        });
                        assert.equal(count, TENANTS.length, 'it wrote every tenant');
                        throw new Error('roll back');
                    }),
                ),
            /roll back/,
        );

        assert.equal(before, TENANTS.length);
        assert.equal(await reversed(), before, 'the write went back with its transaction');
    });

    test('the setting ends with its transaction: after the bypass the policy holds again', async () => {
        await bypass.runWithBypass(() => lifted.promoCodeRedemption.count());
        // Every connection of the pool has run a lifted statement by now; none
        // of them may still carry the setting.
        const counts = await Promise.all(
            Array.from({ length: 8 }, () => lifted.promoCodeRedemption.count()),
        );
        assert.deepEqual(new Set(counts), new Set([0]));
    });

    test('entering the bypass inside a transaction opened outside it is refused, and nothing is written', async () => {
        await assert.rejects(
            () =>
                runner.run((tx) =>
                    bypass.runWithBypass(() =>
                        tx.promoCodeRedemption.updateMany({ data: { status: 'ACTIVE' } }),
                    ),
                ),
            /inside a transaction opened outside it/,
        );
        const active = await bypass.runWithBypass(() =>
            lifted.promoCodeRedemption.count({ where: { status: 'ACTIVE' } }),
        );
        assert.equal(active, 0);
    });
});
