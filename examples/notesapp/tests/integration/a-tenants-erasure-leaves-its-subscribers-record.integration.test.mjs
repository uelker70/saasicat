// The notes app's eraser against PostgreSQL, on the notes app's own schema:
// deleting a tenant's row takes, by its foreign keys, the tenant's users,
// notes and subscription along — and nothing of the subscriber's commercial
// record, nor the rows the platform keeps of the tenant beyond its deletion.
// Only a database shows this. The record names the tenant by value, and what a
// deletion takes is decided by the `ON DELETE` of every foreign key the push
// creates, which no stand-in for the client knows.
//
// The database is built as the notes app's entrypoint builds it: the schema
// pushed, then the platform's shipped constraints. The shipped migrations are
// left out: none of them names the tenants' table, so none adds a way for a
// deletion there to reach further.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database: it
// drops the `public` schema. Run after `pnpm --filter notesapp-example build`.

// @requirement SC-COMP-014 — The example application is kept in step with the platform

import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaTenantDeletionRepository } from '@saasicat/adapter-prisma';

import { NotesDataEraser } from '../../dist/saas/notes-data-eraser.js';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const NOTESAPP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONSTRAINTS = join(
    dirname(require.resolve('@saasicat/spec/package.json')),
    'sql',
    'constraints.postgres.sql',
);

const databaseUrl = process.env.SAASICAT_TEST_DATABASE_URL;
if (!databaseUrl) {
    throw new Error(
        'SAASICAT_TEST_DATABASE_URL is required for this test — point it at a disposable ' +
            'PostgreSQL database. It drops the `public` schema.',
    );
}

/** Runs the notes app's Prisma CLI against the test database. */
function prismaCli(args) {
    execFileSync('pnpm', ['exec', 'prisma', ...args, '--schema', 'prisma/schema.prisma'], {
        cwd: NOTESAPP_ROOT,
        env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
        stdio: 'pipe',
    });
}

const AT = new Date('2026-10-01T09:00:00.000Z');
const ERASED = 'tenant-erased';
const OTHER = 'tenant-other';

/** A tenant with a user, notes, a subscription and an audit entry of its own. */
async function aTenant(prisma, id, planVersionId) {
    await prisma.tenant.create({
        data: {
            id,
            slug: id,
            name: id,
            users: { create: [{ id: `user-${id}`, email: `admin@${id}.example` }] },
            notes: { create: [{ title: 'First' }, { title: 'Second' }] },
            subscription: {
                create: { id: `sub-${id}`, plan: 'STARTER', status: 'CANCELED', planVersionId },
            },
        },
    });
    await prisma.auditLog.create({
        data: {
            tenantId: id,
            userId: `user-${id}`,
            entity: 'Note',
            entityId: 'note',
            action: 'NOTE_CREATE',
            actorTag: `web:admin@${id}.example:session`,
        },
    });
}

/**
 * The subscriber of `ERASED` and its commercial record: a contract with its
 * line, a charge on it, the invoice issued from the charge, the attempt that
 * collected it, the payment it brought and the credit it left beyond the
 * invoice. Answers the subscriber's id.
 */
