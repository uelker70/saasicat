// What the Prisma adapter asks the client for an invoice's document — where
// it stands, the archive that keeps it, and the check of the archive's
// triggers.
//
// The database semantics — a rendering recorded once, one claim of the mail at
// a time, a file stored once — are the contract's, and run against PostgreSQL
// in tests/integration/. What this holds is the translation: each guarded write
// is one conditional statement on the guard the port names, and each answer is
// read back as the port says.

// @requirement SC-COMP-010 — An integrator's own data access translates; it does not decide

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    INVOICE_ARCHIVE_TRIGGERS,
    INVOICE_ERROR_CODES,
    isPersistenceRefusal,
} from '@saasicat/core';

import { PrismaInvoiceArchive, PrismaSubscriptionInvoiceRepository } from '../dist/index.js';

const CHECKSUM = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const AT = new Date('2026-02-01T05:30:00.000Z');
const STALE_BEFORE = new Date('2026-02-01T05:15:00.000Z');

const RENDERING = {
    checksum: CHECKSUM,
    mediaType: 'application/pdf',
    fileName: 'AHP-2026-000001.pdf',
    size: 2048,
    renderedAt: AT,
};
const ROW = {
    invoiceId: 'invoice-1',
    ...RENDERING,
    archivedAt: null,
    deliveryClaimedAt: null,
    deliveredAt: null,
    deliveredTo: null,
};

/**
 * A client whose calls are recorded: `written` is what `createManyAndReturn`
 * gives back, `found` what `findUnique` does, `changed` how many rows an
 * `updateMany` reports, `rows` what `$queryRaw` and `findMany` answer.
 */
function fakeClient({ written = [], found = null, changed = 1, rows = [] } = {}) {
    const calls = [];
    const record =
        (name, answer) =>
        async (...args) => {
            calls.push([name, ...args]);
            return answer;
        };
    const delegate = (prefix) => ({
        createManyAndReturn: record(`${prefix}.createManyAndReturn`, written),
        findUnique: record(`${prefix}.findUnique`, found),
        findMany: record(`${prefix}.findMany`, rows),
        updateMany: record(`${prefix}.updateMany`, { count: changed }),
    });
    return {
        calls,
        subscriptionInvoice: delegate('invoice'),
        subscriptionInvoiceDocument: delegate('document'),
        subscriptionInvoiceArchive: delegate('archive'),
        $queryRaw: record('$queryRaw', rows),
    };
}

const only = (client, name) => {
    const found = client.calls.filter(([called]) => called === name);
    assert.equal(found.length, 1, `${name} was asked ${found.length} times`);
    return found[0][1];
};

