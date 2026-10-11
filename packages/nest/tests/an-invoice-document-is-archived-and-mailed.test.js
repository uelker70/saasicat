// What becomes of an issued invoice: its document rendered from what it
// records, checked against the format its tax adapter requires, its checksum
// recorded and the file archived; then mailed to the subscriber's invoice email
// with the file attached, and handed out again only as it was archived.
//
// The in-memory store, archive and mail hold what the persistence contract
// holds both adapters to: one rendering per invoice, one file per invoice, and
// one run holding an invoice's mail at a time.

import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import 'reflect-metadata';
import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { INVOICE_ERROR_CODES } from '@saasicat/core';

import { AdminManifestService, SaaSiCatModule } from '../dist/platform/index.js';
import { SubscriptionInvoiceCron } from '../dist/billing/index.js';
import { aMailbox, aRenderer, anArchive, documentOf } from './helpers/invoice-documents.js';
import { anInvoicingInstallation, invoicingAdapter } from './helpers/invoice-run.js';
import { invoicingPlatform, wiredInvoices } from './helpers/invoicing-platform.js';
import { controllersIn, handlersOf } from './helpers/operator-routes.js';

/** When the archiving run reads the clock. */
const AT = new Date('2026-02-01T05:30:00.000Z');
const LATER = new Date('2026-02-01T05:45:00.000Z');
const INVOICE_EMAIL = 'rechnung@t1.example';
const JOB = { userId: null, email: 'platform', source: 'job', context: 'subscription-invoices' };

const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * An installation that issued one invoice, for February, to a subscriber of
 * `t1` with an invoice email unless `details` says otherwise.
 */
async function anIssuedInvoice(options = {}, details = {}) {
    const installation = anInvoicingInstallation(options);
    const subscriber = await installation.aSubscriber('t1', {
        invoiceEmail: INVOICE_EMAIL,
        ...details,
    });
    const contract = await installation.aContract(subscriber);
    installation.charge(contract, 'plan');
    await installation.run();
    const [invoice] = installation.store.invoices;
    return { ...installation, subscriber, invoice };
}

/** An issued invoice whose document is archived, waiting for the mail. */
async function anArchivedInvoice(options = {}, details = {}) {
    const installation = await anIssuedInvoice(options, details);
    assert.deepEqual(await installation.documents.archiveDue(AT), {
        archived: 1,
        held: 0,
        failed: 0,
    });
    return installation;
}

/** A file the archive holds for `invoice`, written before the test looks, its bytes `text`. */
const keptFile = (invoice, text) => ({
    ...documentOf(invoice),
    content: Buffer.from(text),
    invoiceId: invoice.id,
    checksum: sha256(Buffer.from(text)),
    archivedAt: AT,
});

/** The audit entries of `action`, as code and params. */
const entriesOf = (audits, action) =>
    audits
        .filter((entry) => entry.action === action)
        .map((entry) => [entry.changes.code, entry.changes.params]);

/** Rejects as `Kind`, carrying `code`. */
const refusedAs = (Kind, code) => (error) => {
    assert.ok(error instanceof Kind, String(error));
    assert.equal(error.getResponse().code, code);
    return true;
};

/** Leaves the log out of the output of a test that provokes it. */
function quietLog() {
    mock.method(Logger.prototype, 'warn', () => {});
    mock.method(Logger.prototype, 'error', () => {});
}

