// Test: useTenantBilling + useTenantBillingCatalog build endpoint URLs
// correctly TOGETHER with the app HTTP adapter — prevents the bug class
// "doubled /api prefix" (`/api/api/billing/usage` HTTP 404).
//
// Convention: the HTTP adapter sets the app API base URL (e.g. `/api`
// or `/api/v1`), `apiPrefix` is the sub-path below it
// (default `/billing`). The composable calls `http(apiPrefix + path)` —
// the adapter prepends its baseURL.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { useTenantBilling, useTenantBillingCatalog } from '../dist/index.js';

function makeRecordingHttp() {
    const calls = [];
    const fakeResponse = {
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => '',
    };
    return {
        calls,
        client: async (url, init) => {
            calls.push({ url, method: init?.method ?? 'GET' });
            return fakeResponse;
        },
    };
}

describe('useTenantBilling URL construction', () => {
    test('default apiPrefix is /billing (no /api prefix → no doubling)', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.reload();
        assert.equal(calls[0].url, '/billing/usage');
    });

    test('custom apiPrefix /api/v1/billing is used 1:1 as sub-path (no /api adapter)', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({
            http: client,
            apiPrefix: '/api/v1/billing',
            autoLoad: false,
        });
        await billing.reload();
        assert.equal(calls[0].url, '/api/v1/billing/usage');
    });

    test('trailing slash in apiPrefix is normalized (no //billing)', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({
            http: client,
            apiPrefix: '/billing/',
            autoLoad: false,
        });
        await billing.reload();
        assert.equal(calls[0].url, '/billing/usage');
    });

    test('plan preview, bundles and cancel all go under the same prefix', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.previewPlanChange('STANDARD', 'MONTHLY');
        await billing.addBundle('bv-1');
        await billing.cancelBundle('sb-1');
        await billing.previewAddBundle('bv-1');
        await billing.previewCancelBundle('sb-1');
        // Mutations automatically trigger reload() — here we only verify that
        // ALL calls land under `/billing/...` (no doubled `/api`).
        const urls = new Set(calls.map((c) => `${c.method} ${c.url}`));
        for (const expected of [
            'POST /billing/plan/preview',
            'POST /billing/subscription-bundles',
            'DELETE /billing/subscription-bundles/sb-1',
            'POST /billing/subscription-bundles/preview',
        ]) {
            assert.ok(urls.has(expected), `Expected URL not called: ${expected}`);
        }
        // Defensive: no URL starts with /api/api or doubles /billing.
        for (const url of urls) {
            assert.ok(!url.includes('/api/api/'), `Doubled /api prefix in URL: ${url}`);
            assert.ok(!url.match(/\/billing\/billing\//), `Doubled /billing prefix in URL: ${url}`);
        }
    });
});

describe('useTenantBillingCatalog URL construction', () => {
    test('default apiPrefix is /billing — catalog endpoints land under /billing/{plans,bundles,feature-registry}', async () => {
        const { client, calls } = makeRecordingHttp();
        const catalog = useTenantBillingCatalog({ http: client, autoLoad: false });
        await catalog.load();
        const urls = calls.map((c) => c.url).sort();
        assert.deepEqual(urls, ['/billing/bundles', '/billing/feature-registry', '/billing/plans']);
    });
});
