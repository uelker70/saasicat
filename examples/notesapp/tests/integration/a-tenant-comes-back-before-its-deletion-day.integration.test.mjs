// A tenant of the notes app whose subscription ended comes back before its
// deletion day, against PostgreSQL, through the platform as the notes app
// composes it: its trial runs out unbought and is ended, it takes out a new
// subscription, and when that one ends too, the end gets a deletion day of its
// own. Only a database shows the last step: a subscription keeps at most one
// end that has not been lifted, which a partial unique index of the shipped
// constraints holds, and no stand-in for the client knows that index.
//
// The database is built as the notes app's entrypoint builds a new one — the
// schema pushed, then the shipped migrations, then the constraints; the pass of
// the migrations before the push finds no table on an empty database — and
// filled by the notes app's own seed, which activates its subscriptions through
// the platform. The platform is then started from the same options the seed
// starts it with (`SeedModule`): without HTTP and without the scheduler, so the
// test decides each moment itself.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database: it
// drops the `public` schema. Run after `pnpm --filter notesapp-example build`.

// @requirement SC-COMP-014 — The example application is kept in step with the platform

import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const NOTESAPP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHIPPED_SQL = join(dirname(require.resolve('@saasicat/spec/package.json')), 'sql');
/** The two files of the directory that are no migration, as the entrypoint skips them. */
const NOT_A_MIGRATION = new Set(['reference-schema.postgres.sql', 'constraints.postgres.sql']);

const databaseUrl = process.env.SAASICAT_TEST_DATABASE_URL;
if (!databaseUrl) {
    throw new Error(
        'SAASICAT_TEST_DATABASE_URL is required for this test — point it at a disposable ' +
            'PostgreSQL database. It drops the `public` schema.',
    );
}

/** What the notes app's start reads from its environment, here pointed at the test database. */
const ENVIRONMENT = {
    DATABASE_URL: databaseUrl,
    SECRET_SEALER_KEY: 'ZGVtby1rZXktZm9yLXRoZS1ub3Rlc2FwcC1zdGFjayE=',
    SAASICAT_INSTALLATION: 'notesapp-integration-test',
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
};

/** Runs `command` with `args` in the notes app's directory, against the test database. */
function inTheNotesApp(command, args) {
    execFileSync(command, args, {
        cwd: NOTESAPP_ROOT,
        env: { ...process.env, ...ENVIRONMENT },
        stdio: 'pipe',
    });
}

/** Applies a shipped `.sql` file as the entrypoint does. */
function applySql(file) {
    inTheNotesApp('pnpm', [
        'exec',
        'prisma',
        'db',
        'execute',
        '--file',
        join(SHIPPED_SQL, file),
        '--schema',
        'prisma/schema.prisma',
    ]);
}

function applyShippedMigrations() {
    for (const file of readdirSync(SHIPPED_SQL).sort()) {
        if (file.endsWith('.sql') && !NOT_A_MIGRATION.has(file)) applySql(file);
    }
}

/** The day a date column holds: Prisma hands it back as midnight UTC. */
const dayOf = (column) => column.toISOString().slice(0, 10);

const TENANT = 'tenant-b';
const DAY_MS = 24 * 60 * 60 * 1000;