// @requirement SC-PRIC-042 — An invoice is issued in the format its tax adapter requires
// @requirement SC-AUD-019 — An archived invoice is checked against the checksum of the file it was issued as
describe('an issued invoice’s document', () => {
    test('is rendered from the invoice as issued, checked, its checksum recorded, and archived', async () => {
        const shown = [];
        const adapter = invoicingAdapter({
            documentGaps: (document, invoice) => {
                shown.push([document.fileName, invoice.id]);
                return [];
            },
        });
        const { documents, store, archive, renderer, invoice } = await anIssuedInvoice({
            adapter,
        });

        assert.deepEqual(await documents.archiveDue(AT), { archived: 1, held: 0, failed: 0 });

        const file = documentOf(invoice);
        const checksum = sha256(file.content);
        assert.deepEqual(renderer.rendered, [invoice.id]);
        assert.deepEqual(shown, [[`${invoice.number}.pdf`, invoice.id]]);
        assert.deepEqual(store.documents.get(invoice.id), {
            invoiceId: invoice.id,
            checksum,
            mediaType: 'application/pdf',
            fileName: `${invoice.number}.pdf`,
            size: file.content.byteLength,
            renderedAt: AT,
            archivedAt: AT,
            deliveryClaimedAt: null,
            deliveredAt: null,
            deliveredTo: null,
        });
        assert.deepEqual(archive.files.get(invoice.id), {
            ...file,
            invoiceId: invoice.id,
            checksum,
            archivedAt: AT,
        });
    });

    test('is archived once: the next run renders nothing again', async () => {
        const { documents, renderer } = await anArchivedInvoice();

        assert.deepEqual(await documents.archiveDue(LATER), { archived: 0, held: 0, failed: 0 });
        assert.equal(renderer.rendered.length, 1);
    });

    test('that the adapter refuses waits under its number, recorded nowhere, until the defect is fixed', async () => {
        quietLog();
        let missing = ['xml.buyer.name'];
        const { documents, store, archive, audits, invoice } = await anIssuedInvoice({
            adapter: invoicingAdapter({ documentGaps: () => missing }),
        });

        assert.deepEqual(await documents.archiveDue(AT), { archived: 0, held: 1, failed: 0 });
        assert.equal(store.documents.size, 0, 'no checksum is recorded for a file refused');
        assert.equal(archive.files.size, 0);
        assert.deepEqual(audits.at(-1), {
            actor: JOB,
            entity: 'SubscriptionInvoice',
            entityId: invoice.id,
            action: 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD',
            changes: {
                tenantId: 't1',
                subscriberId: invoice.subscriberId,
                number: invoice.number,
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_REFUSED,
                params: { adapter: 'test-tax', missing: ['xml.buyer.name'] },
            },
        });

        assert.deepEqual(await documents.archiveDue(LATER), { archived: 0, held: 1, failed: 0 });
        assert.equal(
            entriesOf(audits, 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD').length,
            1,
            'recorded in the audit log once, however many runs find it waiting',
        );

        missing = [];
        assert.deepEqual(await documents.archiveDue(LATER), { archived: 1, held: 0, failed: 0 });
        assert.equal(store.invoices.length, 1, 'and no second invoice was issued for it');
        assert.equal(store.invoices[0].number, invoice.number);
    });

    test('whose hold could not be written to the audit log is written there by the next run', async () => {
        quietLog();
        const { documents, audits } = await anIssuedInvoice({
            adapter: invoicingAdapter({ documentGaps: () => ['xml.taxes'] }),
            failingAuditWrites: 1,
        });

        await documents.archiveDue(AT);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD'), []);

        await documents.archiveDue(LATER);
        assert.equal(entriesOf(audits, 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD').length, 1);
    });

    test('rendered in another shape before anything was archived takes the place of the recorded one, both named in the audit log', async () => {
        quietLog();
        let version = 'first';
        const renderer = aRenderer({
            render: (invoice) => ({ ...documentOf(invoice), content: Buffer.from(version) }),
        });
        const archive = anArchive();
        archive.failingStores.push(new Error('the archive is unreachable'));
        const { documents, store, audits, invoice } = await anIssuedInvoice({
            renderer,
            archive,
        });
        await documents.archiveDue(AT);
        const first = store.documents.get(invoice.id).checksum;

        version = 'second';
        assert.deepEqual(await documents.archiveDue(LATER), { archived: 1, held: 0, failed: 0 });

        const second = sha256(Buffer.from('second'));
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_DOCUMENT_RERENDERED'), [
            [undefined, { recorded: first, rendered: second }],
        ]);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD'), []);
        assert.equal(store.documents.get(invoice.id).checksum, second);
        assert.equal(store.documents.get(invoice.id).renderedAt, LATER);
        assert.equal(archive.files.get(invoice.id).checksum, second);
        assert.equal(store.invoices.length, 1, 'under the same number');
    });

    test('rendered again is not put in place of the recorded one where the audit log cannot say so', async () => {
        quietLog();
        let version = 'first';
        const renderer = aRenderer({
            render: (invoice) => ({ ...documentOf(invoice), content: Buffer.from(version) }),
        });
        const archive = anArchive();
        archive.failingStores.push(new Error('the archive is unreachable'));
        const installation = await anIssuedInvoice({ renderer, archive });
        const { documents, store, invoice } = installation;
        await documents.archiveDue(AT);
        const first = store.documents.get(invoice.id).checksum;
        version = 'second';
        const log = installation.auditLog.log;
        installation.auditLog.log = async () => {
            installation.auditLog.log = log;
            throw new Error('the audit log is unreachable');
        };

        assert.deepEqual(await documents.archiveDue(LATER), { archived: 0, held: 0, failed: 1 });
        assert.equal(store.documents.get(invoice.id).checksum, first);
        assert.equal(archive.files.size, 0);

        assert.deepEqual(await documents.archiveDue(LATER), { archived: 1, held: 0, failed: 0 });
        assert.equal(store.documents.get(invoice.id).checksum, sha256(Buffer.from('second')));
    });

    test('the archive already keeps is the one it was issued as: the record follows it, and nothing is rendered', async () => {
        const archive = anArchive();
        const { documents, store, renderer, invoice } = await anIssuedInvoice({ archive });
        archive.files.set(invoice.id, keptFile(invoice, 'kept'));

        assert.deepEqual(await documents.archiveDue(LATER), { archived: 1, held: 0, failed: 0 });

        const state = store.documents.get(invoice.id);
        assert.deepEqual(
            [state.checksum, state.size, state.renderedAt, state.archivedAt],
            [sha256(Buffer.from('kept')), 4, AT, LATER],
        );
        assert.deepEqual(renderer.rendered, []);
    });

    test('the archive keeps in another shape than the one recorded is the one the record follows, both named in the audit log', async () => {
        quietLog();
        const archive = anArchive();
        archive.failingStores.push(new Error('the archive is unreachable'));
        const { documents, store, audits, invoice } = await anIssuedInvoice({ archive });
        await documents.archiveDue(AT);
        const recorded = store.documents.get(invoice.id).checksum;
        // Another run, rendering with the renderer before an update, stored its file meanwhile.
        archive.files.set(invoice.id, keptFile(invoice, 'kept'));

        assert.deepEqual(await documents.archiveDue(LATER), { archived: 1, held: 0, failed: 0 });

        const kept = sha256(Buffer.from('kept'));
        assert.equal(store.documents.get(invoice.id).checksum, kept);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_DOCUMENT_RERENDERED'), [
            [undefined, { recorded, rendered: kept }],
        ]);
    });

    test('the archive keeps and the adapter refuses is held, and the archived one stays', async () => {
        quietLog();
        const archive = anArchive();
        const { documents, store, audits, invoice } = await anIssuedInvoice({
            archive,
            adapter: invoicingAdapter({
                documentGaps: (document) =>
                    document.fileName === 'kept.pdf' ? ['format.pdfa3'] : [],
            }),
        });
        archive.files.set(invoice.id, { ...keptFile(invoice, 'kept'), fileName: 'kept.pdf' });

        assert.deepEqual(await documents.archiveDue(LATER), { archived: 0, held: 1, failed: 0 });
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD'), [
            [
                INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_REFUSED,
                { adapter: 'test-tax', missing: ['format.pdfa3'] },
            ],
        ]);
        assert.equal(store.documents.size, 0);
    });

    test('the archive keeps that no longer matches its own checksum is held for the operator', async () => {
        quietLog();
        const archive = anArchive();
        const { documents, audits, invoice } = await anIssuedInvoice({ archive });
        archive.files.set(invoice.id, {
            ...keptFile(invoice, 'kept'),
            content: Buffer.from('changed'),
        });

        assert.deepEqual(await documents.archiveDue(LATER), { archived: 0, held: 1, failed: 0 });
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD'), [
            [INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH, { invoiceId: invoice.id }],
        ]);
    });
});

