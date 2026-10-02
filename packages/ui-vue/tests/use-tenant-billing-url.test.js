// Test: useTenantBilling + useTenantBillingCatalog build endpoint URLs
// correctly TOGETHER with the app HTTP adapter — prevents the bug class
// "doubled /api prefix" (`/api/api/billing/usage` HTTP 404).
//
// Convention: the HTTP adapter sets the app API base URL (e.g. `/api`
// or `/api/v1`), `apiPrefix` is the sub-path below it
// (default `/billing`). The composable calls `http(apiPrefix + path)` —
// the adapter prepends its baseURL.

// @requirement SC-UI-013 — A tenant-facing section can be embedded without adopting a UI framework

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
            calls.push({
                url,
                method: init?.method ?? 'GET',
                // The body too: what a client SENDS is as much a part of the
                // contract as where it sends it, and a field silently dropped
                // between a composable and the wire is invisible without this.
                body: init?.body ? JSON.parse(init.body) : undefined,
            });
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

// @requirement SC-SUB-020 — A newer version is offered, classified against the version bound
test('the version offer is read under the same prefix and answered as the offer itself', async () => {
    const offer = { plan: 'STANDARD', class: 'improvement' };
    const calls = [];
    const billing = useTenantBilling({
        http: async (url, init) => {
            calls.push(`${init?.method ?? 'GET'} ${url}`);
            return { status: 200, headers: { get: () => null }, json: async () => ({ offer }) };
        },
        apiPrefix: '/api/v1/billing',
        autoLoad: false,
    });

    assert.deepEqual(await billing.loadVersionOffer(), offer);
    assert.deepEqual(calls, ['GET /api/v1/billing/version-offer']);
});

// @requirement SC-SUB-021 — A newer version is taken by naming it, the way its kind says
test('an offer is taken by posting the version shown, and the usage reloaded after', async () => {
    const { client, calls } = makeRecordingHttp();
    const billing = useTenantBilling({ http: client, autoLoad: false });

    await billing.acceptVersionOffer('pv-2');

    assert.deepEqual(
        calls.map((c) => [c.method, c.url, c.body]),
        [
            ['POST', '/billing/version-offer/accept', { planVersionId: 'pv-2' }],
            ['GET', '/billing/usage', undefined],
            ['GET', '/billing/subscription-bundles', undefined],
        ],
    );
});

// @requirement SC-SUB-032 — A subscriber may switch to the replacement early, at no more than they paid
test('switchToReplacement posts the version shown to /billing/retirement/switch, then reloads', async () => {
    const { client, calls } = makeRecordingHttp();
    const billing = useTenantBilling({ http: client, autoLoad: false });

    await billing.switchToReplacement('pv-9');

    assert.deepEqual(
        calls.map((c) => [c.method, c.url, c.body]),
        [
            ['POST', '/billing/retirement/switch', { planVersionId: 'pv-9' }],
            ['GET', '/billing/usage', undefined],
            ['GET', '/billing/subscription-bundles', undefined],
        ],
    );
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

describe('the rhythm a bundle is booked in reaches the wire', () => {
    // The platform has accepted a bundle cycle since bundles gained one, and no
    // shipped client sent it — so a monthly-only bundle read as unpriced to
    // every tenant on a yearly plan, and the headline monthly-on-yearly flow
    // could not be completed with the composables this package ships.

    test('an explicit cycle is sent by both the preview and the booking', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.previewAddBundle('bv-1', { billingCycle: 'MONTHLY' });
        await billing.addBundle('bv-1', { billingCycle: 'MONTHLY' });

        const bodies = calls.filter((c) => c.method === 'POST').map((c) => c.body);
        assert.equal(bodies.length, 2, 'preview and booking are both POSTs');
        for (const body of bodies) {
            assert.equal(body.billingCycle, 'MONTHLY');
            assert.equal(body.bundleVersionId, 'bv-1');
        }
    });

    test('omitting it sends no field at all, so the plan’s rhythm decides', async () => {
        // Not `billingCycle: null` and not `undefined` — an absent field is how
        // the route reads "the platform decides", and a null would be a value.
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.addBundle('bv-1');

        const body = calls.find((c) => c.method === 'POST').body;
        assert.deepEqual(Object.keys(body), ['bundleVersionId']);
    });

    test('a minimum term still travels, alone or beside a cycle', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.addBundle('bv-1', { minimumTermMonths: 0 });
        await billing.addBundle('bv-2', { minimumTermMonths: 6, billingCycle: 'YEARLY' });

        const bodies = calls.filter((c) => c.method === 'POST').map((c) => c.body);
        // Zero is a value, not an absence — it says "no commitment".
        assert.equal(bodies[0].minimumTermMonths, 0);
        assert.equal(bodies[0].billingCycle, undefined);
        assert.equal(bodies[1].minimumTermMonths, 6);
        assert.equal(bodies[1].billingCycle, 'YEARLY');
    });
});

// @requirement SC-CHG-023 — A plan change binds the version its preview showed, or nothing
describe('a plan change names the version its preview showed', () => {
    test('the version goes into the body beside the plan and the rhythm', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.changePlan('PRO', 'MONTHLY', 'plv-2');
        const change = calls.find((c) => c.method === 'POST');
        assert.equal(change.url, '/billing/plan');
        assert.deepEqual(change.body, {
            plan: 'PRO',
            billingCycle: 'MONTHLY',
            planVersionId: 'plv-2',
        });
    });

    test('a change with no version to name sends none, rather than a null', async () => {
        const { client, calls } = makeRecordingHttp();
        const billing = useTenantBilling({ http: client, autoLoad: false });
        await billing.changePlan('STARTER', 'YEARLY', null);
        const change = calls.find((c) => c.method === 'POST');
        assert.deepEqual(change.body, { plan: 'STARTER', billingCycle: 'YEARLY' });
    });
});
