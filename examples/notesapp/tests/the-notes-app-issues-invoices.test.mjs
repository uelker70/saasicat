// The notes app issues invoices: what it binds for them is its own — the
// source a contract is frozen from, and the mail an invoice leaves by — and the
// platform starts with them. DB-free — the Prisma client and the repositories
// are stood in for by ones that answer what they are asked for, and the start
// is compiled without connecting.

// @requirement SC-COMP-014 — The example application is kept in step with the platform

import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Logger } from '@nestjs/common';

import { NotesContractFreezeSource } from '../dist/saas/notes-contract-freeze-source.js';
import { NotesInvoiceMailLog } from '../dist/saas/notes-invoice-mail-log.js';

const STAMP = new Date('2026-10-01T09:00:00.000Z');

const PRO_V1 = {
    id: 'pv-pro-1',
    version: 1,
    baseVersionId: null,
    features: ['NOTES', 'NOTES_EXPORT'],
    quotas: { notesMax: 1000 },
    monthlyNet: '29',
    yearlyNet: '290',
    marketed: true,
    publishedAt: STAMP,
    supersededAt: null,
    publishedChanges: null,
    changeNote: 'Initial release (seed).',
    nonRegressive: true,
    validFrom: STAMP,
    validUntil: null,
    endsAt: null,
    createdByUserId: null,
    publishedByUserId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
};

/** EXPORT_PRO v1 as the bundle repository hands it back, with a price for PRO of its own. */
const EXPORT_PRO_V1 = {
    id: 'bv-export-1',
    bundleId: 'b-export',
    bundleKey: 'EXPORT_PRO',
    label: 'Export Pro',
    version: 1,
    baseVersionId: null,
    features: ['NOTES_EXPORT'],
    quotas: {},
    compatibility: { mode: 'all' },
    pricingOverrides: [{ planId: 'PRO', monthlyNet: '4' }],
    monthlyNet: '5',
    yearlyNet: '50',
    marketed: true,
    publishedAt: STAMP.toISOString(),
    supersededAt: null,
    publishedChanges: null,
    changeNote: 'Initial release (seed).',
    nonRegressive: true,
    validFrom: STAMP.toISOString(),
    validUntil: null,
    createdByUserId: null,
    publishedByUserId: null,
    createdAt: STAMP.toISOString(),
    updatedAt: STAMP.toISOString(),
};

/** A booking of `bundleVersionId` in `billingCycle`, `null` where it runs in its plan's. */
const booking = (id, bundleVersionId, billingCycle) => ({
    id,
    subscriptionId: 'sub-acme',
    bundleVersionId,
    startedAt: STAMP,
    minimumTermEndsAt: null,
    canceledAt: null,
    canceledEffectiveAt: null,
    billingCycle,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    pendingBundleVersionId: null,
    pendingVersionEffectiveAt: null,
    pendingAgreement: null,
    agreement: null,
    createdAt: STAMP,
    updatedAt: STAMP,
});

/** The source over a notes app whose only subscription is acme's, on PRO v1, holding `booked`. */
function sourceOver(booked) {
    const askedFor = { subscriptions: [], bookings: [] };
    const subscriptions = [{ id: 'sub-acme', tenantId: 'acme', plan: 'PRO', planVersion: PRO_V1 }];
    const prisma = {
        subscription: {
            findUnique: async ({ where }) => {
                askedFor.subscriptions.push(where.tenantId);
                return subscriptions.find((row) => row.tenantId === where.tenantId) ?? null;
            },
        },
    };
    const bookings = {
        listActiveBySubscription: async (subscriptionId) => {
            askedFor.bookings.push(subscriptionId);
            return booked.filter((row) => row.subscriptionId === subscriptionId);
        },
    };
    const bundles = {
        findVersionById: async (id) => (id === EXPORT_PRO_V1.id ? EXPORT_PRO_V1 : null),
    };
    return { source: new NotesContractFreezeSource(prisma, bookings, bundles), askedFor };
}