// @requirement SC-PRIC-033 — An invoice interrupted in archiving keeps its number and is never issued twice
describe('an invoice interrupted in archiving', () => {
    test('before the archive took the file is neither offered nor mailed, and the next run archives the same file', async () => {
        quietLog();
        const archive = anArchive();
        archive.failingStores.push(new Error('the archive is unreachable'));
        const { documents, store, mail, invoice } = await anIssuedInvoice({ archive });

        assert.deepEqual(await documents.archiveDue(AT), { archived: 0, held: 0, failed: 1 });
        const recorded = store.documents.get(invoice.id);
        assert.equal(recorded.archivedAt, null);
        await assert.rejects(
            documents.documentOf(invoice.id),
            refusedAs(
                ConflictException,
                INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_NOT_ARCHIVED,
            ),
        );
        assert.deepEqual(await documents.deliverDue(), { delivered: 0, held: 0, failed: 0 });
        assert.deepEqual(mail.sent, []);

        assert.deepEqual(await documents.archiveDue(LATER), { archived: 1, held: 0, failed: 0 });
        assert.equal(archive.files.get(invoice.id).checksum, recorded.checksum);
        assert.equal(store.documents.get(invoice.id).renderedAt, AT, 'recorded once, at first');
        assert.deepEqual(
            store.invoices.map((issued) => issued.number),
            [invoice.number],
        );
    });

    test('after the archive took the file is confirmed by the next run as kept, whatever the renderer makes since', async () => {
        quietLog();
        let version = 'first';
        const renderer = aRenderer({
            render: (invoice) => ({ ...documentOf(invoice), content: Buffer.from(version) }),
        });
        const { documents, store, archive, invoice } = await anIssuedInvoice({ renderer });
        const markArchived = store.markArchived;
        store.markArchived = async () => {
            store.markArchived = markArchived;
            throw new Error('the database is unreachable');
        };

        assert.deepEqual(await documents.archiveDue(AT), { archived: 0, held: 0, failed: 1 });
        assert.ok(archive.files.has(invoice.id));

        version = 'second';
        assert.deepEqual(await documents.archiveDue(LATER), { archived: 1, held: 0, failed: 0 });
        assert.equal(store.documents.get(invoice.id).archivedAt, LATER);
        assert.equal(archive.files.get(invoice.id).checksum, sha256(Buffer.from('first')));
        assert.equal(renderer.rendered.length, 1, 'not rendered again');
    });

    test('holds up no other invoice, and a renderer that does not answer counts as interrupted', async () => {
        quietLog();
        const stalled = new Set();
        const renderer = aRenderer({
            render: (invoice) =>
                stalled.has(invoice.id) ? new Promise(() => {}) : documentOf(invoice),
        });
        const installation = anInvoicingInstallation({ renderer });
        for (const tenantId of ['t1', 't2']) {
            const subscriber = await installation.aSubscriber(tenantId);
            installation.charge(await installation.aContract(subscriber), 'plan');
        }
        await installation.run();
        const [first, second] = installation.store.invoices;
        stalled.add(first.id);
        installation.documents.timeoutMs = 10;

        assert.deepEqual(await installation.documents.archiveDue(AT), {
            archived: 1,
            held: 0,
            failed: 1,
        });
        assert.ok(installation.archive.files.has(second.id));

        stalled.clear();
        assert.deepEqual(await installation.documents.archiveDue(LATER), {
            archived: 1,
            held: 0,
            failed: 0,
        });
    });

    test('is archived by a run however many pages of invoices wait before it', async () => {
        const installation = anInvoicingInstallation();
        // One more than a page: the last one is read only from the second.
        for (let index = 0; index < 101; index += 1) {
            const subscriber = await installation.aSubscriber(`t${index}`);
            installation.charge(await installation.aContract(subscriber), 'plan');
        }
        await installation.run();
        assert.equal(installation.store.invoices.length, 101);

        assert.deepEqual(await installation.documents.archiveDue(AT), {
            archived: 101,
            held: 0,
            failed: 0,
        });
    });
});