describe('a tenant of the notes app comes back before its deletion day, on PostgreSQL', () => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const saved = {};
    let app;
    let platform;

    before(async () => {
        for (const [key, value] of Object.entries(ENVIRONMENT)) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
        await prisma.$executeRaw`DROP SCHEMA IF EXISTS public CASCADE`;
        await prisma.$executeRaw`CREATE SCHEMA public`;
        inTheNotesApp('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate']);
        applyShippedMigrations();
        applySql('constraints.postgres.sql');
        inTheNotesApp('node', ['dist/seed.js']);

        // The app is compiled to CommonJS, so its module and the platform's
        // services are the classes its `require` loads; the ES module of the
        // same entry is another class.
        const { NestFactory } = require('@nestjs/core');
        const { SeedModule } = require('../../dist/seed.module.js');
        const billing = require('@saasicat/nest/billing');
        const previousDirectory = process.cwd();
        // The options read `config/saas.yaml` relative to the directory the
        // application starts in.
        process.chdir(NOTESAPP_ROOT);
        try {
            app = await NestFactory.createApplicationContext(SeedModule, {
                logger: ['error'],
            });
        } finally {
            process.chdir(previousDirectory);
        }
        const get = (type) => app.get(type, { strict: false });
        platform = {
            trialEnds: get(billing.TrialEndService),
            returns: get(billing.SubscriptionReturnService),
            cancellations: get(billing.SubscriptionCancellationService),
            ends: get(billing.SubscriptionEndService),
        };
    });

    after(async () => {
        await app?.close();
        await prisma.$disconnect();
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    // @requirement SC-CANC-034 — A tenant whose subscription ended can come back until its deletion day
    test('its trial ended, it comes back on STARTER, and the end of the new subscription has a day of its own', async () => {
        const ranOut = new Date();
        const starter = await prisma.planVersion.findUniqueOrThrow({
            where: { planId_version: { planId: 'STARTER', version: 1 } },
        });
        const { id: subscriptionId } = await prisma.subscription.create({
            data: {
                tenantId: TENANT,
                plan: 'STARTER',
                billingCycle: 'MONTHLY',
                status: 'TRIAL',
                planVersionId: starter.id,
                startedAt: new Date(ranOut.getTime() - 14 * DAY_MS),
                trialEndsAt: new Date(ranOut.getTime() - DAY_MS),
            },
        });
        const { subscriberId } = await prisma.subscriberTenant.findFirstOrThrow({
            where: { tenantId: TENANT },
        });
        const administrator = await prisma.user.findFirstOrThrow({ where: { tenantId: TENANT } });
        const actor = {
            userId: administrator.id,
            email: administrator.email,
            source: 'web',
            context: 'session',
        };

        // The notes app's run decides that the trial does not convert.
        const first = await platform.trialEnds.endRanOut(TENANT, undefined, ranOut);

        // Its administrator comes back the next minute, on the terms shown.
        const cameBack = new Date(ranOut.getTime() + 60_000);
        const choice = { plan: 'STARTER', billingCycle: 'MONTHLY' };
        const shownFirst = await platform.returns.preview(TENANT, choice, cameBack);
        assert.equal(shownFirst.refusal, null);
        assert.equal(shownFirst.deletesOn, first.deletesOn);
        assert.equal(shownFirst.paymentMethodRequired, true, 'the notes app wires a gateway');
        // The development gateway confirms a card on the spot: this is the row
        // its confirmation leaves.
        await prisma.subscriberPaymentMethod.create({
            data: {
                subscriberId,
                gatewayAccount: 'dev',
                provider: 'dev',
                customerRef: 'cus_tenant_b',
                paymentMethodRef: 'pm_tenant_b',
                type: 'card',
                brand: 'visa',
                last4: '4242',
                expiryMonth: 12,
                expiryYear: 2030,
                confirmedAt: ranOut,
            },
        });
        const shown = await platform.returns.preview(TENANT, choice, cameBack);
        assert.equal(shown.paymentMethodRequired, false);
        assert.deepEqual(shown.blockers, []);
        assert.equal(shown.planVersionId, starter.id);

        await platform.returns.takeOut(
            TENANT,
            { ...choice, planVersionId: shown.planVersionId, expectedDeletesOn: shown.deletesOn },
            actor,
            cameBack,
        );

        const running = await prisma.subscription.findUniqueOrThrow({
            where: { id: subscriptionId },
        });
        assert.equal(running.status, 'ACTIVE');
        assert.equal(running.canceledEffectiveAt, null);
        assert.equal(
            await prisma.tenantAccessHold.count({ where: { tenantId: TENANT, liftedAt: null } }),
            0,
            'the tenant is open again',
        );
        assert.equal(
            await prisma.subscriptionContract.count({
                where: { tenantId: TENANT, effectiveFrom: cameBack },
            }),
            1,
        );

        // A day later it cancels again; the cancellation lands at the end of
        // the period, and the run after it records the second end.
        const declared = await platform.cancellations.declare(
            TENANT,
            {},
            actor,
            new Date(cameBack.getTime() + DAY_MS),
        );
        assert.ok(declared.canceledEffectiveAt && declared.deletion);
        await platform.ends.recordEnded(new Date(declared.canceledEffectiveAt.getTime() + 60_000));

        const ends = await prisma.subscriptionEnd.findMany({
            where: { subscriptionId },
            orderBy: { endsAt: 'asc' },
        });
        assert.deepEqual(
            ends.map((end) => ({
                deletesOn: dayOf(end.deletesOn),
                lifted: end.liftedAt?.toISOString() ?? null,
            })),
            [
                { deletesOn: first.deletesOn, lifted: cameBack.toISOString() },
                { deletesOn: declared.deletion.deletesOn, lifted: null },
            ],
        );
        assert.ok(declared.deletion.deletesOn > first.deletesOn, 'a day of its own, a later one');
        const reasons = await prisma.tenantAccessHold.findMany({
            where: { tenantId: TENANT, kind: 'ended' },
            orderBy: { since: 'asc' },
        });
        assert.deepEqual(
            reasons.map((reason) => reason.liftedAt?.toISOString() ?? null),
            [cameBack.toISOString(), null],
            'read-only again, for the second end alone',
        );
    });
});
