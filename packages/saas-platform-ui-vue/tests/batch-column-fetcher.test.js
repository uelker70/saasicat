import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchColumnDriftError, BatchColumnFetcher } from '../dist/index.js';

function buildHttp(responses = []) {
    const calls = [];
    let i = 0;
    const http = (url, init) => {
        calls.push({ url, init });
        const r = responses[i++] ?? responses[responses.length - 1] ?? { status: 200, body: {} };
        return Promise.resolve({
            status: r.status,
            headers: { get: () => null },
            json: async () => r.body,
            text: async () => JSON.stringify(r.body),
        });
    };
    return { http, calls };
}

function buildManifest(columns = [], capabilities = {}) {
    return {
        schemaVersion: 1,
        project: { key: 'cf', displayName: 'DemoApp' },
        build: {
            platformPackageVersion: '0.1.0',
            appVersion: '1.0.0',
            manifestHash: 'sha256-x',
        },
        capabilities,
        navigation: { standardPages: {} },
        tenants: { columns },
        planCatalogSnapshot: {
            source: 'config/plans.yaml',
            hash: 'h',
            currency: 'EUR',
            vatRate: 19,
            plans: [],
        },
    };
}

describe('BatchColumnFetcher.fetchAll', () => {
    test('1 request per column with comma-separated tenantIds', async () => {
        const m = buildManifest([
            {
                key: 'datev_status',
                label: 'DATEV',
                endpoint: '/api/v1/admin/extras/datev-status',
            },
            {
                key: 'unread_emails',
                label: 'E-Mails',
                endpoint: '/api/v1/admin/extras/unread',
            },
        ]);
        const { http, calls } = buildHttp([
            { status: 200, body: { t1: 'ok', t2: 'overdue' } },
            { status: 200, body: { t1: 5, t2: 0 } },
        ]);
        const fetcher = new BatchColumnFetcher({ http });
        const data = await fetcher.fetchAll(m, ['t1', 't2']);
        assert.equal(calls.length, 2);
        assert.match(calls[0].url, /tenantIds=t1,t2/);
        assert.match(calls[1].url, /tenantIds=t1,t2/);
        assert.deepEqual(data.datev_status, { t1: 'ok', t2: 'overdue' });
        assert.deepEqual(data.unread_emails, { t1: 5, t2: 0 });
    });

    test('paramStyle=repeat', async () => {
        const m = buildManifest([
            {
                key: 'k',
                label: 'K',
                endpoint: '/api/v1/admin/extras/k',
            },
        ]);
        const { http, calls } = buildHttp([{ status: 200, body: {} }]);
        const fetcher = new BatchColumnFetcher({ http, paramStyle: 'repeat' });
        await fetcher.fetchAll(m, ['t1', 't2']);
        assert.match(calls[0].url, /tenantIds=t1&tenantIds=t2/);
    });

    test('Capability filter: insufficient columns are not fetched', async () => {
        const m = buildManifest(
            [
                {
                    key: 'allowed',
                    label: 'A',
                    endpoint: '/api/v1/admin/extras/a',
                    requiredCapability: 'a:read',
                },
                {
                    key: 'forbidden',
                    label: 'F',
                    endpoint: '/api/v1/admin/extras/f',
                    requiredCapability: 'f:read',
                },
            ],
            { 'a:read': true, 'f:read': false },
        );
        const { http, calls } = buildHttp([{ status: 200, body: {} }]);
        const fetcher = new BatchColumnFetcher({ http });
        const data = await fetcher.fetchAll(m, ['t1']);
        assert.equal(calls.length, 1);
        assert.equal(Object.keys(data).length, 1);
        assert.ok('allowed' in data);
    });

    test('empty tenantIds list → empty object, no request', async () => {
        const m = buildManifest([{ key: 'k', label: 'K', endpoint: '/api/v1/admin/extras/k' }]);
        const { http, calls } = buildHttp();
        const fetcher = new BatchColumnFetcher({ http });
        const data = await fetcher.fetchAll(m, []);
        assert.equal(calls.length, 0);
        assert.deepEqual(data, {});
    });

    test('auth token is sent as a Bearer header', async () => {
        const m = buildManifest([{ key: 'k', label: 'K', endpoint: '/api/v1/admin/extras/k' }]);
        const { http, calls } = buildHttp([{ status: 200, body: {} }]);
        const fetcher = new BatchColumnFetcher({
            http,
            getAuthToken: () => 'jwt-abc',
        });
        await fetcher.fetchAll(m, ['t1']);
        assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt-abc');
    });

    test('appends correctly to an endpoint with an existing query', async () => {
        const m = buildManifest([
            { key: 'k', label: 'K', endpoint: '/api/v1/admin/extras/k?cached=1' },
        ]);
        const { http, calls } = buildHttp([{ status: 200, body: {} }]);
        const fetcher = new BatchColumnFetcher({ http });
        await fetcher.fetchAll(m, ['t1']);
        assert.match(calls[0].url, /\?cached=1&tenantIds=t1/);
    });
});

describe('BatchColumnFetcher — drift detection', () => {
    test('per-Tenant placeholder in endpoint → BatchColumnDriftError', async () => {
        const m = buildManifest([
            {
                key: 'bad',
                label: 'X',
                endpoint: '/api/v1/admin/extras/bad/{slug}',
            },
        ]);
        const fetcher = new BatchColumnFetcher();
        await assert.rejects(
            fetcher.fetchAll(m, ['t1']),
            (err) => err instanceof BatchColumnDriftError,
        );
    });

    test('listDriftIssues collects all problematic columns', () => {
        const m = buildManifest([
            { key: 'ok', label: 'OK', endpoint: '/api/v1/admin/extras/ok' },
            { key: 'bad1', label: 'B1', endpoint: '' },
            {
                key: 'bad2',
                label: 'B2',
                endpoint: '/api/v1/admin/extras/bad/{tenantId}',
            },
        ]);
        const fetcher = new BatchColumnFetcher();
        const issues = fetcher.listDriftIssues(m);
        assert.equal(issues.length, 2);
        assert.equal(issues[0].column.key, 'bad1');
        assert.equal(issues[1].column.key, 'bad2');
    });

    test('non-200 response throws an error', async () => {
        const m = buildManifest([{ key: 'k', label: 'K', endpoint: '/api/v1/admin/extras/k' }]);
        const { http } = buildHttp([{ status: 503, body: null }]);
        const fetcher = new BatchColumnFetcher({ http });
        await assert.rejects(fetcher.fetchAll(m, ['t1']), /HTTP 503/);
    });
});

describe('BatchColumnFetcher.eligibleColumns', () => {
    test('returns only columns with a satisfied Capability', () => {
        const m = buildManifest(
            [
                {
                    key: 'a',
                    label: 'A',
                    endpoint: '/a',
                    requiredCapability: 'a:read',
                },
                { key: 'b', label: 'B', endpoint: '/b' },
                {
                    key: 'c',
                    label: 'C',
                    endpoint: '/c',
                    requiredCapability: 'c:read',
                },
            ],
            { 'a:read': true, 'c:read': false },
        );
        const fetcher = new BatchColumnFetcher();
        const eligible = fetcher.eligibleColumns(m);
        const keys = eligible.map((c) => c.key).sort();
        assert.deepEqual(keys, ['a', 'b']);
    });
});