// @requirement SC-PRIC-047 — Every invoice reaches the subscriber by email, with its file attached
describe('an archived invoice’s mail', () => {
    test('goes to the invoice email on the subscriber’s record, with the archived file attached', async () => {
        const before = new Date();
        const { documents, store, archive, mail, invoice } = await anArchivedInvoice();

        assert.deepEqual(await documents.deliverDue(), { delivered: 1, held: 0, failed: 0 });

        const archived = archive.files.get(invoice.id);
        assert.deepEqual(mail.sent, [
            {
                invoice,
                to: INVOICE_EMAIL,
                document: {
                    content: archived.content,
                    mediaType: archived.mediaType,
                    fileName: archived.fileName,
                },
            },
        ]);
        const state = store.documents.get(invoice.id);
        assert.equal(state.deliveredTo, INVOICE_EMAIL);
        assert.ok(state.deliveredAt >= before && state.deliveredAt <= new Date());
    });

    test('is sent once: the next run sends nothing again', async () => {
        const { documents, mail } = await anArchivedInvoice();
        await documents.deliverDue();

        assert.deepEqual(await documents.deliverDue(), { delivered: 0, held: 0, failed: 0 });
        assert.equal(mail.sent.length, 1);
    });

    test('held by another run is left to it', async () => {
        const { documents, store, mail, invoice } = await anArchivedInvoice();
        await store.claimDelivery(invoice.id, new Date(), new Date(0));

        assert.deepEqual(await documents.deliverDue(), { delivered: 0, held: 0, failed: 0 });
        assert.deepEqual(mail.sent, []);
    });

    test('of two runs at the same moment goes out once', async () => {
        const { documents, mail } = await anArchivedInvoice();

        const runs = await Promise.all([documents.deliverDue(), documents.deliverDue()]);

        assert.equal(runs[0].delivered + runs[1].delivered, 1);
        assert.equal(mail.sent.length, 1);
    });

    test('to a subscriber without an invoice email waits, recorded once, and goes out once one is entered', async () => {
        quietLog();
        const installation = await anArchivedInvoice({}, { invoiceEmail: null });
        const { documents, mail, audits, subscriber } = installation;

        assert.deepEqual(await documents.deliverDue(), { delivered: 0, held: 1, failed: 0 });
        await documents.deliverDue();
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_DELIVERY_HELD'), [
            [
                INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NO_INVOICE_EMAIL,
                { subscriberId: subscriber.id },
            ],
        ]);
        assert.deepEqual(mail.sent, []);

        await installation.subscribers.changeContact(
            subscriber.id,
            { invoiceEmail: INVOICE_EMAIL },
            'tenant:test',
        );
        assert.deepEqual(await documents.deliverDue(), { delivered: 1, held: 0, failed: 0 });
        assert.equal(mail.sent[0].to, INVOICE_EMAIL);
    });

    test('the mail refuses is shown to the operator without the address, and tried again by the next run', async () => {
        quietLog();
        // A mail server words its refusal with the recipient in it, in its own case.
        const refusal = `550 5.1.1 <${INVOICE_EMAIL.toUpperCase()}>: recipient rejected`;
        const { documents, store, mail, audits, invoice } = await anArchivedInvoice({
            mail: aMailbox({ failures: 2, refusal }),
        });

        assert.deepEqual(await documents.deliverDue(), { delivered: 0, held: 0, failed: 1 });
        assert.deepEqual(await documents.deliverDue(), { delivered: 0, held: 0, failed: 1 });
        const failures = audits.filter(
            (entry) => entry.action === 'SUBSCRIPTION_INVOICE_DELIVERY_FAILED',
        );
        assert.equal(failures.length, 1, 'recorded once, however many runs fail');
        assert.deepEqual(failures[0].changes.params, {
            reason: '550 5.1.1 <[invoice email]>: recipient rejected',
        });
        assert.equal(store.documents.get(invoice.id).deliveryClaimedAt, null, 'let go');

        assert.deepEqual(await documents.deliverDue(), { delivered: 1, held: 0, failed: 0 });
        assert.equal(mail.sent.length, 1);
        assert.equal(store.invoices.length, 1, 'the invoice stayed issued throughout');
    });

    test('that does not answer in time is held for its answer, and a late success is recorded', async () => {
        quietLog();
        let answer = () => {};
        const mail = {
            sent: [],
            deliver: (message) =>
                new Promise((resolve) => {
                    mail.sent.push(message);
                    answer = resolve;
                }),
        };
        const { documents, store, invoice } = await anArchivedInvoice({ mail });
        documents.timeoutMs = 10;

        assert.deepEqual(await documents.deliverDue(), { delivered: 0, held: 0, failed: 1 });
        assert.ok(store.documents.get(invoice.id).deliveryClaimedAt, 'not let go while awaited');
        await documents.deliverDue();
        assert.equal(mail.sent.length, 1, 'no second run sends it meanwhile');

        answer();
        await pause(5);
        assert.equal(store.documents.get(invoice.id).deliveredTo, INVOICE_EMAIL);
    });

    test('that fails after the timeout is let go for the next run', async () => {
        quietLog();
        let fail = () => {};
        const mail = {
            sent: [],
            deliver: (message) =>
                new Promise((_, reject) => {
                    mail.sent.push(message);
                    fail = () => reject(new Error('the mail server hung up'));
                }),
        };
        const { documents, store, invoice } = await anArchivedInvoice({ mail });
        documents.timeoutMs = 10;
        await documents.deliverDue();

        fail();
        await pause(5);

        assert.equal(store.documents.get(invoice.id).deliveryClaimedAt, null);
    });

    test('whose archived file no longer matches its checksum is not sent, and shown to the operator', async () => {
        quietLog();
        const { documents, archive, mail, audits, invoice } = await anArchivedInvoice();
        archive.files.get(invoice.id).content[0] ^= 0xff;

        assert.deepEqual(await documents.deliverDue(), { delivered: 0, held: 1, failed: 0 });
        assert.deepEqual(mail.sent, []);
        assert.deepEqual(entriesOf(audits, 'SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH'), [
            [INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH, { invoiceId: invoice.id }],
        ]);
    });
});

