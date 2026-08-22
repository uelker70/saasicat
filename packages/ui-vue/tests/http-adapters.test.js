// The two shipped `HttpClient` implementations.
//
// The cases are not invented: each one is something a hand-written shim in a
// real consumer app had to get right, or something the platform's own loaders
// depend on — a 304 that means "cache hit", a header read under the other
// casing, a 204 with no body, a DELETE that carries one.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import axios from 'axios';

import {
    createAxiosHttpClient,
    createFetchHttpClient,
    defaultHttpClient,
    isAxiosNoResponseError,
    isTransportFailure,
    markTransportFailure,
    toAdminError,
} from '../dist/index.js';

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

/** What a default axios instance echoes back: its one default transform ran. */
const DECODING_CONFIG = {
    transformResponse: [
        function transformResponse(d) {
            return d;
        },
    ],
};
/** What `axios.create({ transformResponse: [] })` echoes: nothing ran. */
const RAW_CONFIG = { transformResponse: [] };
/** What `axios.create({ transformResponse: null })` echoes: nothing ran either. */
const NULL_TRANSFORM_CONFIG = { transformResponse: null };

/**
 * Minimal stand-in for an axios instance.
 *
 * `config` is not decoration. axios echoes the merged request config on every
 * response, and `json()` reads it to tell a body axios already decoded from one
 * it handed over as text. A fixture that left it out could not tell those apart
 * either — which is why `JSON.parse` ran over values axios had already decoded
 * and went unnoticed for as long as it did.
 */
