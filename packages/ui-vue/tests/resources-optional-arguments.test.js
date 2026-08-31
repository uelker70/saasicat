// What an operation sends when its optional argument is left out.
//
// Every one of these is a documented default — "no filter", "no revalidation",
// "publish with nothing overridden" — and each is a branch the differential
// comparison never takes, because that file drives every operation with its
// arguments filled in. An unfiltered list is the request a page makes on its
// first render, so it is worth more than the branch percentage that noticed it
// was missing.

// @requirement SC-UI-003 — Replacing one operation that does not exist is refused at start-up

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    bindResource,
    bundleVersionsResource,
    catalogResource,
    discoveryResource,
    marketingResource,
    planVersionsResource,
    promoCodesResource,
    tenantsResource,
    usersResource,
} from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

function recorder() {
    const calls = [];
    const http = (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body,
            headers: init?.headers,
        });
        return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            json: async () => ({ id: 'x', planVersion: {}, bundleVersion: {} }),
            text: async () => '{}',
        });
    };
    return { http, calls };
}

/** Runs one operation with the arguments given and returns the single request. */
async function call(def, op, args = []) {
    const { http, calls } = recorder();
    await bindResource(def, http, CTX)[op](...args);
    assert.equal(calls.length, 1, `${op} sent ${calls.length} requests`);
    return calls[0];
}

describe('a list with no filter asks for no filter', () => {
    test('promoCodes.list() sends a bare path', async () => {
        const { url, method } = await call(promoCodesResource, 'list');
        assert.equal(url, '/api/v1/admin/promo-codes');
        assert.equal(method, 'GET');
    });

    test('users.list() sends a bare path', async () => {
        const { url } = await call(usersResource, 'list');
        assert.equal(url, '/api/v1/admin/users');
    });

    test('marketing.listProjections() sends a bare path when nothing narrows it', async () => {
        // Every part of the filter is optional, and a trailing `?` is a
        // different URL to anything that caches or logs one.
        const { url } = await call(marketingResource, 'listProjections');
        assert.equal(url, '/api/v1/admin/catalog/marketing-projections');
    });

    test('tenants.list() asks for the first page at the default size', async () => {
        const { url } = await call(tenantsResource, 'list');
        assert.equal(url, '/api/v1/admin/tenants?page=1&pageSize=50');
    });
});

describe('a publish with nothing overridden', () => {
    test('planVersions.publish sends an empty object, not an absent body', async () => {
        // The endpoint reads its overrides off the body; sending none at all
        // and sending `{}` are different requests to a server with a DTO pipe.
        const { body } = await call(planVersionsResource, 'publish', ['v1']);
        assert.equal(body, '{}');
    });

    test('bundleVersions.publish does the same', async () => {
        const { body } = await call(bundleVersionsResource, 'publish', ['v1']);
        assert.equal(body, '{}');
    });
});

describe('a discovery read with no tag to revalidate against', () => {
    test('read() sends no If-None-Match', async () => {
        const { headers } = await call(discoveryResource, 'read');
        assert.deepEqual(headers, {});
    });

    test('read(null) is the same request — that is how a forced reload is spelled', async () => {
        const { headers, url } = await call(discoveryResource, 'read', [null]);
        assert.deepEqual(headers, {});
        assert.equal(url, '/api/v1/admin/discovery');
    });

    test('read(etag) revalidates', async () => {
        const { headers } = await call(discoveryResource, 'read', ['"abc"']);
        assert.deepEqual(headers, { 'If-None-Match': '"abc"' });
    });

    test('an unchanged snapshot is not re-read', async () => {
        const http = () =>
            Promise.resolve({
                status: 304,
                headers: { get: () => '"abc"' },
                json: async () => {
                    throw new Error('a 304 has no body to parse');
                },
                text: async () => '',
            });
        const result = await bindResource(discoveryResource, http, CTX).read('"abc"');
        assert.deepEqual(result, { status: 'unchanged' });
    });

    test('a loaded snapshot carries the tag the next read revalidates with', async () => {
        const http = () =>
            Promise.resolve({
                status: 200,
                headers: { get: (name) => (name === 'ETag' ? '"v2"' : null) },
                json: async () => ({ capabilities: [] }),
                text: async () => '{}',
            });
        const result = await bindResource(discoveryResource, http, CTX).read();
        assert.deepEqual(result, {
            status: 'loaded',
            snapshot: { capabilities: [] },
            etag: '"v2"',
        });
    });

    test('a status that is neither 200 nor 304 fails rather than reading a body', async () => {
        const http = () =>
            Promise.resolve({
                status: 202,
                headers: { get: () => null },
                json: async () => ({}),
                text: async () => '{}',
            });
        await assert.rejects(() => bindResource(discoveryResource, http, CTX).read(), /HTTP 202/);
    });

    test('a rescan that does not answer 200 or 201 fails the same way', async () => {
        const http = () =>
            Promise.resolve({
                status: 204,
                headers: { get: () => null },
                json: async () => ({}),
                text: async () => '',
            });
        await assert.rejects(() => bindResource(discoveryResource, http, CTX).rescan(), /HTTP 204/);
    });
});

describe('an empty list answer is a list, not a null', () => {
    // Every list operation turns "the server sent no body" into `[]`. A page
    // that got `null` here would render `null.length` on its first load.
    const emptyHttp = () =>
        Promise.resolve({
            status: 204,
            headers: { get: () => null },
            json: async () => null,
            text: async () => '',
        });

    const LIST_OPS = [
        [promoCodesResource, 'list'],
        [usersResource, 'list'],
        [marketingResource, 'listProjections'],
        [catalogResource, 'capabilities'],
        [catalogResource, 'features'],
        [catalogResource, 'quotas'],
    ];

    for (const [def, op] of LIST_OPS) {
        test(`${def.key}.${op} answers []`, async () => {
            const bound = bindResource(def, emptyHttp, CTX);
            assert.deepEqual(await bound[op](), []);
        });
    }
});