// @requirement SC-AUD-014 — An invoice downloaded later is the document that was issued, not a new rendering
// @requirement SC-AUD-019 — An archived invoice is checked against the checksum of the file it was issued as
describe('an invoice’s document downloaded later', () => {
    test('is the archived file, not a new rendering', async () => {
        const { documents, archive, renderer, invoice } = await anArchivedInvoice();
        const archived = archive.files.get(invoice.id);

        const downloaded = await documents.documentOf(invoice.id);

        assert.deepEqual(downloaded, {
            content: archived.content,
            mediaType: archived.mediaType,
            fileName: archived.fileName,
        });
        assert.equal(renderer.rendered.length, 1, 'rendered once, when it was archived');
    });

    test('of an invoice that does not exist is answered as not found', async () => {
        const { documents } = await anArchivedInvoice();

        await assert.rejects(
            documents.documentOf('invoice-0'),
            refusedAs(NotFoundException, INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND),
        );
    });

    test('of an invoice still waiting for its document is not offered', async () => {
        const { documents, invoice } = await anIssuedInvoice();

        await assert.rejects(
            documents.documentOf(invoice.id),
            refusedAs(
                ConflictException,
                INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_NOT_ARCHIVED,
            ),
        );
    });

    for (const [what, spoil] of [
        ['whose bytes changed', (file) => (file.content[0] ^= 0xff)],
        ['whose checksum is another', (file) => (file.checksum = 'f'.repeat(64))],
        ['that is gone', (_file, archive, id) => archive.files.delete(id)],
    ]) {
        test(`${what} is not handed out, and shown to the operator`, async () => {
            quietLog();
            const { documents, archive, audits, invoice } = await anArchivedInvoice();
            spoil(archive.files.get(invoice.id), archive, invoice.id);

            await assert.rejects(
                documents.documentOf(invoice.id),
                refusedAs(
                    ConflictException,
                    INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH,
                ),
            );
            assert.equal(entriesOf(audits, 'SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH').length, 1);
        });
    }
});

