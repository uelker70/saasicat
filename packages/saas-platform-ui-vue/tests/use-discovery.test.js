// useDiscovery — the composable over `GET /admin/discovery`, plus its rescan.
//
// It had no test of its own. Its two branded throw sites pass through whatever
// status the consumer's `HttpClient` reported, which is the reason
// `AdminError.emptyResponse` cannot be inferred from `status === 0` plus the
// package's brand (see `admin-error.test.js`) — so its behaviour is worth
// pinning down here rather than only at the error layer.
//
// `runWithContext` gives the composable's `inject()` an app to resolve
// against, the way a mount would; without one Vue warns on every call.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from 'vue';

import { DEFAULT_SA_LOCALE, DiscoveryLoadError, SA_MESSAGES, useDiscovery } from '../dist/index.js';

/** What the composable resolves without an i18n provider. */
const MSG = SA_MESSAGES[DEFAULT_SA_LOCALE].discovery;

const SNAPSHOT = { scannedAt: '2026-01-01T00:00:00.000Z', capabilities: [] };
const ENDPOINT = '/api/admin/discovery';

/** Answers each request from the queue, repeating the last entry. */
function httpQueue(responses) {
    const calls = [];
    let index = 0;
    const http = (url, init) => {
        calls.push({ url, init });
        const next = responses[index++] ?? responses[responses.length - 1];
        return Promise.resolve({
            status: next.status,
            // A real `Headers` is case-insensitive, and the code under test
            // asks for `ETag` in one place and `etag` in another.
            headers: {
                get: (name) => {
                    const wanted = name.toLowerCase();
                    const hit = Object.entries(next.headers ?? {}).find(
                        ([key]) => key.toLowerCase() === wanted,
                    );
                    return hit ? hit[1] : null;
                },
            },
            json: async () => next.body,
            text: async () => JSON.stringify(next.body),
        });
    };
    return { http, calls };
}

function discovery(options) {
    return createApp({}).runWithContext(() => useDiscovery({ endpoint: ENDPOINT, ...options }));
}

describe('useDiscovery', () => {
    test('the endpoint is required — there is no prefix the platform could guess', () => {
        assert.throws(() => discovery({ endpoint: undefined }), /endpoint/);
    });

    test('load() adopts the snapshot and remembers the ETag', async () => {
        const { http, calls } = httpQueue([
            { status: 200, body: SNAPSHOT, headers: { ETag: 'W/"1"' } },
        ]);
        const view = discovery({ http, getAuthToken: () => 'tok' });
        await view.load();
        assert.equal(calls[0].url, ENDPOINT);
        assert.equal(calls[0].init.method, 'GET');
        assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
        assert.equal(calls[0].init.headers['If-None-Match'], undefined);
        assert.deepEqual(view.snapshot.value, SNAPSHOT);
        assert.equal(view.etag.value, 'W/"1"');
        assert.equal(view.loading.value, false);
        assert.equal(view.error.value, null);
    });

    test('the second load sends the ETag, and a 304 changes nothing', async () => {
        const { http, calls } = httpQueue([
            { status: 200, body: SNAPSHOT, headers: { ETag: 'W/"1"' } },
            { status: 304 },
        ]);
        const view = discovery({ http });
        await view.load();
        await view.load();
        assert.equal(calls[1].init.headers['If-None-Match'], 'W/"1"');
        assert.deepEqual(view.snapshot.value, SNAPSHOT, 'the cached snapshot survives a 304');
        assert.equal(view.etag.value, 'W/"1"');
        assert.equal(view.error.value, null);
    });

    test('reload() drops the ETag, so the server has to answer with a body', async () => {
        const { http, calls } = httpQueue([
            { status: 200, body: SNAPSHOT, headers: { ETag: 'W/"1"' } },
            { status: 200, body: { ...SNAPSHOT, scannedAt: '2026-02-02T00:00:00.000Z' } },
        ]);
        const view = discovery({ http });
        await view.load();
        await view.reload();
        assert.equal(calls[1].init.headers['If-None-Match'], undefined);
        assert.equal(view.snapshot.value.scannedAt, '2026-02-02T00:00:00.000Z');
        // No ETag on the second answer, so nothing is remembered to send next.
        assert.equal(view.etag.value, null);
    });

    test('a failed load lands on `error`, not on a rejection the page has to catch', async () => {
        const { http } = httpQueue([{ status: 503, body: {} }]);
        const view = discovery({ http });
        await view.load();
        assert.ok(view.error.value instanceof DiscoveryLoadError);
        assert.equal(view.error.value.status, 503);
        assert.equal(view.error.value.message, MSG.errorDiscoveryHttp.replace('{status}', '503'));
        assert.equal(view.snapshot.value, null);
        assert.equal(view.loading.value, false);
    });

    test('rescan() posts, adopts the new snapshot and accepts 200 as well as 201', async () => {
        for (const status of [200, 201]) {
            const { http, calls } = httpQueue([
                { status, body: SNAPSHOT, headers: { etag: 'W/"2"' } },
            ]);
            const view = discovery({ http });
            await view.rescan();
            assert.equal(calls[0].url, `${ENDPOINT}/rescan`);
            assert.equal(calls[0].init.method, 'POST');
            assert.deepEqual(view.snapshot.value, SNAPSHOT);
            assert.equal(view.etag.value, 'W/"2"');
            assert.equal(view.error.value, null);
        }
    });

    test('a failed rescan says rescan, not discovery', async () => {
        const { http } = httpQueue([{ status: 500, body: {} }]);
        const view = discovery({ http });
        await view.rescan();
        assert.ok(view.error.value instanceof DiscoveryLoadError);
        assert.equal(view.error.value.message, MSG.errorRescanHttp.replace('{status}', '500'));
    });

    test('a client that rejects is reported as it is, not re-wrapped', async () => {
        const view = discovery({ http: () => Promise.reject(new TypeError('Failed to fetch')) });
        await view.load();
        assert.ok(view.error.value instanceof TypeError);
        assert.equal(view.loading.value, false);
    });

    test('a client that throws a non-Error still leaves an Error behind', async () => {
        const view = discovery({ http: () => Promise.reject('down') });
        await view.load();
        assert.ok(view.error.value instanceof Error);
        assert.equal(view.error.value.message, 'down');
    });

    test('autoLoad fetches without being asked', async () => {
        const { http, calls } = httpQueue([{ status: 200, body: SNAPSHOT }]);
        const view = discovery({ http, autoLoad: true });
        // `void load()` is fire-and-forget, so there is no promise to await.
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 1);
        assert.deepEqual(view.snapshot.value, SNAPSHOT);
    });
});
