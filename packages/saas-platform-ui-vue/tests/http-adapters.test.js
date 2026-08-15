// The two shipped `HttpClient` implementations.
//
// The cases are not invented: each one is something a hand-written shim in a
// real consumer app had to get right, or something the platform's own loaders
// depend on — a 304 that means "cache hit", a header read under the other
// casing, a 204 with no body, a DELETE that carries one.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createAxiosHttpClient, createFetchHttpClient, defaultHttpClient } from '../dist/index.js';

/** Records what `fetch` was called with and answers with a real `Response`. */
function stubFetch({ status = 200, body = '{}', headers = {} } = {}) {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(status === 204 ? null : body, { status, headers });
    };
    return { calls, restore: () => (globalThis.fetch = original) };
}

/** Minimal stand-in for an axios instance. */
function stubAxios({ status = 200, data = {}, headers = {} } = {}) {
    const calls = [];
    return {
        calls,
        instance: {
            async request(config) {
                calls.push(config);
                return { status, data, headers };
            },
        },
    };
}

describe('createFetchHttpClient', () => {
    test('passes a relative URL through unchanged when there is no base URL', async () => {
        const { calls, restore } = stubFetch();
        try {
            await createFetchHttpClient()('/api/v1/admin/boot');
            assert.equal(calls[0].url, '/api/v1/admin/boot');
        } finally {
            restore();
        }
    });

    test('prepends the base URL, without doubling the slash', async () => {
        const { calls, restore } = stubFetch();
        try {
            await createFetchHttpClient({ baseUrl: 'https://api.example.com/' })('/admin/boot');
            assert.equal(calls[0].url, 'https://api.example.com/admin/boot');
        } finally {
            restore();
        }
    });

    test('leaves an absolute URL alone even with a base URL set', async () => {
        const { calls, restore } = stubFetch();
        try {
            const http = createFetchHttpClient({ baseUrl: 'https://api.example.com' });
            await http('https://other.example.com/x');
            assert.equal(calls[0].url, 'https://other.example.com/x');
        } finally {
            restore();
        }
    });

    test('reads the headers hook per request, so a refreshed token is picked up', async () => {
        const { calls, restore } = stubFetch();
        try {
            let token = 'first';
            const http = createFetchHttpClient({
                headers: () => ({ Authorization: `Bearer ${token}` }),
            });
            await http('/x');
            token = 'second';
            await http('/x');
            assert.equal(calls[0].init.headers.get('authorization'), 'Bearer first');
            assert.equal(calls[1].init.headers.get('authorization'), 'Bearer second');
        } finally {
            restore();
        }
    });

    test('awaits an async headers hook', async () => {
        const { calls, restore } = stubFetch();
        try {
            const http = createFetchHttpClient({
                headers: async () => ({ Authorization: 'Bearer refreshed' }),
            });
            await http('/x');
            assert.equal(calls[0].init.headers.get('authorization'), 'Bearer refreshed');
        } finally {
            restore();
        }
    });

    test('asks for JSON', async () => {
        const { calls, restore } = stubFetch();
        try {
            await createFetchHttpClient()('/x');
            assert.equal(calls[0].init.headers.get('accept'), 'application/json');
        } finally {
            restore();
        }
    });

    test('a per-call header wins over the hook, whatever the casing', async () => {
        const { calls, restore } = stubFetch();
        try {
            const http = createFetchHttpClient({
                headers: () => ({ 'content-type': 'text/plain' }),
            });
            await http('/x', {
                method: 'POST',
                body: '{}',
                headers: { 'Content-Type': 'application/json' },
            });
            assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
        } finally {
            restore();
        }
    });

    test('supplies a JSON content type for a body that arrived without one', async () => {
        const { calls, restore } = stubFetch();
        try {
            await createFetchHttpClient()('/x', { method: 'POST', body: '{"a":1}' });
            assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
        } finally {
            restore();
        }
    });

    test('does not invent a content type when there is no body', async () => {
        const { calls, restore } = stubFetch();
        try {
            await createFetchHttpClient()('/x');
            assert.equal(calls[0].init.headers.get('content-type'), null);
        } finally {
            restore();
        }
    });

    test('a non-2xx is a response, not a throw', async () => {
        const { restore } = stubFetch({ status: 403, body: '{"code":"FORBIDDEN"}' });
        try {
            const res = await createFetchHttpClient()('/x');
            assert.equal(res.status, 403);
            assert.deepEqual(await res.json(), { code: 'FORBIDDEN' });
        } finally {
            restore();
        }
    });

    test('response headers are readable under any casing', async () => {
        const { restore } = stubFetch({ headers: { ETag: 'W/"abc"' } });
        try {
            const res = await createFetchHttpClient()('/x');
            assert.equal(res.headers.get('etag'), 'W/"abc"');
            assert.equal(res.headers.get('ETag'), 'W/"abc"');
        } finally {
            restore();
        }
    });

    test('defaultHttpClient is this client with no options', async () => {
        const { calls, restore } = stubFetch();
        try {
            await defaultHttpClient()('/api/v1/admin/boot');
            assert.equal(calls[0].url, '/api/v1/admin/boot');
            assert.equal(calls[0].init.headers.get('accept'), 'application/json');
        } finally {
            restore();
        }
    });
});

