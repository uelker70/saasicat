import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BootLoadError, BootLoader } from '../dist/index.js';

function buildHttp({ status = 200, body = {}, headers = {} } = {}) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, init });
        return Promise.resolve({
            status,
            headers: { get: (n) => headers[n.toLowerCase()] ?? null },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
    };
    return { http, calls };
}

const ENDPOINT = '/api/v1/admin/boot';

describe('BootLoader.load', () => {
    test('returns body on 200', async () => {
        const { http } = buildHttp({
            body: {
                project: {
                    key: 'demoapp',
                    displayName: 'DemoApp',
                    environment: 'development',
                },
            },
        });
        const loader = new BootLoader({ http, endpoint: ENDPOINT });
        const r = await loader.load();
        assert.equal(r.project.key, 'demoapp');
    });

    test('sends GET to the configured endpoint', async () => {
        const { http, calls } = buildHttp({ body: { project: {} } });
        const loader = new BootLoader({ http, endpoint: ENDPOINT });
        await loader.load();
        assert.equal(calls[0].url, ENDPOINT);
    });

    test('configurable endpoint', async () => {
        const { http, calls } = buildHttp({ body: { project: {} } });
        const loader = new BootLoader({ http, endpoint: '/custom/boot' });
        await loader.load();
        assert.equal(calls[0].url, '/custom/boot');
    });

    test('throws BootLoadError on non-200', async () => {
        const { http } = buildHttp({ status: 503 });
        const loader = new BootLoader({ http, endpoint: ENDPOINT });
        await assert.rejects(
            loader.load(),
            (err) => err instanceof BootLoadError && err.status === 503,
        );
    });

    test('endpoint is required: without an endpoint BootLoader throws', () => {
        const { http } = buildHttp({ body: {} });
        assert.throws(() => new BootLoader({ http }), /endpoint.*Pflicht/);
    });
});