describe('where an invoice’s document stands, as the Prisma adapter writes it', () => {
    test('a rendering is written conflict-free on the invoice and answered as written', async () => {
        const client = fakeClient({ written: [ROW] });

        const record = await new PrismaSubscriptionInvoiceRepository(client).recordRendering(
            'invoice-1',
            RENDERING,
        );

        assert.deepEqual(only(client, 'document.createManyAndReturn'), {
            data: [{ invoiceId: 'invoice-1', ...RENDERING }],
            skipDuplicates: true,
        });
        assert.equal(record.checksum, CHECKSUM);
    });

    test('a rendering recorded before is answered where its checksum is this one, and refused where it is another', async () => {
        const same = fakeClient({ found: ROW });
        const other = fakeClient({ found: { ...ROW, checksum: OTHER } });

        const record = await new PrismaSubscriptionInvoiceRepository(same).recordRendering(
            'invoice-1',
            RENDERING,
        );
        assert.deepEqual(only(same, 'document.findUnique'), { where: { invoiceId: 'invoice-1' } });
        assert.equal(record.checksum, CHECKSUM);
        await assert.rejects(
            new PrismaSubscriptionInvoiceRepository(other).recordRendering('invoice-1', RENDERING),
            (error) =>
                isPersistenceRefusal(error) &&
                error.code === INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_CHANGED,
        );
    });

    test('a rendering neither written nor found is said, rather than answered as nothing', async () => {
        await assert.rejects(
            new PrismaSubscriptionInvoiceRepository(fakeClient()).recordRendering(
                'invoice-1',
                RENDERING,
            ),
            /neither written nor found/,
        );
    });

    test('a rendering is replaced only in place of the checksum read, while nothing is archived', async () => {
        const client = fakeClient({ found: { ...ROW, checksum: OTHER } });
        const repository = new PrismaSubscriptionInvoiceRepository(client);

        const record = await repository.replaceRendering(
            'invoice-1',
            { ...RENDERING, checksum: OTHER },
            CHECKSUM,
        );

        assert.deepEqual(only(client, 'document.updateMany'), {
            where: { invoiceId: 'invoice-1', checksum: CHECKSUM, archivedAt: null },
            data: { ...RENDERING, checksum: OTHER },
        });
        assert.equal(record.checksum, OTHER);
        assert.equal(
            await new PrismaSubscriptionInvoiceRepository(
                fakeClient({ changed: 0 }),
            ).replaceRendering('invoice-1', RENDERING, OTHER),
            null,
        );
    });

    test('the archive’s confirmation is written only for the recorded checksum, once', async () => {
        const client = fakeClient();

        assert.equal(
            await new PrismaSubscriptionInvoiceRepository(client).markArchived(
                'invoice-1',
                AT,
                CHECKSUM,
            ),
            true,
        );
        assert.deepEqual(only(client, 'document.updateMany'), {
            where: { invoiceId: 'invoice-1', checksum: CHECKSUM, archivedAt: null },
            data: { archivedAt: AT },
        });
    });

    test('the mail is claimed, recorded and let go each by one write on the claim it names', async () => {
        const claim = fakeClient();
        const deliver = fakeClient();
        const release = fakeClient();

        await new PrismaSubscriptionInvoiceRepository(claim).claimDelivery(
            'invoice-1',
            AT,
            STALE_BEFORE,
        );
        await new PrismaSubscriptionInvoiceRepository(deliver).markDelivered('invoice-1', {
            claimedAt: AT,
            at: AT,
            to: 'billing@example.com',
        });
        await new PrismaSubscriptionInvoiceRepository(release).releaseDelivery('invoice-1', AT);

        assert.deepEqual(only(claim, 'document.updateMany'), {
            where: {
                invoiceId: 'invoice-1',
                archivedAt: { not: null },
                deliveredAt: null,
                OR: [{ deliveryClaimedAt: null }, { deliveryClaimedAt: { lt: STALE_BEFORE } }],
            },
            data: { deliveryClaimedAt: AT },
        });
        assert.deepEqual(only(deliver, 'document.updateMany'), {
            where: {
                invoiceId: 'invoice-1',
                archivedAt: { not: null },
                deliveredAt: null,
                deliveryClaimedAt: AT,
            },
            data: { deliveredAt: AT, deliveredTo: 'billing@example.com' },
        });
        assert.deepEqual(only(release, 'document.updateMany'), {
            where: { invoiceId: 'invoice-1', deliveredAt: null, deliveryClaimedAt: AT },
            data: { deliveryClaimedAt: null },
        });
    });

    test('the waiting lists are read page by page, after the id given', async () => {
        const client = fakeClient({ rows: [] });
        const repository = new PrismaSubscriptionInvoiceRepository(client);

        await repository.listAwaitingDocument({ limit: 10, after: 'invoice-1' });
        await repository.listAwaitingDelivery({ limit: 10 });

        assert.deepEqual(only(client, 'invoice.findMany'), {
            where: {
                id: { gt: 'invoice-1' },
                OR: [{ document: { is: null } }, { document: { is: { archivedAt: null } } }],
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: 10,
        });
        assert.deepEqual(only(client, 'document.findMany'), {
            where: { archivedAt: { not: null }, deliveredAt: null },
            select: { invoiceId: true },
            orderBy: { invoiceId: 'asc' },
            take: 10,
        });
    });

    test('the invoices whose document is archived are read out of those asked for, and none asked for asks nothing', async () => {
        const client = fakeClient({ rows: [{ invoiceId: 'invoice-1' }] });
        const repository = new PrismaSubscriptionInvoiceRepository(client);

        assert.deepEqual(await repository.listArchivedDocuments(['invoice-1', 'invoice-2']), [
            'invoice-1',
        ]);
        assert.deepEqual(only(client, 'document.findMany'), {
            where: { invoiceId: { in: ['invoice-1', 'invoice-2'] }, archivedAt: { not: null } },
            select: { invoiceId: true },
            orderBy: { invoiceId: 'asc' },
        });
        const idle = fakeClient();
        assert.deepEqual(
            await new PrismaSubscriptionInvoiceRepository(idle).listArchivedDocuments([]),
            [],
        );
        assert.equal(idle.calls.length, 0);
    });

    test('where it stands is read by the invoice, and nothing where none is recorded', async () => {
        const repository = new PrismaSubscriptionInvoiceRepository(fakeClient());

        assert.equal(await repository.findDocument('invoice-1'), null);
    });
});

describe('the Prisma archive', () => {
    const FILE = {
        invoiceId: 'invoice-1',
        checksum: CHECKSUM,
        mediaType: 'application/pdf',
        fileName: 'AHP-2026-000001.pdf',
        content: new Uint8Array([1, 2, 3]),
        archivedAt: AT,
    };

    test('stores a file conflict-free, and asks for nothing more where it was written', async () => {
        const client = fakeClient({ written: [{ invoiceId: 'invoice-1' }] });

        await new PrismaInvoiceArchive(client).store(FILE);

        assert.deepEqual(only(client, 'archive.createManyAndReturn'), {
            data: [FILE],
            skipDuplicates: true,
            select: { invoiceId: true },
        });
        assert.equal(client.calls.length, 1);
    });

    test('a file stored before is the same write where its checksum is this one, and refused where it is another', async () => {
        await new PrismaInvoiceArchive(fakeClient({ found: { checksum: CHECKSUM } })).store(FILE);

        await assert.rejects(
            new PrismaInvoiceArchive(fakeClient({ found: { checksum: OTHER } })).store(FILE),
            (error) =>
                isPersistenceRefusal(error) &&
                error.code === INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_CHANGED,
        );
    });

    test('reads a file back as bytes of its own, and nothing where none is kept', async () => {
        const kept = await new PrismaInvoiceArchive(fakeClient({ found: FILE })).read('invoice-1');

        assert.deepEqual(kept.content, new Uint8Array([1, 2, 3]));
        assert.notEqual(kept.content, FILE.content);
        assert.equal(await new PrismaInvoiceArchive(fakeClient()).read('invoice-1'), null);
    });

    test('says what would let a kept file change, from the enabled triggers of its table', async () => {
        const guarded = fakeClient({ rows: INVOICE_ARCHIVE_TRIGGERS.map((name) => ({ name })) });
        const bare = fakeClient({ rows: [] });

        assert.equal(await new PrismaInvoiceArchive(guarded).protectionProblem(), null);
        const problem = await new PrismaInvoiceArchive(bare).protectionProblem();
        assert.ok(problem.includes(`lacks ${INVOICE_ARCHIVE_TRIGGERS.join(' and ')},`), problem);
        const [, query] = guarded.calls[0];
        assert.ok(query.join('?').includes("tgenabled IN ('O', 'A')"), query.join('?'));
    });
});
