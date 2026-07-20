// Test: useTenantBilling + useTenantBillingCatalog bauen Endpoint-URLs
// korrekt ZUSAMMEN mit dem App-HTTP-Adapter — verhindert die Bug-Klasse
// "doppelter /api-Prefix" (`/api/api/billing/usage` HTTP 404).
//
// Konvention: HTTP-Adapter setzt die App-API-Base-URL (z. B. `/api`
// oder `/api/v1`), `apiPrefix` ist der Sub-Pfad darunter
// (Default `/billing`). Der Composable ruft `http(apiPrefix + path)` —
// der Adapter fügt seine baseURL davor.

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

describe('useTenantBilling URL-Konstruktion', () => {
    test('Default apiPrefix ist /billing (kein /api-Prefix → keine Doppelung)', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.reload();
        assert.equal(calls[0].url, '/billing/usage');
    });

    test('Custom apiPrefix /api/v1/billing wird 1:1 als Subpath benutzt (kein /api-Adapter)', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({
            http: client,
            apiPrefix: '/api/v1/billing',
            autoLoad: false,
        });
        await billing.reload();
        assert.equal(calls[0].url, '/api/v1/billing/usage');
    });

    test('Trailing slash im apiPrefix wird normalisiert (kein //billing)', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({
            http: client,
            apiPrefix: '/billing/',
            autoLoad: false,
        });
        await billing.reload();
        assert.equal(calls[0].url, '/billing/usage');
    });

    test('Plan-Preview, Bundles und Cancel gehen alle unter dem gleichen Prefix', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.previewPlanChange('STANDARD', 'MONTHLY');
        await billing.addBundle('bv-1');
        await billing.cancelBundle('sb-1');
        await billing.previewAddBundle('bv-1');
        await billing.previewCancelBundle('sb-1');
        // Mutations triggern automatisch reload() — wir prüfen hier nur, dass
        // ALLE Aufrufe unter `/billing/...` landen (kein doppelter `/api`).
        const urls = new Set(calls.map((c) => `${c.method} ${c.url}`));
        for (const expected of [
            'POST /billing/plan/preview',
            'POST /billing/subscription-bundles',
            'DELETE /billing/subscription-bundles/sb-1',
            'POST /billing/subscription-bundles/preview',
        ]) {
            assert.ok(urls.has(expected), `Erwartete URL nicht aufgerufen: ${expected}`);
        }
        // Defensive: keine URL beginnt mit /api/api oder doppelt /billing.
        for (const url of urls) {
            assert.ok(!url.includes('/api/api/'), `Doppelter /api-Prefix in URL: ${url}`);
            assert.ok(
                !url.match(/\/billing\/billing\//),
                `Doppelter /billing-Prefix in URL: ${url}`,
            );
        }
    });
});

describe('useTenantBillingCatalog URL-Konstruktion', () => {
    test('Default apiPrefix ist /billing — Catalog-Endpoints landen unter /billing/{plans,bundles,feature-registry}', async () => {
        const { client, calls } = makeRecordingHttp();
        const catalog = useTenantBillingCatalog({ http: client, autoLoad: false });
        await catalog.load();
        const urls = calls.map((c) => c.url).sort();
        assert.deepEqual(urls, [
            '/billing/bundles',
            '/billing/feature-registry',
            '/billing/plans',
        ]);
    });
});