describe("the notes app's contract freeze source", () => {
    test('names the version the subscription is bound to, by its plan', async () => {
        const { source, askedFor } = sourceOver([]);

        const version = await source.findBoundPlanVersion('acme');

        assert.deepEqual(askedFor.subscriptions, ['acme']);
        assert.equal(version.id, 'pv-pro-1');
        assert.equal(version.planId, 'PRO');
        assert.equal(version.monthlyNet, '29');
        assert.deepEqual(version.features, ['NOTES', 'NOTES_EXPORT']);
    });

    test('names no version for a tenant without a subscription', async () => {
        const { source } = sourceOver([]);

        assert.equal(await source.findBoundPlanVersion('nobody'), null);
    });

    test('prices each active booking in its own rhythm, at the price its plan pays', async () => {
        const { source, askedFor } = sourceOver([
            booking('sb-monthly', EXPORT_PRO_V1.id, 'MONTHLY'),
            booking('sb-yearly', EXPORT_PRO_V1.id, 'YEARLY'),
            booking('sb-plan', EXPORT_PRO_V1.id, null),
        ]);

        const snapshot = await source.loadBookedBundles('acme', 'yearly');

        assert.deepEqual(askedFor.bookings, ['sub-acme']);
        assert.deepEqual(
            snapshot.lineItems.map((line) => [line.billingCycle, line.priceNet]),
            // PRO's own monthly price, the bundle's yearly price, and the
            // plan's rhythm for the booking that names none.
            [
                ['monthly', 4],
                ['yearly', 50],
                ['yearly', 50],
            ],
        );
        assert.deepEqual(snapshot.lineItems[0], {
            kind: 'bundle',
            sourceKey: 'EXPORT_PRO',
            sourceVersionId: 'bv-export-1',
            titleSnapshot: 'Export Pro',
            descriptionSnapshot: null,
            quantity: 1,
            unit: null,
            priceNet: 4,
            billingCycle: 'monthly',
            minimumTermUntil: null,
            featuresSnapshot: ['NOTES_EXPORT'],
            quotaEffectsSnapshot: {},
            metadata: null,
        });
        assert.deepEqual(snapshot.bundleVersionIds, ['bv-export-1', 'bv-export-1', 'bv-export-1']);
    });

    test('books nothing for a tenant without a subscription', async () => {
        const { source, askedFor } = sourceOver([booking('sb', EXPORT_PRO_V1.id, null)]);

        assert.deepEqual(await source.loadBookedBundles('nobody', 'monthly'), {
            lineItems: [],
            bundleVersionIds: [],
        });
        assert.deepEqual(askedFor.bookings, []);
    });

    test('refuses a booking whose version cannot be found, rather than leaving it out', async () => {
        const { source } = sourceOver([booking('sb-lost', 'bv-gone', null)]);

        await assert.rejects(source.loadBookedBundles('acme', 'monthly'), /sb-lost.*bv-gone/);
    });
});

const PDF = new TextEncoder().encode('%PDF-1.7 the confidential body of the file');
const ADDRESS = 'billing@acme.example';

/** The mail port with a log that keeps what is written to it. */
function mailLog() {
    const port = new NotesInvoiceMailLog();
    const logged = [];
    port.logger = new Logger('test');
    port.logger.log = (line) => logged.push(line);
    return { port, logged };
}

/** What no line of the log may carry: the file's content, or where it went. */
function assertCarriesNeitherContentNorAddress(line) {
    assert.doesNotMatch(line, /confidential/);
    assert.doesNotMatch(line, /%PDF/);
    assert.doesNotMatch(line, /acme\.example/);
}