// @requirement SC-PRIC-033 — An invoice interrupted in archiving keeps its number and is never issued twice
// @requirement SC-PRIC-047 — Every invoice reaches the subscriber by email, with its file attached
describe('the quarter-hourly run', () => {
    test('issues an invoice, archives it and mails it in one run', async () => {
        const installation = anInvoicingInstallation();
        const subscriber = await installation.aSubscriber('t1', { invoiceEmail: INVOICE_EMAIL });
        installation.charge(await installation.aContract(subscriber), 'plan');

        await new SubscriptionInvoiceCron(
            installation.service,
            null,
            installation.documents,
        ).issueDueInvoices();

        const [invoice] = installation.store.invoices;
        assert.ok(installation.archive.files.has(invoice.id));
        assert.equal(installation.mail.sent.length, 1);
    });

    test('whose archiving fails still mails, and the next run archives again', async () => {
        quietLog();
        const steps = [];
        const documents = {
            archiveDue: async () => {
                steps.push('archive');
                throw new Error('the archive is unreachable');
            },
            deliverDue: async () => {
                steps.push('mail');
                return { delivered: 0, held: 0, failed: 0 };
            },
        };
        const installation = anInvoicingInstallation();
        const cron = new SubscriptionInvoiceCron(installation.service, null, documents);

        await cron.issueDueInvoices();
        await cron.issueDueInvoices();

        assert.deepEqual(steps, ['archive', 'mail', 'archive', 'mail']);
    });
});

