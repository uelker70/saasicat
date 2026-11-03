// useTenantInvoices — the invoices of the tenant's subscription a page at a
// time, its contract confirmations, and the archived document of each, behind
// the billing permission: a refusal that says the part is not for this user
// hides it, anything else is an error the page reports.

// @requirement SC-UI-023 — A tenant's invoices, payment method and billing details need the billing permission

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useTenantInvoices } from '../dist/index.js';

const INVOICE = (id) => ({ id, number: `R-${id}`, documentArchived: true });

/**
 * An HTTP client answering by method and path; a request nobody scripted is a
 * 404. A body that is a `Uint8Array` is a file, answered with its bytes and
 * the name the server offers.
 */
function routedHttp(routes) {
    const calls = [];
    const client = async (url, init) => {
        calls.push({ url, binary: init?.binary === true });
        const [status, body] = routes[url] ?? [404, {}];
        const file = body instanceof Uint8Array;
        return {
            status,
            headers: {
                get: (name) =>
                    file && name.toLowerCase() === 'content-disposition'
                        ? 'attachment; filename="R-1.pdf"'
                        : file
                          ? 'application/pdf'
                          : 'application/json',
            },
            json: async () => body,
            text: async () => JSON.stringify(body),
            bytes: async () => (file ? body : new TextEncoder().encode(JSON.stringify(body))),
        };
    };
    return { client, calls };
}

function invoicesOf(routes, options = {}) {
    const { client, calls } = routedHttp(routes);
    const saved = [];
    const documents = useTenantInvoices({
        http: client,
        autoLoad: false,
        save: (file) => saved.push(file),
        ...options,
    });
    return { documents, calls, saved };
}

describe("the tenant's invoices", () => {
    test('are read with the confirmations, and the part is shown', async () => {
        const { documents } = invoicesOf({
            '/billing/invoices': [200, { invoices: [INVOICE('2'), INVOICE('1')], next: null }],
            '/billing/contracts': [200, { confirmations: [{ contractId: 'c-1' }] }],
        });

        await documents.reload();

        assert.deepEqual(
            documents.invoices.value.map((invoice) => invoice.id),
            ['2', '1'],
        );
        assert.deepEqual(
            documents.confirmations.value.map((confirmation) => confirmation.contractId),
            ['c-1'],
        );
        assert.equal(documents.available.value, true);
        assert.equal(documents.hasMore.value, false);
        assert.equal(documents.error.value, null);
    });

    for (const status of [403, 404, 501]) {
        test(`answered ${status}, are a part not for this user, not an error`, async () => {
            const { documents } = invoicesOf({
                '/billing/invoices': [status, {}],
                '/billing/contracts': [status, {}],
            });

            await documents.reload();

            assert.equal(documents.available.value, false);
            assert.equal(documents.error.value, null);
        });
    }

    test('that fail otherwise are an error the page reports', async () => {
        const { documents } = invoicesOf({
            '/billing/invoices': [500, {}],
            '/billing/contracts': [200, { confirmations: [] }],
        });

        await documents.reload();

        assert.equal(documents.available.value, true);
        assert.ok(documents.error.value instanceof Error);
    });

    for (const [why, answer] of [
        ['with something else where the list belongs', { invoices: null, next: null }],
        ['without saying whether a page follows', { invoices: [] }],
    ]) {
        test(`answered ${why} are an error, not a subscriber without invoices`, async () => {
            const { documents } = invoicesOf({
                '/billing/invoices': [200, answer],
                '/billing/contracts': [200, { confirmations: [] }],
            });

            await documents.reload();

            assert.match(String(documents.error.value), /did not answer with \{ invoices, next \}/);
            assert.deepEqual(documents.invoices.value, []);
        });
    }

    test('go on a page at a time, after the last invoice read, until there is none', async () => {
        const { documents, calls } = invoicesOf(
            {
                '/api/billing/invoices': [200, { invoices: [INVOICE('a/2')], next: 'a/2' }],
                '/api/billing/contracts': [200, { confirmations: [] }],
                '/api/billing/invoices?after=a%2F2': [
                    200,
                    { invoices: [INVOICE('1')], next: null },
                ],
            },
            { apiPrefix: '/api/billing/' },
        );

        await documents.reload();
        assert.equal(documents.hasMore.value, true);
        await documents.more();
        await documents.more();

        assert.deepEqual(
            documents.invoices.value.map((invoice) => invoice.id),
            ['a/2', '1'],
        );
        assert.equal(documents.hasMore.value, false);
        assert.deepEqual(
            calls.map((call) => call.url),
            [
                '/api/billing/invoices',
                '/api/billing/contracts',
                '/api/billing/invoices?after=a%2F2',
            ],
        );
    });
});

describe('an invoice a link names', () => {
    const PAGES = {
        '/billing/invoices': [200, { invoices: [INVOICE('3')], next: '3' }],
        '/billing/contracts': [200, { confirmations: [] }],
        '/billing/invoices?after=3': [200, { invoices: [INVOICE('2')], next: '2' }],
        '/billing/invoices?after=2': [200, { invoices: [INVOICE('1')], next: null }],
    };

    test('on a page not read yet, is read with the pages up to it, and no further', async () => {
        const { documents, calls } = invoicesOf(PAGES);
        await documents.reload();

        assert.equal(await documents.loadUntil('2'), true);

        assert.deepEqual(
            documents.invoices.value.map((invoice) => invoice.id),
            ['3', '2'],
        );
        assert.deepEqual(
            calls.map((call) => call.url),
            ['/billing/invoices', '/billing/contracts', '/billing/invoices?after=3'],
        );
    });

    test('read already, reads nothing more', async () => {
        const { documents, calls } = invoicesOf(PAGES);
        await documents.reload();

        assert.equal(await documents.loadUntil('3'), true);

        assert.equal(calls.length, 2);
    });

    test('on no page, is looked for to the last page, and said not to be there', async () => {
        const { documents } = invoicesOf(PAGES);
        await documents.reload();

        assert.equal(await documents.loadUntil('nowhere'), false);

        assert.equal(documents.hasMore.value, false);
    });
});

describe('a document downloaded', () => {
    test('is the invoice’s archived file, handed over as it arrived', async () => {
        const bytes = new Uint8Array([37, 80, 68, 70]);
        const { documents, calls, saved } = invoicesOf({
            '/billing/invoices/R%2F1/document': [200, bytes],
        });

        await documents.downloadInvoice('R/1');

        assert.deepEqual(calls, [{ url: '/billing/invoices/R%2F1/document', binary: true }]);
        assert.equal(saved.length, 1);
        assert.deepEqual([...saved[0].content], [...bytes]);
        assert.equal(saved[0].fileName, 'R-1.pdf');
        assert.equal(documents.downloading.value, null);
    });

    test('is the contract’s archived confirmation', async () => {
        const { documents, calls, saved } = invoicesOf({
            '/billing/contracts/c-1/confirmation': [200, new Uint8Array([1])],
        });

        await documents.downloadConfirmation('c-1');

        assert.deepEqual(
            calls.map((call) => call.url),
            ['/billing/contracts/c-1/confirmation'],
        );
        assert.equal(saved.length, 1);
    });

    test('refused, reaches the caller, saves nothing, and the download is over', async () => {
        const { documents, saved } = invoicesOf({
            '/billing/invoices/x/document': [
                404,
                { code: 'SUBSCRIPTION_INVOICE_NOT_FOUND', message: "No invoice 'x'." },
            ],
        });

        await assert.rejects(documents.downloadInvoice('x'));

        assert.deepEqual(saved, []);
        assert.equal(documents.downloading.value, null);
    });
});