describe('createAxiosHttpClient', () => {
    test('strips the prefix the instance already carries as its baseURL', async () => {
        const { instance, calls } = stubAxios();
        await createAxiosHttpClient(instance, { stripPrefix: '/api/v1' })('/api/v1/admin/tenants');
        assert.equal(calls[0].url, '/admin/tenants');
    });

    test('tries several prefixes in order, so the longer one is not shadowed', async () => {
        const { instance, calls } = stubAxios();
        const http = createAxiosHttpClient(instance, { stripPrefix: ['/api/v1', '/api'] });
        await http('/api/v1/admin/tenants');
        await http('/api/admin/tenants');
        assert.equal(calls[0].url, '/admin/tenants');
        assert.equal(calls[1].url, '/admin/tenants');
    });

    test('leaves a URL that does not start with the prefix alone', async () => {
        const { instance, calls } = stubAxios();
        await createAxiosHttpClient(instance, { stripPrefix: '/api/v1' })('/api/v10/x');
        assert.equal(calls[0].url, '/api/v10/x');
    });

    test('a URL that is exactly the prefix becomes the root, not the empty string', async () => {
        const { instance, calls } = stubAxios();
        await createAxiosHttpClient(instance, { stripPrefix: '/api/v1' })('/api/v1');
        assert.equal(calls[0].url, '/');
    });

    test('without stripPrefix the URL passes through whole', async () => {
        const { instance, calls } = stubAxios();
        await createAxiosHttpClient(instance)('/api/v1/admin/tenants');
        assert.equal(calls[0].url, '/api/v1/admin/tenants');
    });

    test('no status throws — 304, 402 and 500 all arrive as responses', async () => {
        for (const status of [304, 402, 500]) {
            const { instance, calls } = stubAxios({ status });
            const res = await createAxiosHttpClient(instance)('/x');
            assert.equal(res.status, status);
            assert.equal(
                calls[0].validateStatus(status),
                true,
                `validateStatus rejected ${status}`,
            );
        }
    });

    test('the method is upper-cased and defaults to GET', async () => {
        const { instance, calls } = stubAxios();
        const http = createAxiosHttpClient(instance);
        await http('/x');
        await http('/x', { method: 'patch' });
        assert.equal(calls[0].method, 'GET');
        assert.equal(calls[1].method, 'PATCH');
    });

    test('a DELETE carries its body through', async () => {
        const { instance, calls } = stubAxios();
        const http = createAxiosHttpClient(instance);
        await http('/x', { method: 'DELETE', body: '{"immediately":true}' });
        assert.equal(calls[0].method, 'DELETE');
        assert.equal(calls[0].data, '{"immediately":true}');
    });

    test('json() returns what axios already parsed', async () => {
        const { instance } = stubAxios({ data: { slug: 'acme' } });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.deepEqual(await res.json(), { slug: 'acme' });
    });

    test('json() parses a raw string, for an instance with transformResponse disabled', async () => {
        const { instance } = stubAxios({ data: '{"slug":"acme"}' });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.deepEqual(await res.json(), { slug: 'acme' });
    });

    test('json() throws on a body that is not JSON, exactly as Response.json() does', async () => {
        const { instance } = stubAxios({ status: 502, data: '<html>Bad Gateway</html>' });
        const res = await createAxiosHttpClient(instance)('/x');
        await assert.rejects(res.json(), SyntaxError);
    });

    test('text() gives a string either way', async () => {
        const parsed = await createAxiosHttpClient(stubAxios({ data: { a: 1 } }).instance)('/x');
        assert.equal(await parsed.text(), '{"a":1}');
        const raw = await createAxiosHttpClient(stubAxios({ data: 'plain' }).instance)('/x');
        assert.equal(await raw.text(), 'plain');
    });

    test('response headers are readable under any casing', async () => {
        const { instance } = stubAxios({ headers: { etag: 'W/"abc"' } });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(res.headers.get('ETag'), 'W/"abc"');
        assert.equal(res.headers.get('etag'), 'W/"abc"');
    });

    test('a header that is not there reads as null, not undefined', async () => {
        const { instance } = stubAxios();
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(res.headers.get('ETag'), null);
    });

    test('survives an instance that reports no headers at all', async () => {
        const { instance } = stubAxios({ headers: undefined });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(res.headers.get('ETag'), null);
    });

    test('request headers are handed to the instance untouched', async () => {
        const { instance, calls } = stubAxios();
        await createAxiosHttpClient(instance)('/x', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });
        assert.deepEqual(calls[0].headers, { 'content-type': 'application/json' });
    });
});

describe('the adapters satisfy what the platform loaders expect', () => {
    test('a 304 with an ETag is usable by the manifest loader’s cache path', async () => {
        const { instance } = stubAxios({ status: 304, data: '', headers: { etag: 'W/"v2"' } });
        const res = await createAxiosHttpClient(instance, { stripPrefix: '/api/v1' })(
            '/api/v1/admin/manifest',
        );
        assert.equal(res.status, 304);
        assert.equal(res.headers.get('ETag'), 'W/"v2"');
    });

    test('a 204 arrives as a status the caller can check before reading a body', async () => {
        const { restore } = stubFetch({ status: 204 });
        try {
            const res = await createFetchHttpClient()('/x', { method: 'DELETE' });
            assert.equal(res.status, 204);
        } finally {
            restore();
        }
    });
});