const ROUTE = 'GET admin/invoices/:id/document';

/** The platform serving the documents `installation` archived, as an application starts it. */
async function aServingPlatform(installation, options = {}) {
    const root = SaaSiCatModule.forRoot({
        ...invoicingPlatform({
            invoices: wiredInvoices({
                invoiceRepository: installation.store,
                archive: installation.archive,
            }),
            ...options,
        }),
        ...(options.adminResources === false ? { adminResources: false } : {}),
    });
    const moduleRef = await Test.createTestingModule({ imports: [root] }).compile();
    await moduleRef.init();
    const manifest = await moduleRef.get(AdminManifestService).getManifest();
    const served = controllersIn(root)
        .flatMap(handlersOf)
        .find(({ route }) => route === ROUTE);
    return {
        moduleRef,
        manifest,
        served,
        /** Asks the route the way Nest dispatches to it. */
        download: (id) => moduleRef.get(served.controller, { strict: false })[served.name](id),
    };
}

/** The bytes a streamed file carries. */
async function bytesOf(file) {
    const chunks = [];
    for await (const chunk of file.getStream()) chunks.push(chunk);
    return Buffer.concat(chunks);
}

// @requirement SC-AUD-014 — An invoice downloaded later is the document that was issued, not a new rendering
describe('the operator’s download', () => {
    test('is served where invoices are, answers the archived file, and the manifest announces it', async () => {
        const installation = await anArchivedInvoice();
        const { invoice, archive } = installation;
        const platform = await aServingPlatform(installation);

        const file = await platform.download(invoice.id);

        assert.equal(platform.manifest.capabilities['invoices.read'], true);
        assert.deepEqual(await bytesOf(file), Buffer.from(archive.files.get(invoice.id).content));
        assert.deepEqual(file.getHeaders(), {
            type: 'application/pdf',
            length: archive.files.get(invoice.id).content.byteLength,
            disposition: `attachment; filename="${invoice.number}.pdf"`,
        });
        await platform.moduleRef.close();
    });

    test('offers a file name that cannot end the header it stands in', async () => {
        const renderer = aRenderer({
            render: (invoice) => ({
                ...documentOf(invoice),
                fileName: 'Rechnung "März"\r\nX: y.pdf',
            }),
        });
        const installation = await anArchivedInvoice({ renderer });
        const platform = await aServingPlatform(installation);

        const file = await platform.download(installation.invoice.id);

        assert.equal(
            file.getHeaders().disposition,
            'attachment; filename="Rechnung__M_rz___X__y.pdf"',
        );
        await platform.moduleRef.close();
    });

    test('of a file with no name it could keep offers one', async () => {
        const renderer = aRenderer({
            render: (invoice) => ({ ...documentOf(invoice), fileName: '' }),
        });
        const installation = await anArchivedInvoice({ renderer });
        const platform = await aServingPlatform(installation);

        const file = await platform.download(installation.invoice.id);

        assert.equal(file.getHeaders().disposition, 'attachment; filename="invoice"');
        await platform.moduleRef.close();
    });

    for (const [without, options] of [
        ['invoices', { invoicing: null, invoices: null }],
        ['the tenants', { adminResources: false }],
    ]) {
        test(`without ${without}, neither the route nor the capability exists`, async () => {
            const installation = await anArchivedInvoice();
            const platform = await aServingPlatform(installation, options);

            assert.equal(platform.served, undefined);
            assert.equal(platform.manifest.capabilities['invoices.read'], undefined);
            await platform.moduleRef.close();
        });
    }
});
