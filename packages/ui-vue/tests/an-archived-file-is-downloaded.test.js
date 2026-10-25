// The operator's downloads of an archived file — an invoice's document, a
// contract's confirmation — from the request to the browser's save: both
// shipped clients hand the bytes over as they arrived, against a real server;
// a refusal reads as the platform's code; a client of the application's own
// without `bytes()` is said; and each download is offered only where the
// manifest announces its route.

// @requirement SC-AUD-016 — Concluding or changing a contract gives the subscriber a confirmation to keep

import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import axios from 'axios';
import { nextTick, ref } from 'vue';

import {
    AdminError,
    OBJECT_URL_LIFETIME_MS,
    bindResource,
    browserSaveFileEnvironment,
    createAxiosHttpClient,
    createFetchHttpClient,
    saveFile,
    subscribersResource,
} from '../dist/index.js';
import {
    useFileDownload,
    useSubscriberContracts,
    useSubscriberDownloads,
} from '../dist/vue/index.js';

/** Every byte value, the zero byte and 0xFF among them, opening as a PDF does. */
const PDF = Uint8Array.from({ length: 300 }, (_, index) => index % 256);
PDF.set([0x25, 0x50, 0x44, 0x46]);
const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

/** A server answering the two download routes, a refusal and a JSON read, recording each request. */
async function withServer(run) {
    const seen = [];
    const server = http.createServer((req, res) => {
        seen.push({ url: req.url, accept: req.headers.accept });
        if (req.url === '/api/v1/admin/invoices/inv-1/document') {
            res.writeHead(200, {
                'content-type': 'application/pdf',
                'content-disposition': 'attachment; filename="AHP-2026-000001.pdf"',
            });
            res.end(Buffer.from(PDF));
        } else if (req.url === '/api/v1/admin/contracts/c-1/confirmation') {
            res.writeHead(200, { 'content-type': 'application/pdf' });
            res.end(Buffer.from(PDF));
        } else if (req.url === '/api/v1/admin/contracts/c-2/confirmation') {
            res.writeHead(409, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ code: 'CONTRACT_CONFIRMATION_MISMATCH', params: {} }));
        } else {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"contracts":[]}');
        }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}`, seen);
    } finally {
        server.close();
    }
}

const CLIENTS = [
    ['createFetchHttpClient', (base) => createFetchHttpClient({ baseUrl: base })],
    ['createAxiosHttpClient', (base) => createAxiosHttpClient(axios.create({ baseURL: base }))],
];

for (const [name, clientOn] of CLIENTS) {
    describe(`a file through ${name}`, () => {
        test('arrives as the bytes the server sent, under the name it offers', async () => {
            await withServer(async (base) => {
                const subscribers = bindResource(subscribersResource, clientOn(base), CTX);

                const file = await subscribers.invoiceDocument('inv-1');

                assert.deepEqual(file.content, PDF);
                assert.equal(file.mediaType, 'application/pdf');
                assert.equal(file.fileName, 'AHP-2026-000001.pdf');
            });
        });

        test('without a name offered is saved under the one the download falls back to', async () => {
            await withServer(async (base) => {
                const subscribers = bindResource(subscribersResource, clientOn(base), CTX);

                const file = await subscribers.contractConfirmation('c-1');

                assert.equal(file.fileName, 'contract-confirmation.pdf');
                assert.deepEqual(file.content, PDF);
            });
        });

        test('refused reads as the platform’s code, and a JSON read beside it is untouched', async () => {
            await withServer(async (base) => {
                const subscribers = bindResource(subscribersResource, clientOn(base), CTX);

                await assert.rejects(
                    subscribers.contractConfirmation('c-2'),
                    (error) =>
                        error instanceof AdminError &&
                        error.status === 409 &&
                        error.code === 'CONTRACT_CONFIRMATION_MISMATCH',
                );
                assert.deepEqual(await subscribers.contracts('s-northwind'), { contracts: [] });
            });
        });
    });
}

describe('a file through a client of the application’s own', () => {
    test('asks for any type rather than JSON where createFetchHttpClient sends it', async () => {
        await withServer(async (base, seen) => {
            const subscribers = bindResource(
                subscribersResource,
                createFetchHttpClient({ baseUrl: base }),
                CTX,
            );

            await subscribers.invoiceDocument('inv-1');
            await subscribers.contracts('s-northwind');

            assert.deepEqual(
                seen.map((request) => request.accept),
                ['*/*', 'application/json'],
            );
        });
    });

    test('whose responses have no bytes() is said, rather than read as text', async () => {
        const textOnly = async () => ({
            status: 200,
            headers: { get: () => 'application/pdf' },
            json: async () => null,
            text: async () => '%PDF',
        });
        const subscribers = bindResource(subscribersResource, textOnly, CTX);

        await assert.rejects(
            subscribers.invoiceDocument('inv-1'),
            /has no bytes\(\)|have no bytes\(\)/,
        );
    });
});

describe('a downloaded file saved', () => {
    test('is handed over with exactly its bytes and name, and its address let go', async () => {
        const larger = new Uint8Array(16).fill(7);
        larger.set([1, 2, 3], 4);
        const steps = [];
        const blobs = [];
        saveFile(
            { content: larger.subarray(4, 7), mediaType: 'application/pdf', fileName: 'x.pdf' },
            {
                createObjectURL: (blob) => {
                    blobs.push(blob);
                    steps.push('create');
                    return 'blob:1';
                },
                follow: (url, fileName) => steps.push(`follow ${url} ${fileName}`),
                revokeObjectURL: (url) => steps.push(`revoke ${url}`),
            },
        );

        assert.deepEqual(steps, ['create', 'follow blob:1 x.pdf', 'revoke blob:1']);
        assert.equal(blobs[0].type, 'application/pdf');
        assert.deepEqual(new Uint8Array(await blobs[0].arrayBuffer()), Uint8Array.from([1, 2, 3]));
    });
});

describe("the browser's save", () => {
    test('keeps the object URL for its lifetime, and lets it go then', () => {
        const revoked = [];
        const original = URL.revokeObjectURL;
        URL.revokeObjectURL = (url) => revoked.push(url);
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            browserSaveFileEnvironment().revokeObjectURL('blob:file');

            mock.timers.tick(OBJECT_URL_LIFETIME_MS - 1);
            assert.deepEqual(revoked, [], 'let go before a slow browser read it');
            mock.timers.tick(1);
            assert.deepEqual(revoked, ['blob:file']);
        } finally {
            mock.timers.reset();
            URL.revokeObjectURL = original;
        }
    });
});

async function settled() {
    await nextTick();
    await new Promise((tick) => setTimeout(tick, 0));
}

describe('a download from a row', () => {
    const FILE = { content: PDF, mediaType: 'application/pdf', fileName: 'x.pdf' };

    test('saves the file, says which row is on its way, and takes one at a time', async () => {
        const saved = [];
        let finish;
        const fetched = [];
        const download = useFileDownload(
            (id) => {
                fetched.push(id);
                return new Promise((resolve) => (finish = () => resolve(FILE)));
            },
            { notify: () => assert.fail('nothing failed'), save: (file) => saved.push(file) },
        );

        const first = download.download('inv-1');
        await download.download('inv-2');
        assert.equal(download.downloading.value, 'inv-1');
        finish();
        await first;

        assert.deepEqual(fetched, ['inv-1']);
        assert.deepEqual(saved, [FILE]);
        assert.equal(download.downloading.value, null);
    });

    test('that fails tells the operator why, and leaves the row free for another try', async () => {
        const told = [];
        const download = useFileDownload(
            async () => {
                throw new AdminError({ status: 409, code: 'CONTRACT_CONFIRMATION_MISMATCH' });
            },
            { notify: (kind, message) => told.push([kind, message]), save: () => assert.fail() },
        );

        await download.download('c-2');

        assert.equal(told.length, 1);
        assert.equal(told[0][0], 'negative');
        assert.ok(told[0][1].length > 0);
        assert.equal(download.downloading.value, null);
    });
});

describe('the downloads and the contracts in a subscriber’s record', () => {
    const manifestWith = (capabilities) => ref({ capabilities });
    const subscribers = {
        invoiceDocument: async () => assert.fail(),
        contractConfirmation: async () => assert.fail(),
    };

    test('are offered each where the manifest announces its route', () => {
        const both = useSubscriberDownloads(
            manifestWith({ 'invoices.read': true, 'contracts.read': true }),
            subscribers,
            { notify: () => {} },
        );
        const invoicesOnly = useSubscriberDownloads(
            manifestWith({ 'invoices.read': true }),
            subscribers,
            {
                notify: () => {},
            },
        );

        assert.ok(both.invoices.value && both.confirmations.value);
        assert.ok(invoicesOnly.invoices.value);
        assert.equal(invoicesOnly.confirmations.value, null);
    });

    test('are read where the manifest announces them, and not otherwise', async () => {
        const asked = [];
        const reader = {
            contracts: async (slug) => {
                asked.push(slug);
                return { contracts: [] };
            },
        };

        const served = useSubscriberContracts(
            ref('s-northwind'),
            manifestWith({ 'contracts.read': true }),
            reader,
        );
        const unserved = useSubscriberContracts(ref('s-northwind'), manifestWith({}), reader);
        await settled();

        assert.deepEqual(served.data.value, { contracts: [] });
        assert.equal(unserved.available.value, false);
        assert.deepEqual(asked, ['s-northwind']);
    });
});