async function aCommercialRecord(prisma) {
    const subscriber = await prisma.subscriber.create({
        data: { legalName: 'Erased GmbH', tenants: { create: [{ tenantId: ERASED }] } },
    });
    const owned = { subscriberId: subscriber.id, tenantId: ERASED };
    const subscriptionId = `sub-${ERASED}`;
    const contract = await prisma.subscriptionContract.create({
        data: {
            ...owned,
            subscriberSnapshot: { legalName: 'Erased GmbH' },
            cancellationNoticeDays: 14,
            agreedAt: AT,
            effectiveFrom: AT,
            priceSnapshot: { currency: 'EUR', totalNet: 10 },
            lineItems: {
                create: [
                    {
                        kind: 'plan',
                        sourceKey: 'STARTER',
                        titleSnapshot: 'Starter',
                        priceNet: '10.00',
                        priceGross: '11.90',
                        billingCycle: 'monthly',
                        currency: 'EUR',
                        taxRate: '19.00',
                        taxAmount: '1.90',
                    },
                ],
            },
        },
        include: { lineItems: true },
    });
    await prisma.subscriberLedgerEntry.create({
        data: {
            ...owned,
            subscriptionId,
            contractId: contract.id,
            contractLineItemId: contract.lineItems[0].id,
            origin: 'renewal',
            source: 'plan',
            sourceRef: subscriptionId,
            periodStart: AT,
            periodEnd: new Date('2026-11-01T00:00:00.000Z'),
            currency: 'EUR',
            amountNet: '10.00',
            bookedAt: AT,
        },
    });
    const invoiceId = 'invoice-erased';
    await prisma.subscriptionInvoice.create({
        data: {
            ...owned,
            id: invoiceId,
            chainId: invoiceId,
            number: 'RE-2026-00001',
            numberPrefix: 'RE',
            numberYear: 2026,
            numberSequence: 1,
            subscriptionId,
            contractId: contract.id,
            issuedAt: AT,
            issueDate: AT,
            dueDate: AT,
            servicePeriodFrom: AT,
            servicePeriodUntil: AT,
            currency: 'EUR',
            issuerParty: { legalName: 'Notes Ltd' },
            subscriberParty: { legalName: 'Erased GmbH' },
            taxTreatment: { kind: 'standard', rate: 19 },
            taxes: [],
            totalNet: '10.00',
            totalTax: '1.90',
            totalGross: '11.90',
        },
    });
    const collection = await prisma.subscriptionInvoiceCollection.create({
        data: {
            invoiceId,
            attempt: 1,
            attemptKey: `${invoiceId}:1`,
            gatewayAccount: 'dev',
            paymentMethodId: 'method',
            paymentMethodType: 'card',
            customerRef: 'cus_erased',
            paymentMethodRef: 'pm_erased',
            invoiceNumber: 'RE-2026-00001',
            amount: '11.90',
            currency: 'EUR',
            status: 'SUCCEEDED',
        },
    });
    const payment = await prisma.subscriberPayment.create({
        data: {
            ...owned,
            invoiceId,
            collectionId: collection.id,
            gatewayAccount: 'dev',
            provider: 'dev',
            gatewayRef: 'pi_erased',
            amount: '20.00',
            currency: 'EUR',
        },
    });
    await prisma.subscriberCredit.create({
        data: { ...owned, amount: '8.10', currency: 'EUR', originPaymentId: payment.id },
    });
    return subscriber.id;
}

/**
 * What the platform keeps of `ERASED` beyond its deletion — the reason it is
 * held back, its end, the announcement of its day, a download of its export
 * and a notice — which the platform has name roles once the deletion closes.
 */
async function whatThePlatformKeeps(prisma) {
    const ofTheSubscription = { tenantId: ERASED, subscriptionId: `sub-${ERASED}` };
    const deletesOn = new Date('2026-12-01T00:00:00.000Z');
    await prisma.tenantAccessHold.create({
        data: { tenantId: ERASED, kind: 'ended', since: AT, recordedBy: 'job:platform:ends' },
    });
    await prisma.subscriptionEnd.create({
        data: { ...ofTheSubscription, endsAt: AT, deletesOn, recordedAt: AT, recordedBy: 'web:x' },
    });
    await prisma.subscriptionEndAnnouncement.create({
        data: {
            ...ofTheSubscription,
            endsAt: AT,
            readOnlyDays: 60,
            deletesOn,
            announcedAt: AT,
            announcedBy: 'web:x',
        },
    });
    await prisma.tenantExportDownload.create({
        data: {
            ...ofTheSubscription,
            downloadedAt: AT,
            downloadedBy: 'web:x',
            downloadedByUserId: `user-${ERASED}`,
            size: 1024n,
        },
    });
    await prisma.subscriptionNotice.create({
        data: { ...ofTheSubscription, kind: 'deletion-reminder', subject: 'end:10', content: {} },
    });
}

/** How many rows of each table the platform keeps beyond a deletion name `tenantId`. */
async function keptOf(prisma, tenantId) {
    const where = { where: { tenantId } };
    return {
        holds: await prisma.tenantAccessHold.count(where),
        ends: await prisma.subscriptionEnd.count(where),
        announcements: await prisma.subscriptionEndAnnouncement.count(where),
        downloads: await prisma.tenantExportDownload.count(where),
        notices: await prisma.subscriptionNotice.count(where),
        subscriberLinks: await prisma.subscriberTenant.count(where),
    };
}