describe("the notes app's invoice mail", () => {
    test('writes the invoice, its subscriber, its file and its size — not the file, not the address', async () => {
        const { port, logged } = mailLog();

        await port.deliver({
            invoice: { number: 'NOTES-2026-000001', subscriberId: 'sub-k1' },
            to: ADDRESS,
            document: {
                content: PDF,
                mediaType: 'application/pdf',
                fileName: 'NOTES-2026-000001.pdf',
            },
        });

        assert.equal(logged.length, 1);
        assert.match(logged[0], /NOTES-2026-000001\.pdf/);
        assert.match(logged[0], /sub-k1/);
        assert.ok(logged[0].includes(`${PDF.byteLength} bytes`), logged[0]);
        assertCarriesNeitherContentNorAddress(logged[0]);
    });

    test("writes a contract's confirmation with each file it attaches", async () => {
        const { port, logged } = mailLog();

        await port.deliverConfirmation({
            contract: { id: 'c1', subscriberId: 'sub-k1' },
            to: ADDRESS,
            documents: [
                { content: PDF, mediaType: 'application/pdf', fileName: 'confirmation-c1.pdf' },
                { content: PDF, mediaType: 'application/pdf', fileName: 'terms-2026-11.pdf' },
            ],
        });

        assert.equal(logged.length, 1);
        assert.match(logged[0], /c1/);
        assert.match(logged[0], /confirmation-c1\.pdf/);
        assert.match(logged[0], /terms-2026-11\.pdf/);
        assertCarriesNeitherContentNorAddress(logged[0]);
    });

    test('names a test invoice and a test confirmation as tests, and a live one as neither', async () => {
        const { port, logged } = mailLog();
        const document = { content: PDF, mediaType: 'application/pdf', fileName: 'doc.pdf' };

        for (const testOperation of [true, false]) {
            await port.deliver({
                invoice: { number: 'NOTES-2026-000001', subscriberId: 'sub-k1', testOperation },
                to: ADDRESS,
                document,
            });
            await port.deliverConfirmation({
                contract: { id: 'c1', subscriberId: 'sub-k1' },
                to: ADDRESS,
                testOperation,
                documents: [document],
            });
        }

        assert.equal(logged.length, 4);
        assert.match(logged[0], /^Test invoice NOTES-2026-000001 /);
        assert.match(logged[1], /^Test confirmation of contract c1 /);
        assert.match(logged[2], /^Invoice NOTES-2026-000001 /);
        assert.match(logged[3], /^Confirmation of contract c1 /);
    });

    test('writes a notice about collecting an invoice by its kind and invoice', async () => {
        const { port, logged } = mailLog();

        await port.tell({
            notice: {
                kind: 'collection-failed',
                invoiceNumber: 'NOTES-2026-000001',
                subscriberId: 'sub-k1',
            },
            to: ADDRESS,
        });

        assert.equal(logged.length, 1);
        assert.match(logged[0], /collection-failed/);
        assert.match(logged[0], /NOTES-2026-000001/);
        assertCarriesNeitherContentNorAddress(logged[0]);
    });
});

describe('the notes app with invoices on', () => {
    const environment = {
        SECRET_SEALER_KEY: 'ZGVtby1rZXktZm9yLXRoZS1ub3Rlc2FwcC1zdGFjayE=',
        SAASICAT_INSTALLATION: 'notesapp-test',
    };
    const saved = {};

    before(() => {
        for (const [key, value] of Object.entries(environment)) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
    });

    after(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    test('passes the start checks of invoicing and composes the invoice run', async () => {
        const { Test } = await import('@nestjs/testing');
        const { AppModule } = await import('../dist/app.module.js');
        // The app is compiled to CommonJS, so the service is the class its
        // `require` loads; the ES module of the same entry is another class.
        const { SubscriptionInvoiceService } = createRequire(import.meta.url)(
            '@saasicat/nest/billing',
        );

        // Compiling builds every provider — among them the check that the
        // file's `invoicing` block and the wiring go together — and connects
        // to nothing: the client connects when the application initialises.
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
        try {
            assert.ok(moduleRef.get(SubscriptionInvoiceService, { strict: false }));
        } finally {
            await moduleRef.close();
        }
    });
});
