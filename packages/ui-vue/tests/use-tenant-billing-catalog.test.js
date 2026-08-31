// useTenantBillingCatalog — the public catalog a tenant-facing page reads
// (`GET /billing/{plans,feature-registry,bundles}`).
//
// Its JSON helper is the one `error-facts-are-declared.test.js` exempts from
// the "ask whether the server answered" rule, on the grounds that it cannot
// answer `null`: it throws for every status that is not 200, so an absent body
// never reaches a caller as a value and no empty-response sentinel stands on
// it. An exemption is a claim, so the case that would break it — a client that
// reports a transport failure by resolving with `status: 0` — is driven here.
//
// The rest is the wire translation: prices arrive as decimal strings and the
// optional fields arrive as nothing at all.

// @requirement SC-MKT-011 — The public catalogue shows base prices only
// @requirement SC-BUN-007 — An add-on with no price in the chosen rhythm is shown as unavailable

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useTenantBillingCatalog } from '../dist/index.js';

const PLANS = [{ id: 'pro', name: 'Pro', monthlyNet: 19, yearlyNet: 190 }];
const REGISTRY = { features: {} };

/** Answers per path, so the three endpoints can behave differently. */
function httpByPath(byPath) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, method: init?.method });
        const key = Object.keys(byPath).find((path) => url.endsWith(path));
        const answer = byPath[key] ?? { status: 404, body: null };
        return Promise.resolve({
            status: answer.status ?? 200,
            headers: { get: () => null },
            json: async () => answer.body,
            text: async () => JSON.stringify(answer.body),
        });
    };
    return { http, calls };
}

const catalog = (http, extra) => useTenantBillingCatalog({ http, autoLoad: false, ...extra });

describe('useTenantBillingCatalog', () => {
    test('load() reads all three endpoints under the default prefix', async () => {
        const { http, calls } = httpByPath({
            '/plans': { body: PLANS },
            '/feature-registry': { body: REGISTRY },
            '/bundles': { body: [] },
        });
        const view = catalog(http);
        await view.load();
        assert.deepEqual(
            calls.map((c) => c.url),
            ['/billing/plans', '/billing/feature-registry', '/billing/bundles'],
        );
        assert.deepEqual(view.plans.value, PLANS);
        assert.deepEqual(view.featureRegistry.value, REGISTRY);
        assert.deepEqual(view.bundles.value, []);
        assert.equal(view.error.value, null);
        assert.equal(view.loading.value, false);
    });

    test('a trailing slash in the prefix does not become a double slash', async () => {
        const { http, calls } = httpByPath({
            '/plans': { body: PLANS },
            '/feature-registry': { body: REGISTRY },
            '/bundles': { body: [] },
        });
        await catalog(http, { apiPrefix: '/api/billing///' }).load();
        assert.equal(calls[0].url, '/api/billing/plans');
    });

    test('the wire form of a bundle becomes the shape the page renders', async () => {
        const { http } = httpByPath({
            '/plans': { body: PLANS },
            '/feature-registry': { body: REGISTRY },
            '/bundles': {
                body: [
                    {
                        bundleVersionId: 'bv1',
                        bundleKey: 'extra',
                        label: 'Extra',
                        description: null,
                        features: ['notes.export'],
                        quotas: { notes: 100 },
                        monthlyNet: '19.90',
                        yearlyNet: null,
                        requiresFeatures: ['notes.core'],
                        marketing: { priceTag: 'from 19 €' },
                    },
                ],
            },
        });
        const view = catalog(http);
        await view.load();
        assert.deepEqual(view.bundles.value, [
            {
                bundleVersionId: 'bv1',
                bundleKey: 'extra',
                label: 'Extra',
                description: null,
                features: ['notes.export'],
                quotas: { notes: 100 },
                // Decimal strings on the wire, numbers in the UI.
                monthlyNet: 19.9,
                yearlyNet: null,
                requiresFeatures: ['notes.core'],
                priceTag: 'from 19 €',
            },
        ]);
    });

    test('the optional wire fields default rather than arriving as undefined', async () => {
        const { http } = httpByPath({
            '/plans': { body: PLANS },
            '/feature-registry': { body: REGISTRY },
            '/bundles': {
                body: [
                    {
                        bundleVersionId: 'bv2',
                        bundleKey: 'bare',
                        label: 'Bare',
                        description: null,
                        features: [],
                        quotas: {},
                        monthlyNet: null,
                        yearlyNet: null,
                    },
                ],
            },
        });
        const view = catalog(http);
        await view.load();
        assert.deepEqual(view.bundles.value[0].requiresFeatures, []);
        assert.equal(view.bundles.value[0].priceTag, null);
    });

    test('a missing /bundles endpoint is not fatal — the plan page still renders', async () => {
        // The documented reason the bundle read sits in its own `try`: a
        // consumer without the bundle wiring answers 404 there, and a pricing
        // page that showed an error banner for it would be wrong about the
        // plans it did load.
        const { http } = httpByPath({
            '/plans': { body: PLANS },
            '/feature-registry': { body: REGISTRY },
            '/bundles': { status: 404, body: null },
        });
        const view = catalog(http);
        await view.load();
        assert.deepEqual(view.plans.value, PLANS);
        assert.deepEqual(view.bundles.value, []);
        assert.equal(view.error.value, null);
    });

    test('a failing /plans clears what it could not load', async () => {
        const { http } = httpByPath({
            '/plans': { status: 500, body: null },
            '/feature-registry': { body: REGISTRY },
            '/bundles': { body: [] },
        });
        const view = catalog(http);
        await view.load();
        assert.ok(view.error.value instanceof Error);
        assert.match(view.error.value.message, /HTTP 500/);
        assert.equal(view.plans.value, null);
        assert.equal(view.featureRegistry.value, null);
    });

    test('a client that resolves with status 0 fails the load rather than emptying it', async () => {
        // The exemption this suite exists for: `status: 0` is not 200, so the
        // helper throws and the page shows a failure. Nothing here reads an
        // absent body as "the server answered without one", which is why this
        // seam needs no `requireServerAnswer`.
        const { http } = httpByPath({
            '/plans': { status: 0, body: null },
            '/feature-registry': { status: 0, body: null },
            '/bundles': { status: 0, body: null },
        });
        const view = catalog(http);
        await view.load();
        assert.ok(view.error.value instanceof Error);
        assert.match(view.error.value.message, /HTTP 0/);
        assert.equal(view.plans.value, null);
        assert.deepEqual(view.bundles.value, [], 'the non-fatal read still ends up empty');
    });

    test('a client that rejects is reported, not swallowed', async () => {
        const view = catalog(() => Promise.reject('down'));
        await view.load();
        assert.ok(view.error.value instanceof Error);
        assert.equal(view.error.value.message, 'down');
    });

    test('it loads on its own unless the consumer says otherwise', async () => {
        const { http, calls } = httpByPath({
            '/plans': { body: PLANS },
            '/feature-registry': { body: REGISTRY },
            '/bundles': { body: [] },
        });
        useTenantBillingCatalog({ http });
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 3);

        const quiet = httpByPath({ '/plans': { body: PLANS } });
        useTenantBillingCatalog({ http: quiet.http, autoLoad: false });
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(quiet.calls.length, 0);
    });
});