/** How many rows of the tenant's own the notes app has for `tenantId`. */
async function ownOf(prisma, tenantId) {
    const where = { where: { tenantId } };
    return {
        tenant: await prisma.tenant.count({ where: { id: tenantId } }),
        users: await prisma.user.count(where),
        notes: await prisma.note.count(where),
        subscriptions: await prisma.subscription.count(where),
        auditEntries: await prisma.auditLog.count(where),
    };
}

describe("the notes app's eraser on PostgreSQL", () => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const eraser = new NotesDataEraser(prisma);
    const records = new PrismaTenantDeletionRepository(prisma);
    let subscriberId;

    before(async () => {
        await prisma.$executeRaw`DROP SCHEMA IF EXISTS public CASCADE`;
        await prisma.$executeRaw`CREATE SCHEMA public`;
        prismaCli(['db', 'push', '--skip-generate']);
        prismaCli(['db', 'execute', '--file', CONSTRAINTS]);

        const { id: planVersionId } = await prisma.planVersion.create({
            data: {
                planId: 'STARTER',
                version: 1,
                features: [],
                quotas: {},
                monthlyNet: '10.00',
                yearlyNet: '100.00',
                changeNote: 'First',
            },
        });
        await aTenant(prisma, ERASED, planVersionId);
        await aTenant(prisma, OTHER, planVersionId);
        subscriberId = await aCommercialRecord(prisma);
        await whatThePlatformKeeps(prisma);
        // An entry about the subscriber's record names no tenant, and is not
        // the tenant's to take.
        await prisma.auditLog.create({
            data: {
                entity: 'SubscriptionInvoice',
                entityId: 'invoice-erased',
                action: 'INVOICE_ISSUE',
            },
        });
    });

    after(() => prisma.$disconnect());

    // @requirement SC-PRIV-011 — Contracts, invoices and payments outlive the tenant they were for
    // @requirement SC-PRIV-012 — A record kept for tax purposes is not deleted automatically
    test("takes the tenant's own rows and leaves the subscriber's commercial record whole, and what the platform keeps of the tenant", async () => {
        const commercialBefore = await records.countCommercialRecord(subscriberId);
        assert.deepEqual(commercialBefore, {
            subscriber: 1,
            contracts: 1,
            charges: 1,
            invoices: 1,
            payments: 1,
            credits: 1,
        });
        const kept = await keptOf(prisma, ERASED);
        assert.deepEqual(await eraser.count(ERASED), [
            { category: 'notes', count: 2 },
            { category: 'users', count: 1 },
            { category: 'audit-entries', count: 1 },
        ]);

        await eraser.erase(ERASED);

        assert.deepEqual(await ownOf(prisma, ERASED), {
            tenant: 0,
            users: 0,
            notes: 0,
            subscriptions: 0,
            auditEntries: 0,
        });
        assert.deepEqual(await records.countCommercialRecord(subscriberId), commercialBefore);
        assert.equal(await prisma.contractLineItem.count(), 1);
        assert.deepEqual(await keptOf(prisma, ERASED), kept);
        assert.equal(await prisma.auditLog.count({ where: { tenantId: null } }), 1);
        assert.deepEqual(await ownOf(prisma, OTHER), {
            tenant: 1,
            users: 1,
            notes: 2,
            subscriptions: 1,
            auditEntries: 1,
        });
    });

    // @requirement SC-PRIV-018 — A tenant's deletion can safely run again, and is done only once every store confirms
    test('erasing the tenant again is done, and changes nothing', async () => {
        const commercial = await records.countCommercialRecord(subscriberId);

        await eraser.erase(ERASED);

        assert.equal(await prisma.tenant.count({ where: { id: ERASED } }), 0);
        assert.deepEqual(await records.countCommercialRecord(subscriberId), commercial);
        assert.equal((await ownOf(prisma, OTHER)).tenant, 1);
    });
});