function stubAxios({ status = 200, data = {}, headers = {}, config = DECODING_CONFIG } = {}) {
    const calls = [];
    return {
        calls,
        instance: {
            async request(requestConfig) {
                calls.push(requestConfig);
                return { status, data, headers, config };
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

    test('an Accept the hook asked for is kept', async () => {
        const { calls, restore } = stubFetch();
        try {
            const http = createFetchHttpClient({
                headers: () => ({ Accept: 'application/vnd.example.v2+json' }),
            });
            await http('/x');
            assert.equal(calls[0].init.headers.get('accept'), 'application/vnd.example.v2+json');
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

    test('a failed request is marked as one, whichever way the client was built', async () => {
        // `fetch` rejects with a `TypeError` for every failure before a
        // response, and that is the same class a null dereference in page code
        // raises. The mark is what separates them, and it belongs here rather
        // than in `defaultHttpClient`: a consumer calling
        // `createFetchHttpClient({ headers })` goes through this seam too.
        const original = globalThis.fetch;
        globalThis.fetch = async () => {
            throw new TypeError('Failed to fetch');
        };
        try {
            for (const client of [createFetchHttpClient(), defaultHttpClient()]) {
                const err = await client('/x').then(
                    () => null,
                    (e) => e,
                );
                assert.equal(isTransportFailure(err), true);
            }
        } finally {
            globalThis.fetch = original;
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

    test('a prefix written with a trailing slash strips the same way', async () => {
        // `'/api/v1/'` is how an axios baseURL is usually written. Requiring
        // the exact form silently sent every request to a doubled path.
        const { instance, calls } = stubAxios();
        await createAxiosHttpClient(instance, { stripPrefix: '/api/v1/' })('/api/v1/admin/boot');
        assert.equal(calls[0].url, '/admin/boot');
    });

    test('a query ends the path, so the prefix is still the prefix', async () => {
        const { instance, calls } = stubAxios();
        await createAxiosHttpClient(instance, { stripPrefix: '/api/v1' })('/api/v1?tenant=acme');
        assert.equal(calls[0].url, '/?tenant=acme');
    });

    test('a fragment ends it too', async () => {
        const { instance, calls } = stubAxios();
        await createAxiosHttpClient(instance, { stripPrefix: '/api/v1' })('/api/v1#top');
        assert.equal(calls[0].url, '/#top');
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
            const { instance } = stubAxios({ status });
            const res = await createAxiosHttpClient(instance)('/x');
            assert.equal(res.status, status);
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
        const { instance } = stubAxios({ data: '{"slug":"acme"}', config: RAW_CONFIG });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.deepEqual(await res.json(), { slug: 'acme' });
    });

    test('every way of turning axios’s own decoding off is read as text', async () => {
        // Three of them, and each is a separate axis. Listing the two that
        // came to mind is how the third would have been missed.
        const off = [
            { responseType: 'text' },
            { responseType: 'stream' },
            { transitional: { forcedJSONParsing: false } },
        ];
        for (const extra of off) {
            const { instance } = stubAxios({
                data: '{"slug":"acme"}',
                config: { ...DECODING_CONFIG, ...extra },
            });
            const res = await createAxiosHttpClient(instance)('/x');
            assert.deepEqual(await res.json(), { slug: 'acme' }, JSON.stringify(extra));
        }
    });

    test('responseType json is the one that still means decoded', async () => {
        const { instance } = stubAxios({
            data: 'ready',
            config: { ...DECODING_CONFIG, responseType: 'json' },
        });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(await res.json(), 'ready');
    });

    test('json() does not decode a second time what axios already decoded', async () => {
        // The defect this pins: a body of `"ready"` reaches a normal instance
        // as the string `ready`, and `JSON.parse('ready')` throws.
        const { instance } = stubAxios({ data: 'ready' });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(await res.json(), 'ready');
    });

    test('a decoded string that reads as JSON keeps its meaning', async () => {
        // The quiet half of the same defect: `JSON.parse('null')` succeeds and
        // turns the string `null` into the value `null`.
        const { instance } = stubAxios({ data: 'null' });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(await res.json(), 'null');
    });

    test('json() throws on a raw body that is not JSON, exactly as Response.json() does', async () => {
        const { instance } = stubAxios({
            status: 502,
            data: '<html>Bad Gateway</html>',
            config: RAW_CONFIG,
        });
        const res = await createAxiosHttpClient(instance)('/x');
        await assert.rejects(res.json(), SyntaxError);
    });

    test('a body a decoding instance could not parse is the string it kept', async () => {
        // axios's default transform swallows its own SyntaxError and hands the
        // body back unchanged, so this string and a decoded `"ready"` are the
        // same value. `readErrorBody` in `http-json.ts` takes either.
        const { instance } = stubAxios({ status: 502, data: '<html>Bad Gateway</html>' });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(await res.json(), '<html>Bad Gateway</html>');
    });

    test('an empty body throws whatever the instance decodes', async () => {
        // Under `'auto'` an empty `data` is read as no body, whichever way the
        // instance is configured, and `Response.json()` throws on one too.
        for (const config of [DECODING_CONFIG, RAW_CONFIG, NULL_TRANSFORM_CONFIG]) {
            const { instance } = stubAxios({ status: 200, data: '', config });
            const res = await createAxiosHttpClient(instance)('/x');
            await assert.rejects(res.json(), SyntaxError);
        }
    });

    test('a declared decoding instance hands an empty data over as the empty string', async () => {
        // The declaration is the tiebreaker, so nothing may run ahead of it —
        // and `''` is precisely a tie: axios's transform leaves it behind for a
        // zero-byte body and for the two bytes `""` alike.
        const { instance } = stubAxios({ status: 200, data: '', config: DECODING_CONFIG });
        const res = await createAxiosHttpClient(instance, { responseBody: 'decoded' })('/x');
        assert.equal(await res.json(), '');
    });

    test('a declared raw instance still throws on an empty data', async () => {
        const { instance } = stubAxios({ status: 200, data: '', config: DECODING_CONFIG });
        const res = await createAxiosHttpClient(instance, { responseBody: 'raw' })('/x');
        await assert.rejects(res.json(), SyntaxError);
    });

    test('transformResponse null is a pipeline that ran nothing, so the body is raw', async () => {
        // axios iterates `transformResponse` with its own `forEach`, which
        // returns immediately for a nullish collection. `null` is therefore as
        // much proof of an untouched body as `[]` is.
        const { instance } = stubAxios({ data: '"ready"', config: NULL_TRANSFORM_CONFIG });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(await res.json(), 'ready');
    });

    test('a config that merely omits transformResponse has not said anything', async () => {
        // The other half of the reading above: absence is not `null`. Only a
        // stand-in omits the property, and reading that as raw would parse
        // every scalar such a stand-in already decoded.
        const { instance } = stubAxios({ data: 'ready', config: { responseType: undefined } });
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(await res.json(), 'ready');
    });

    test('a response carrying no config is read as already decoded', async () => {
        // Real axios always attaches one, so only a stand-in can omit it.
        // Reading it as decoded fails loudly if that is wrong, rather than
        // silently changing what a scalar means.
        const instance = {
            async request() {
                return { status: 200, data: 'ready', headers: {} };
            },
        };
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(await res.json(), 'ready');
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

describe('createAxiosHttpClient — the instance keeps its own error handling', () => {
    /** An instance whose rejection-side interceptor refreshes and retries. */
    function refreshingInstance() {
        const log = [];
        let refreshed = false;
        const instance = {
            async request(config) {
                log.push(`${config.method} ${config.url}`);
                if (!refreshed) {
                    // What axios does when validateStatus rejects a status:
                    // the rejection carries the response.
                    const err = new Error('Request failed with status code 401');
                    err.response = { status: 401, data: { code: 'EXPIRED' }, headers: {} };
                    // The instance's own rejection interceptor gets first refusal.
                    refreshed = true;
                    log.push('refresh');
                    return instance.request(config);
                }
                return { status: 200, data: { ok: true }, headers: {} };
            },
        };
        return { instance, log };
    }

    test('a rejection the instance recovers from never reaches the platform', async () => {
        const { instance, log } = refreshingInstance();
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(res.status, 200);
        assert.deepEqual(log, ['GET /x', 'refresh', 'GET /x']);
    });

    test('a rejection it does not recover from arrives as a response, not a throw', async () => {
        const instance = {
            async request() {
                const err = new Error('Request failed with status code 403');
                err.response = { status: 403, data: { code: 'FORBIDDEN' }, headers: {} };
                throw err;
            },
        };
        const res = await createAxiosHttpClient(instance)('/x');
        assert.equal(res.status, 403);
        assert.deepEqual(await res.json(), { code: 'FORBIDDEN' });
    });

    test('a failure with no response stays a throw', async () => {
        const instance = {
            async request() {
                throw new Error('Network Error');
            },
        };
        await assert.rejects(createAxiosHttpClient(instance)('/x'), /Network Error/);
    });

    test('a structural instance that says nothing is not marked for it', async () => {
        // The honest answer, and the one this adapter cannot improve on. A bare
        // `Error` out of a non-axios `AxiosLike` is the same object whether the
        // socket was dead or an interceptor answered a 401 with its own words —
        // same class, same absent `isAxiosError`, `config`, `request` and
        // `response`. Marking it would put "check your connection" over every
        // message such a client writes.
        const instance = {
            async request() {
                throw new Error('backend unreachable');
            },
        };
        await assert.rejects(createAxiosHttpClient(instance)('/x'), (err) => {
            assert.equal(isTransportFailure(err), false);
            assert.equal(toAdminError(err).detail, 'backend unreachable');
            return true;
        });
    });

    test('…and the way out is the one the fetch adapter uses', async () => {
        // What such a client should do instead: it is the only party that knows
        // its request never left, so it says so. Exported for exactly this.
        const instance = {
            async request() {
                throw markTransportFailure(new Error('backend unreachable'));
            },
        };
        await assert.rejects(createAxiosHttpClient(instance)('/x'), (err) => {
            assert.equal(isTransportFailure(err), true);
            assert.equal(toAdminError(err).transportFailure, true);
            return true;
        });
    });

    test('no validateStatus is imposed on the instance', async () => {
        const { instance, calls } = stubAxios();
        await createAxiosHttpClient(instance)('/x');
        assert.equal('validateStatus' in calls[0], false);
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

// Everything above stands in for axios. Nothing here does: these run a real
// instance against a real server, because the one thing a stand-in cannot
// reproduce is the transform axios itself applies — and that transform is what
// decides whether `response.data` is a value or the bytes that carried it.

/** Status, content type and the exact bytes to write, per path. */
const SERVED = {
    '/object': [200, 'application/json', '{"slug":"acme"}'],
    '/array': [200, 'application/json', '[{"a":1}]'],
    '/scalar': [200, 'application/json', '"ready"'],
    '/null': [200, 'application/json', 'null'],
    '/string-null': [200, 'application/json', '"null"'],
    '/number': [200, 'application/json', '42'],
    '/boolean': [200, 'application/json', 'true'],
    '/empty': [200, 'application/json', ''],
    // Two bytes, not zero: valid JSON meaning the empty string. It is not in
    // `MEANS` because it does not have one answer — an instance that decodes
    // leaves the same `''` behind that a zero-byte body leaves, so what
    // `json()` can still recover depends on what the instance said about
    // itself. The three tests below cover the three answers.
    '/empty-string': [200, 'application/json', '""'],
    '/html': [502, 'text/html', '<html>Bad Gateway</html>'],
    '/forbidden': [403, 'application/json', '{"code":"FORBIDDEN"}'],
};

/** What each of those bodies means, whoever decodes it. */
const MEANS = {
    '/object': { slug: 'acme' },
    '/array': [{ a: 1 }],
    '/scalar': 'ready',
    '/null': null,
    '/string-null': 'null',
    '/number': 42,
    '/boolean': true,
};

/** Instance configurations a consumer can plausibly hand the adapter. */
const INSTANCES = [
    ['default', {}],
    ['responseType json', { responseType: 'json' }],
    ['responseType text', { responseType: 'text' }],
    ['transformResponse []', { transformResponse: [] }],
    ['forcedJSONParsing false', { transitional: { forcedJSONParsing: false } }],
    // The echoed config is literally `null` — no pipeline, so nothing ran. That
    // is readable, which puts this one outside `CUSTOM_TRANSFORMS` below.
    ['transformResponse null', { transformResponse: null }],
];

/** The first two decode the body; the rest hand it over as text. */
const DECODING = INSTANCES.slice(0, 2);
const RAW = INSTANCES.slice(2);

/**
 * Instances that replaced axios's response transform with one of their own, and
 * the `responseBody` each has to declare.
 *
 * These are the configurations the response cannot describe. All three echo the
 * same config a stock instance echoes — one function, arity one — so no reading
 * of the response tells the first two apart, and the bare-function form is
 * neither an array nor empty. The declaration is the only thing that separates
 * them, which is why it exists.
 */
const CUSTOM_TRANSFORMS = [
    ['transformResponse [identity]', { transformResponse: [(d) => d] }, 'raw'],
    ['transformResponse identity, bare fn', { transformResponse: (d) => d }, 'raw'],
    ['transformResponse [JSON.parse]', { transformResponse: [(d) => JSON.parse(d)] }, 'decoded'],
];

async function withServer(run) {
    const server = http.createServer((req, res) => {
        const [status, type, body] = SERVED[req.url.split(/[?#]/)[0]] ?? [
            404,
            'application/json',
            '{"code":"NOT_FOUND"}',
        ];
        res.writeHead(status, { 'content-type': type, etag: 'W/"abc"' });
        res.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        server.close();
    }
}

describe('createAxiosHttpClient — against a real axios instance', () => {
    test('json() yields what was on the wire, however the instance is configured', async () => {
        await withServer(async (base) => {
            for (const [label, config] of INSTANCES) {
                const client = createAxiosHttpClient(axios.create(config));
                for (const [path, expected] of Object.entries(MEANS)) {
                    const res = await client(base + path);
                    assert.deepEqual(await res.json(), expected, `${label} ${path}`);
                }
            }
        });
    });

    test('json() yields what was on the wire when the instance declares how', async () => {
        await withServer(async (base) => {
            for (const [label, config, responseBody] of CUSTOM_TRANSFORMS) {
                const client = createAxiosHttpClient(axios.create(config), { responseBody });
                for (const [path, expected] of Object.entries(MEANS)) {
                    const res = await client(base + path);
                    assert.deepEqual(await res.json(), expected, `${label} ${path}`);
                }
            }
        });
    });

    test('a rejected status is read by the same declaration', async () => {
        await withServer(async (base) => {
            for (const [label, config, responseBody] of CUSTOM_TRANSFORMS) {
                const res = await createAxiosHttpClient(axios.create(config), { responseBody })(
                    `${base}/forbidden`,
                );
                assert.equal(res.status, 403, label);
                assert.deepEqual(await res.json(), { code: 'FORBIDDEN' }, label);
            }
        });
    });

    test('an instance with its own transform is read as decoding until it says otherwise', async () => {
        // Not the wire value, and deliberately so: `'auto'` reads the config,
        // and a non-empty custom pipeline is the one thing the config cannot
        // describe — it echoes exactly what a stock instance echoes. `'auto'`
        // therefore keeps axios's own reading rather than guessing against it,
        // and an instance that replaced the transform has to say so. This test
        // is what fails if `responseBody` stops being consulted.
        await withServer(async (base) => {
            const res = await createAxiosHttpClient(
                axios.create({ transformResponse: [(d) => d] }),
            )(`${base}/object`);
            assert.equal(await res.json(), '{"slug":"acme"}');
        });
    });

    test('an empty body throws, whichever instance asked for it', async () => {
        await withServer(async (base) => {
            for (const [label, config] of INSTANCES) {
                const res = await createAxiosHttpClient(axios.create(config))(`${base}/empty`);
                await assert.rejects(res.json(), SyntaxError, label);
            }
            // `'raw'` says `data` is the body as it arrived, and an empty body
            // is what `Response.json()` throws on.
            const declared = await createAxiosHttpClient(
                axios.create({ transformResponse: [(d) => d] }),
                { responseBody: 'raw' },
            )(`${base}/empty`);
            await assert.rejects(declared.json(), SyntaxError, 'responseBody raw');
        });
    });

    test('an instance that hands the body over reads `""` as the empty string', async () => {
        // Two bytes on the wire, nothing decoded them, so `data` is `'""'` and
        // parsing it gives what `Response.json()` gives.
        await withServer(async (base) => {
            for (const [label, config] of RAW) {
                const res = await createAxiosHttpClient(axios.create(config))(
                    `${base}/empty-string`,
                );
                assert.equal(await res.json(), '', label);
            }
        });
    });

    test('a declaration recovers `""` from an instance that already decoded it', async () => {
        // The declaration has to be read before the body is looked at, or the
        // empty string it produced is mistaken for no body at all.
        await withServer(async (base) => {
            for (const [label, config, responseBody] of CUSTOM_TRANSFORMS) {
                const res = await createAxiosHttpClient(axios.create(config), { responseBody })(
                    `${base}/empty-string`,
                );
                assert.equal(await res.json(), '', label);
            }
            for (const [label, config] of DECODING) {
                const res = await createAxiosHttpClient(axios.create(config), {
                    responseBody: 'decoded',
                })(`${base}/empty-string`);
                assert.equal(await res.json(), '', `${label} + decoded`);
                // And the two readers of the one body agree on it.
                assert.equal(await res.text(), '', `${label} + decoded, text()`);
            }
        });
    });

    test('`""` is the one body a decoding instance under `auto` cannot get back', async () => {
        // Named rather than papered over: axios's own transform turns both a
        // zero-byte body and the two bytes `""` into `''`, and no field of the
        // response separates them. `'auto'` answers "no body" for both, so
        // `json()` throws here exactly as it does for `/empty` — and
        // `responseBody: 'decoded'`, held by the test above, is the way out.
        await withServer(async (base) => {
            for (const [label, config] of DECODING) {
                const res = await createAxiosHttpClient(axios.create(config))(
                    `${base}/empty-string`,
                );
                await assert.rejects(res.json(), SyntaxError, label);
            }
        });
    });

    test('a body no one could decode is the text it was, where axios kept it', async () => {
        await withServer(async (base) => {
            for (const [label, config] of DECODING) {
                const res = await createAxiosHttpClient(axios.create(config))(`${base}/html`);
                assert.equal(await res.json(), '<html>Bad Gateway</html>', label);
            }
            for (const [label, config] of RAW) {
                const res = await createAxiosHttpClient(axios.create(config))(`${base}/html`);
                await assert.rejects(res.json(), SyntaxError, label);
            }
        });
    });

    test('a rejected status arrives as a response with its body readable', async () => {
        // The rejection path reads the same signal: axios attaches the merged
        // config to `err.response` too, so a raw instance parses here as well.
        await withServer(async (base) => {
            for (const [label, config] of INSTANCES) {
                const res = await createAxiosHttpClient(axios.create(config))(`${base}/forbidden`);
                assert.equal(res.status, 403, label);
                assert.deepEqual(await res.json(), { code: 'FORBIDDEN' }, label);
            }
        });
    });

    test('the prefix an instance carries as its baseURL is stripped back off', async () => {
        await withServer(async (base) => {
            const instance = axios.create({ baseURL: `${base}/` });
            const client = createAxiosHttpClient(instance, { stripPrefix: '/api/v1/' });
            const res = await client('/api/v1/object');
            assert.equal(res.status, 200);
            assert.deepEqual(await res.json(), { slug: 'acme' });
        });
    });

    test('a browser Blob body is read through the text() it exposes', () => {
        // `responseType: 'blob'` is the browser's shape of the same decision
        // `'arraybuffer'` expresses in Node, so real axios cannot produce one
        // here. The stand-in is the branch's only reachable cover: without it
        // the Blob path is code no run of this suite ever enters.
        const blob = { text: async () => '{"slug":"acme"}' };
        const { instance } = stubAxios({ data: blob, config: RAW_CONFIG });
        return createAxiosHttpClient(instance)('/x').then(async (res) => {
            assert.deepEqual(await res.json(), { slug: 'acme' });
            assert.equal(await res.text(), '{"slug":"acme"}');
        });
    });

    test('what an interceptor rewrites, the adapter can no longer judge', async () => {
        // Both directions are reproducible and neither is closable: this runs
        // after the consumer's interceptors, which can set or delete any field.
        // Pinned so the two answers are a decision on record rather than
        // whatever the predicate happens to do next.
        await withServer(async (base) => {
            // Drops `request` from a real transport failure — unbranded, and the
            // operator reads axios's own line instead of the localized one.
            //
            // `timeout`, because the failure must not depend on how the host
            // treats a closed port: CI answers `127.0.0.1:1` with a reset at
            // once, WSL2 drops the packet and the connect waits ~135 s for the
            // kernel to give up — twice in this test, which made it the whole
            // cost of the ui-vue suite. A timed-out request is the same
            // transport failure, and it carries `request` like a refused one.
            const dropping = axios.create({ timeout: 200 });
            dropping.interceptors.response.use(undefined, (err) => {
                delete err.request;
                return Promise.reject(err);
            });
            const offline = await createAxiosHttpClient(dropping)('http://127.0.0.1:1/x').then(
                () => null,
                (e) => e,
            );
            assert.equal(isTransportFailure(offline), false);

            // Builds axios's no-response shape after an answered status —
            // branded, because nothing on the object says otherwise.
            const building = axios.create();
            building.interceptors.response.use(undefined, (err) =>
                Promise.reject(
                    axios.AxiosError.from(
                        new Error('Your session expired.'),
                        'AUTH_EXPIRED',
                        err.config,
                        err.request,
                    ),
                ),
            );
            const answered = await createAxiosHttpClient(building)(`${base}/forbidden`).then(
                () => null,
                (e) => e,
            );
            assert.equal(isAxiosNoResponseError(answered), true);

            // And the way out of both: say it, and the reading stands aside.
            const declaring = axios.create({ timeout: 200 });
            declaring.interceptors.response.use(undefined, (err) => {
                delete err.request;
                return Promise.reject(markTransportFailure(err));
            });
            const declared = await createAxiosHttpClient(declaring)('http://127.0.0.1:1/x').then(
                () => null,
                (e) => e,
            );
            assert.equal(isTransportFailure(declared), true);
        });
    });

    test('a body axios delivered as bytes reads as the value those bytes spell', async () => {
        // `responseType: 'arraybuffer'` turns the decoding off the way `'text'`
        // does; the difference is the shape it hands over, not what arrived.
        await withServer(async (base) => {
            const client = createAxiosHttpClient(axios.create({ responseType: 'arraybuffer' }));
            const res = await client(`${base}/object`);
            assert.deepEqual(await res.json(), { slug: 'acme' });
            assert.equal(await res.text(), '{"slug":"acme"}');
        });
    });

    test('and the two readers of a byte body agree about it', async () => {
        // `text()` used to serialize the buffer, so it answered
        // `{"type":"Buffer","data":[123,…]}` for a body reading `{"slug":"acme"}`.
        await withServer(async (base) => {
            const client = createAxiosHttpClient(axios.create({ responseType: 'arraybuffer' }));
            const res = await client(`${base}/scalar`);
            assert.equal(await res.json(), 'ready');
            assert.equal(await res.text(), '"ready"');
        });
    });

    test('an empty byte body throws, as an empty text body does', async () => {
        await withServer(async (base) => {
            const client = createAxiosHttpClient(axios.create({ responseType: 'arraybuffer' }));
            const res = await client(`${base}/empty`);
            await assert.rejects(res.json(), SyntaxError);
        });
    });

    test('a streamed body is refused by name, not mishandled', async () => {
        // A stream is consumable once and not synchronously, so neither reader
        // can keep its promise. Handing it back satisfied the return type and
        // broke the contract: `json()` returned the stream, and `text()` threw
        // `Converting circular structure to JSON` trying to serialize it.
        await withServer(async (base) => {
            const client = createAxiosHttpClient(axios.create({ responseType: 'stream' }));
            const res = await client(`${base}/object`);
            await assert.rejects(res.json(), /responseType 'stream'/);
            await assert.rejects(res.text(), /responseType 'stream'/);
        });
    });

    test('a transform returning an object still hands that object over', async () => {
        // The byte reading must not swallow the pass-through it sits in front of.
        await withServer(async (base) => {
            const client = createAxiosHttpClient(
                axios.create({ transformResponse: [() => ({ wrapped: true })] }),
            );
            const res = await client(`${base}/object`);
            assert.deepEqual(await res.json(), { wrapped: true });
        });
    });
});

/**
 * A TCP port on the loopback interface that nothing is listening on: bound long
 * enough for the OS to name it, then released and never reused.
 *
 * A hardcoded port would be a guess about the machine running the suite. This
 * is a measurement of it.
 */
async function closedPort() {
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise((resolve) => server.close(resolve));
    return port;
}

// Which rejections carry the transport brand, driven by real axios because the
// question is entirely about what axios puts on its errors.
//
// Two review rounds asked for opposite things here. One wanted every rejection
// with no response marked, so that an offline request reaches the operator as
// "check your connection" rather than as raw error text. The other wanted an
// interceptor's replacement error left alone, so that "session expired" is not
// overwritten by a connection sentence for a request the server answered.
//
// Both cases are real, which means the predicate was reading a field that does
// not carry the fact. The measurement below is what settles it: axios states
// the answer itself, on `isAxiosError` and `request`, and the group that
// remains genuinely undecidable is the one nothing here can see — a client that
// replaced the rejection without saying which case it was in.
describe('createAxiosHttpClient — the transport brand, against real axios', () => {
    test('a genuine network failure is marked', async () => {
        const port = await closedPort();
        const client = createAxiosHttpClient(axios.create());
        await assert.rejects(client(`http://127.0.0.1:${port}/x`), (err) => {
            assert.equal(err.isAxiosError, true, 'axios produced it');
            assert.ok('request' in err, 'axios says the request was made');
            assert.equal('response' in err, false, 'and that nothing came back');
            assert.equal(isTransportFailure(err), true);
            assert.equal(toAdminError(err).transportFailure, true);
            // The diagnostic stays off `detail`, so `adminErrorMessage` reaches
            // the localized network sentence instead of `connect ECONNREFUSED
            // 127.0.0.1:45883`.
            assert.equal(toAdminError(err).detail, undefined);
            return true;
        });
    });

    test('a DNS failure and a timeout are the same fact and are marked too', async () => {
        const unresolvable = createAxiosHttpClient(axios.create());
        await assert.rejects(unresolvable('http://saasicat-does-not-exist.invalid/x'), (err) => {
            assert.equal(isTransportFailure(err), true);
            return true;
        });

        await withServer(async (base) => {
            // The server answers immediately, so the timeout has to be short
            // enough to lose the race regardless of machine speed.
            const client = createAxiosHttpClient(axios.create({ timeout: 1 }));
            const err = await client(`${base}/object`).then(
                () => null,
                (e) => e,
            );
            // A machine fast enough to answer within the millisecond has not
            // produced the case, and asserting on it would be asserting on the
            // machine.
            if (err) assert.equal(isTransportFailure(err), true, err.message);
        });
    });

    test('a network failure a rejection interceptor rethrows is still marked', async () => {
        // The interceptor chain runs before this adapter sees anything, and
        // passing the error through is what a refresh interceptor does for
        // every failure it cannot handle.
        const port = await closedPort();
        const instance = axios.create();
        instance.interceptors.response.use(undefined, (error) => Promise.reject(error));
        await assert.rejects(
            createAxiosHttpClient(instance)(`http://127.0.0.1:${port}/x`),
            (err) => {
                assert.equal(isTransportFailure(err), true);
                return true;
            },
        );
    });

    test("an interceptor's replacement error keeps its message", async () => {
        // The case the second round named: the server answered 403, the
        // interceptor handled it and rejected with its own words. Marking that
        // as a transport failure would replace "session expired" with the
        // network sentence and misdiagnose an authentication problem as a
        // cable.
        await withServer(async (base) => {
            const instance = axios.create();
            instance.interceptors.response.use(undefined, (error) =>
                error.response?.status === 403
                    ? Promise.reject(new Error('session expired'))
                    : Promise.reject(error),
            );
            await assert.rejects(createAxiosHttpClient(instance)(`${base}/forbidden`), (err) => {
                assert.equal(isTransportFailure(err), false);
                const admin = toAdminError(err);
                assert.equal(admin.transportFailure, false);
                assert.equal(admin.detail, 'session expired');
                return true;
            });
        });
    });

    test('…including when it carries axios’s config across, which is the shape that fooled the old reading', async () => {
        // `config` is echoed on every axios rejection, the 403 included, and it
        // is the field an interceptor is most likely to copy onto its
        // replacement. Reading it as "no response arrived" was true of neither.
        await withServer(async (base) => {
            const instance = axios.create();
            instance.interceptors.response.use(undefined, (error) => {
                const replacement = new Error('session expired');
                replacement.config = error.config;
                return Promise.reject(replacement);
            });
            await assert.rejects(createAxiosHttpClient(instance)(`${base}/forbidden`), (err) => {
                assert.ok(err.config, 'the fixture reproduces the shape it is about');
                assert.equal(isTransportFailure(err), false);
                assert.equal(toAdminError(err).detail, 'session expired');
                return true;
            });
        });
    });

    test('…and when it carries `request` too, which is why `isAxiosError` is read', async () => {
        // Shape-wise this is axios's no-response form exactly. What separates
        // it is that axios did not produce it — the brand axios sets on its own
        // errors is absent, and the server had in fact answered.
        await withServer(async (base) => {
            const instance = axios.create();
            instance.interceptors.response.use(undefined, (error) => {
                const replacement = new Error('session expired');
                replacement.config = error.config;
                replacement.request = error.request;
                return Promise.reject(replacement);
            });
            await assert.rejects(createAxiosHttpClient(instance)(`${base}/forbidden`), (err) => {
                assert.ok('request' in err && !('response' in err), 'the shape is reproduced');
                assert.equal(err.isAxiosError, undefined, 'but axios did not write it');
                assert.equal(isTransportFailure(err), false);
                assert.equal(toAdminError(err).detail, 'session expired');
                return true;
            });
        });
    });

    test('an interceptor rejecting with another request’s failure is that request’s answer', async () => {
        // A refresh call that itself fails carries its own response, so it
        // arrives through the response path as a status — not as a throw at
        // all. The adapter must not turn a 404 the refresh earned into a
        // connection problem.
        await withServer(async (base) => {
            const instance = axios.create();
            instance.interceptors.response.use(undefined, async (error) => {
                if (error.response?.status !== 403) return Promise.reject(error);
                try {
                    await axios.create().request({ url: `${base}/missing`, method: 'POST' });
                    return Promise.reject(error);
                } catch (refreshError) {
                    return Promise.reject(refreshError);
                }
            });
            const res = await createAxiosHttpClient(instance)(`${base}/forbidden`);
            assert.equal(res.status, 404);
            assert.deepEqual(await res.json(), { code: 'NOT_FOUND' });
        });
    });

    test('a failure while setting the request up keeps its own words', async () => {
        // axios's third group: no response and no request, because nothing was
        // ever sent. Its message names the actual fault — an unusable protocol,
        // a signal that was already aborted — and "check your connection" would
        // send the operator after a router for a configuration mistake.
        const unsupported = await createAxiosHttpClient(axios.create())(
            'ftp://example.invalid/x',
        ).then(
            () => null,
            (e) => e,
        );
        assert.ok(unsupported, 'the fixture produced no failure');
        assert.equal(isTransportFailure(unsupported), false);
        assert.match(toAdminError(unsupported).detail ?? '', /Unsupported protocol/);
    });

    test('a request interceptor that throws is not a transport failure', async () => {
        await withServer(async (base) => {
            const instance = axios.create();
            instance.interceptors.request.use(() => {
                throw new Error('no tenant selected');
            });
            await assert.rejects(createAxiosHttpClient(instance)(`${base}/object`), (err) => {
                assert.equal(isTransportFailure(err), false);
                assert.equal(toAdminError(err).detail, 'no tenant selected');
                return true;
            });
        });
    });

    test('an answered status never reaches the brand at all', async () => {
        // The response path runs first, so a 403 is a response with a readable
        // body — not a throw, marked or otherwise.
        await withServer(async (base) => {
            const res = await createAxiosHttpClient(axios.create())(`${base}/forbidden`);
            assert.equal(res.status, 403);
            assert.deepEqual(await res.json(), { code: 'FORBIDDEN' });
        });
    });

    test('the reading holds on its own, not only where the adapter calls it', async () => {
        // `isAxiosNoResponseError` is exported, so a consumer may put any
        // rejection to it — including the answered ones the adapter's response
        // branch intercepts before the question is ever asked. Without this
        // test the "and no response" half of the reading is unreachable from
        // the suite: deleting it left all 134 tests green, which is a term
        // nothing was checking.
        await withServer(async (base) => {
            const answered = await axios
                .create()
                .request({ url: `${base}/forbidden`, method: 'GET' })
                .then(
                    () => null,
                    (e) => e,
                );
            assert.equal(answered.isAxiosError, true);
            assert.equal(answered.response.status, 403);
            assert.equal(isAxiosNoResponseError(answered), false, 'the server answered');
        });

        const port = await closedPort();
        const offline = await axios
            .create()
            .request({ url: `http://127.0.0.1:${port}/x`, method: 'GET' })
            .then(
                () => null,
                (e) => e,
            );
        assert.equal(isAxiosNoResponseError(offline), true, 'nothing came back');

        // A response too damaged for the adapter to read is still a response.
        // The adapter refuses it — its branch wants a numeric status — and it
        // must not be re-read here as "the request never arrived".
        assert.equal(
            isAxiosNoResponseError({ isAxiosError: true, request: {}, response: {} }),
            false,
        );
        assert.equal(isAxiosNoResponseError(null), false);
        assert.equal(isAxiosNoResponseError('offline'), false);
    });
});
