// The catalog composables — plans, plan versions, bundles, bundle versions,
// catalog entries, promotions, marketing projections.
//
// Seven surfaces built on the same JSON helper, and until now only reached
// through the error suite. What they share is the helper's three-way answer:
// a parsed body, `null` for "the server answered without one", and a throw for
// everything else. Each mutation below depends on which of the three it got —
// a list that grows, a row that is replaced, a reload, or a sentinel — so the
// three are what these tests drive, per surface, rather than the happy path
// alone.
//
// The empty-body sentinel and the status-0 case have their own suite in
// `admin-error.test.js`; here they appear only where a caller's local state
// must survive them.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from 'vue';

import {
    BundlesApiError,
    CatalogEntriesApiError,
    MarketingProjectionsApiError,
    PlansApiError,
    PromotionsApiError,
    useBundleVersions,
    useBundles,
    useCatalogEntries,
    useMarketingProjections,
    usePlanVersions,
    usePlans,
    usePromotions,
} from '../dist/index.js';
import { authenticating } from './support/authenticating-client.mjs';

const ADMIN = '/api/v1/admin';

/**
 * An `HttpClient` that answers each call from a queue and records what it was
 * asked. The last entry repeats, so a composable that reloads after a mutation
 * needs no extra bookkeeping in the test.
 */
function httpQueue(responses) {
    const calls = [];
    const http = (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body,
            headers: init?.headers,
        });
        const next = responses[Math.min(calls.length - 1, responses.length - 1)];
        return Promise.resolve({
            status: next.status ?? 200,
            headers: { get: () => null },
            json: async () => {
                if (next.unparseable) throw new SyntaxError('Unexpected end of JSON input');
                return next.body ?? null;
            },
            text: async () => JSON.stringify(next.body ?? null),
        });
    };
    return { http, calls };
}

/** Composables call `inject()`; `runWithContext` gives them an app to resolve against. */
const inApp = (build) => createApp({}).runWithContext(build);

const rejected = (promise) =>
    promise.then(
        () => null,
        (err) => err,
    );

describe('usePlans', () => {
    test('the endpoint is required', () => {
        assert.throws(() => usePlans({}), /adminEndpoint/);
    });

    test('load() filters by project key and sends the auth header', async () => {
        const { http, calls } = httpQueue([{ body: [{ id: 'p1', planKey: 'pro' }] }]);
        const view = inApp(() =>
            usePlans({
                adminEndpoint: ADMIN,
                http: authenticating(http, 'tok'),
            }),
        );
        await view.load();
        assert.equal(calls[0].url, `${ADMIN}/catalog/plans`);
        assert.equal(calls[0].headers.Authorization, 'Bearer tok');
        assert.deepEqual(view.plans.value, [{ id: 'p1', planKey: 'pro' }]);
        assert.equal(view.loading.value, false);
        assert.equal(view.error.value, null);
    });

    test('load() without a token sends none rather than an empty one', async () => {
        const { http, calls } = httpQueue([{ body: [] }]);
        await inApp(() => usePlans({ adminEndpoint: ADMIN, http })).load();
        assert.equal(calls[0].headers.Authorization, undefined);
    });

    test('a failed load lands on `error` and leaves the list alone', async () => {
        const { http } = httpQueue([{ status: 403, body: { code: 'FORBIDDEN' } }]);
        const view = inApp(() => usePlans({ adminEndpoint: ADMIN, http }));
        await view.load();
        assert.ok(view.error.value instanceof PlansApiError);
        assert.equal(view.error.value.status, 403);
        assert.deepEqual(view.error.value.body, { code: 'FORBIDDEN' });
        assert.deepEqual(view.plans.value, []);
        assert.equal(view.loading.value, false);
    });

    test('an unparseable error body is still an error, with no body', async () => {
        const { http } = httpQueue([{ status: 502, unparseable: true }]);
        const view = inApp(() => usePlans({ adminEndpoint: ADMIN, http }));
        await view.load();
        assert.equal(view.error.value.status, 502);
        assert.equal(view.error.value.body, null);
    });

    test('create() appends the created row', async () => {
        const { http, calls } = httpQueue([{ status: 201, body: { id: 'p2', planKey: 'team' } }]);
        const view = inApp(() => usePlans({ adminEndpoint: ADMIN, http }));
        const created = await view.create({ planKey: 'team' });
        assert.equal(calls[0].method, 'POST');
        assert.equal(calls[0].body, JSON.stringify({ planKey: 'team' }));
        assert.deepEqual(created, { id: 'p2', planKey: 'team' });
        assert.deepEqual(view.plans.value, [created]);
    });

    test('update() replaces exactly the row it changed', async () => {
        const { http, calls } = httpQueue([
            {
                body: [
                    { id: 'p1', planKey: 'pro' },
                    { id: 'p2', planKey: 'team' },
                ],
            },
            { body: { id: 'p2', planKey: 'team-renamed' } },
        ]);
        const view = inApp(() => usePlans({ adminEndpoint: ADMIN, http }));
        await view.load();
        await view.update('p2', { planKey: 'team-renamed' });
        assert.equal(calls[1].method, 'PATCH');
        assert.equal(calls[1].url, `${ADMIN}/catalog/plans/p2`);
        assert.deepEqual(view.plans.value, [
            { id: 'p1', planKey: 'pro' },
            { id: 'p2', planKey: 'team-renamed' },
        ]);
    });

    test('softDelete() and hardDelete() drop the row and hit different paths', async () => {
        for (const [name, path] of [
            ['softDelete', `${ADMIN}/catalog/plans/p1`],
            ['hardDelete', `${ADMIN}/catalog/plans/p1/purge`],
        ]) {
            const { http, calls } = httpQueue([
                { body: [{ id: 'p1' }, { id: 'p2' }] },
                { status: 204 },
            ]);
            const view = inApp(() => usePlans({ adminEndpoint: ADMIN, http }));
            await view.load();
            await view[name]('p1');
            assert.equal(calls[1].method, 'DELETE', name);
            assert.equal(calls[1].url, path, name);
            assert.deepEqual(view.plans.value, [{ id: 'p2' }], name);
        }
    });

    test('a mutation the server answered without a body does not touch the list', async () => {
        const { http } = httpQueue([{ body: [{ id: 'p1' }] }, { status: 204 }]);
        const view = inApp(() => usePlans({ adminEndpoint: ADMIN, http }));
        await view.load();

        const created = await rejected(view.create({ planKey: 'x' }));
        assert.ok(created instanceof PlansApiError);
        assert.deepEqual(view.plans.value, [{ id: 'p1' }], 'nothing was appended');

        const updated = await rejected(view.update('p1', { planKey: 'y' }));
        assert.ok(updated instanceof PlansApiError);
        assert.deepEqual(view.plans.value, [{ id: 'p1' }], 'nothing was replaced by an absent row');
    });

    test('loadTenantCounts() fills the map, and swallows its own failure', async () => {
        const ok = httpQueue([{ body: { pro: 3 } }]);
        const view = inApp(() => usePlans({ adminEndpoint: ADMIN, http: ok.http }));
        await view.loadTenantCounts();
        assert.equal(ok.calls[0].url, `${ADMIN}/catalog/plans/tenant-counts`);
        assert.deepEqual(view.tenantCountsByPlanKey.value, { pro: 3 });

        // Decorative counters must not turn a working plan list into an error
        // page — the composable documents that, so it is worth holding.
        const failing = httpQueue([{ status: 500, body: {} }]);
        const view2 = inApp(() => usePlans({ adminEndpoint: ADMIN, http: failing.http }));
        await view2.loadTenantCounts();
        assert.deepEqual(view2.tenantCountsByPlanKey.value, {});
        assert.equal(view2.error.value, null);
    });

    test('autoLoad fetches without being asked', async () => {
        const { http, calls } = httpQueue([{ body: [] }]);
        inApp(() => usePlans({ adminEndpoint: ADMIN, http, autoLoad: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 1);
    });
});

describe('usePlanVersions', () => {
    const options = (http, extra) => ({ adminEndpoint: ADMIN, planId: 'plan-1', http, ...extra });

    test('the endpoint and the plan id are both required', () => {
        assert.throws(() => usePlanVersions({ planId: 'p' }), /adminEndpoint/);
        assert.throws(() => usePlanVersions({ adminEndpoint: ADMIN }), /planId/);
    });

    test('load() reads the versions of that plan', async () => {
        const { http, calls } = httpQueue([{ body: [{ id: 'v1', version: 1 }] }]);
        const view = inApp(() => usePlanVersions(options(http)));
        await view.load();
        assert.equal(calls[0].url, `${ADMIN}/catalog/plans/plan-1/versions`);
        assert.deepEqual(view.versions.value, [{ id: 'v1', version: 1 }]);
    });

    test('a failed load says PlanVersions, not Plans', async () => {
        const { http } = httpQueue([{ status: 500, body: {} }]);
        const view = inApp(() => usePlanVersions(options(http)));
        await view.load();
        assert.match(view.error.value.message, /PlanVersions API responded with HTTP 500/);
    });

    test('createDraft() appends the new version out of the mutation result', async () => {
        const { http, calls } = httpQueue([
            { status: 201, body: { planVersion: { id: 'v2', version: 2 }, warnings: [] } },
        ]);
        const view = inApp(() => usePlanVersions(options(http)));
        const result = await view.createDraft({ version: 2 });
        assert.equal(calls[0].method, 'POST');
        assert.deepEqual(view.versions.value, [{ id: 'v2', version: 2 }]);
        assert.deepEqual(result.warnings, []);
    });

    test('updateDraft() and publish() replace the version they addressed', async () => {
        for (const [name, path, args] of [
            ['updateDraft', `${ADMIN}/catalog/plan-versions/v1`, ['v1', { note: 'x' }]],
            ['publish', `${ADMIN}/catalog/plan-versions/v1/publish`, ['v1']],
        ]) {
            const { http, calls } = httpQueue([
                { body: [{ id: 'v1', status: 'DRAFT' }] },
                { body: { planVersion: { id: 'v1', status: 'PUBLISHED' } } },
            ]);
            const view = inApp(() => usePlanVersions(options(http)));
            await view.load();
            await view[name](...args);
            assert.equal(calls[1].url, path, name);
            assert.deepEqual(view.versions.value, [{ id: 'v1', status: 'PUBLISHED' }], name);
        }
    });

    test('discardDraft() removes it and terminateVersion() replaces it', async () => {
        const { http, calls } = httpQueue([
            { body: [{ id: 'v1' }, { id: 'v2' }] },
            { status: 204 },
        ]);
        const view = inApp(() => usePlanVersions(options(http)));
        await view.load();
        await view.discardDraft('v1');
        assert.equal(calls[1].method, 'DELETE');
        assert.deepEqual(view.versions.value, [{ id: 'v2' }]);

        const term = httpQueue([
            { body: [{ id: 'v2', endsAt: null }] },
            { body: { id: 'v2', endsAt: '2026-12-31' } },
        ]);
        const view2 = inApp(() => usePlanVersions(options(term.http)));
        await view2.load();
        await view2.terminateVersion('v2', '2026-12-31');
        assert.equal(term.calls[1].url, `${ADMIN}/catalog/plan-versions/v2/terminate`);
        assert.deepEqual(view2.versions.value, [{ id: 'v2', endsAt: '2026-12-31' }]);
    });

    test('every mutation that needs a body rejects when none arrives', async () => {
        const { http } = httpQueue([{ status: 204 }]);
        const view = inApp(() => usePlanVersions(options(http)));
        for (const [name, args] of [
            ['createDraft', [{}]],
            ['updateDraft', ['v1', {}]],
            ['publish', ['v1']],
            ['terminateVersion', ['v1', '2026-12-31']],
        ]) {
            const err = await rejected(view[name](...args));
            assert.ok(err instanceof PlansApiError, name);
            assert.match(err.message, /returned no body/, name);
        }
    });

    test('autoLoad fetches without being asked', async () => {
        const { http, calls } = httpQueue([{ body: [] }]);
        inApp(() => usePlanVersions(options(http, { autoLoad: true })));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 1);
    });
});

describe('useBundles', () => {
    test('the endpoint is required', () => {
        assert.throws(() => useBundles({}), /adminEndpoint/);
    });

    test('load(), create(), update() and softDelete() keep the list in step', async () => {
        const { http, calls } = httpQueue([
            { body: [{ id: 'b1', bundleKey: 'starter' }] },
            { status: 201, body: { id: 'b2', bundleKey: 'extra' } },
            { body: { id: 'b2', bundleKey: 'extra-plus' } },
            { status: 204 },
        ]);
        const view = inApp(() => useBundles({ adminEndpoint: ADMIN, http }));
        await view.load();
        await view.create({ bundleKey: 'extra' });
        assert.equal(view.bundles.value.length, 2);
        await view.update('b2', { bundleKey: 'extra-plus' });
        assert.deepEqual(view.bundles.value[1], { id: 'b2', bundleKey: 'extra-plus' });
        await view.softDelete('b1');
        assert.deepEqual(view.bundles.value, [{ id: 'b2', bundleKey: 'extra-plus' }]);
        assert.deepEqual(
            calls.map((c) => c.method),
            ['GET', 'POST', 'PATCH', 'DELETE'],
        );
    });

    test('a failed load lands on `error`', async () => {
        const { http } = httpQueue([{ status: 404, body: {} }]);
        const view = inApp(() => useBundles({ adminEndpoint: ADMIN, http }));
        await view.load();
        assert.ok(view.error.value instanceof BundlesApiError);
        assert.match(view.error.value.message, /Bundles API responded with HTTP 404/);
    });

    test('autoLoad fetches without being asked', async () => {
        const { http, calls } = httpQueue([{ body: [] }]);
        inApp(() => useBundles({ adminEndpoint: ADMIN, http, autoLoad: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 1);
    });
});

describe('useBundleVersions', () => {
    const options = (http, extra) => ({ adminEndpoint: ADMIN, bundleId: 'b1', http, ...extra });

    test('the endpoint and the bundle id are both required', () => {
        assert.throws(() => useBundleVersions({ bundleId: 'b1' }), /adminEndpoint/);
        assert.throws(() => useBundleVersions({ adminEndpoint: ADMIN }), /bundleId/);
    });

    test('createDraft() appends and updateDraft() replaces', async () => {
        const { http } = httpQueue([
            { body: [{ id: 'bv1', version: 1 }] },
            { status: 201, body: { bundleVersion: { id: 'bv2', version: 2 } } },
            { body: { bundleVersion: { id: 'bv2', version: 2, label: 'edited' } } },
        ]);
        const view = inApp(() => useBundleVersions(options(http)));
        await view.load();
        await view.createDraft({ version: 2 });
        assert.equal(view.versions.value.length, 2);
        await view.updateDraft('bv2', { label: 'edited' });
        assert.deepEqual(view.versions.value[1], { id: 'bv2', version: 2, label: 'edited' });
    });

    test('publish() reloads, because it can supersede another version', async () => {
        // The local cache cannot be patched from the answer alone: publishing
        // v2 marks v1 superseded server-side, and the composable says so by
        // fetching the list again.
        const { http, calls } = httpQueue([
            { body: { bundleVersion: { id: 'bv2', status: 'PUBLISHED' } } },
            {
                body: [
                    { id: 'bv1', status: 'SUPERSEDED' },
                    { id: 'bv2', status: 'PUBLISHED' },
                ],
            },
        ]);
        const view = inApp(() => useBundleVersions(options(http)));
        await view.publish('bv2');
        assert.equal(calls.length, 2, 'publish, then reload');
        assert.equal(calls[1].method, 'GET');
        assert.deepEqual(
            view.versions.value.map((v) => v.status),
            ['SUPERSEDED', 'PUBLISHED'],
        );
    });

    test('discardDraft() removes the version from the list', async () => {
        const { http } = httpQueue([{ body: [{ id: 'bv1' }, { id: 'bv2' }] }, { status: 204 }]);
        const view = inApp(() => useBundleVersions(options(http)));
        await view.load();
        await view.discardDraft('bv1');
        assert.deepEqual(view.versions.value, [{ id: 'bv2' }]);
    });

    test('a failed load says BundleVersions', async () => {
        const { http } = httpQueue([{ status: 500, body: {} }]);
        const view = inApp(() => useBundleVersions(options(http)));
        await view.load();
        assert.match(view.error.value.message, /BundleVersions API responded with HTTP 500/);
    });

    test('autoLoad fetches without being asked', async () => {
        const { http, calls } = httpQueue([{ body: [] }]);
        inApp(() => useBundleVersions(options(http, { autoLoad: true })));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 1);
    });
});

describe('useCatalogEntries', () => {
    const options = (http, extra) => ({ adminEndpoint: ADMIN, http, ...extra });

    test('the endpoint is required', () => {
        assert.throws(() => useCatalogEntries({}), /adminEndpoint/);
    });

    test('load() reads capabilities, features and quotas in one go', async () => {
        const { http, calls } = httpQueue([{ body: [] }]);
        const view = inApp(() => useCatalogEntries(options(http)));
        await view.load();
        assert.deepEqual(
            calls.map((c) => c.url),
            [
                `${ADMIN}/catalog/capabilities`,
                `${ADMIN}/catalog/features`,
                `${ADMIN}/catalog/quotas`,
            ],
        );
        assert.deepEqual(view.capabilities.value, []);
        assert.equal(view.error.value, null);
    });

    test('one failing request fails the load, and the lists stay empty', async () => {
        const { http } = httpQueue([{ status: 500, body: {} }]);
        const view = inApp(() => useCatalogEntries(options(http)));
        await view.load();
        assert.ok(view.error.value instanceof CatalogEntriesApiError);
        assert.deepEqual(view.features.value, []);
    });

    test('reviewFeature() and reviewQuota() replace the entry they reviewed', async () => {
        const { http, calls } = httpQueue([
            { body: [{ featureKey: 'f1', status: 'pending' }] },
            { body: [{ featureKey: 'f1', status: 'pending' }] },
            { body: [{ quotaKey: 'q1', status: 'pending' }] },
            { body: { featureKey: 'f1', status: 'approved' } },
            { body: { quotaKey: 'q1', status: 'approved' } },
        ]);
        const view = inApp(() => useCatalogEntries(options(http)));
        await view.load();
        await view.reviewFeature('f1', { status: 'approved' });
        await view.reviewQuota('q1', { status: 'approved' });
        assert.equal(calls[3].url, `${ADMIN}/catalog/features/f1/review`);
        assert.equal(calls[3].method, 'PATCH');
        assert.deepEqual(view.features.value, [{ featureKey: 'f1', status: 'approved' }]);
        assert.deepEqual(view.quotas.value, [{ quotaKey: 'q1', status: 'approved' }]);
    });

    test('the i18n and base editors address their own paths', async () => {
        const { http, calls } = httpQueue([{ body: { featureKey: 'f1' } }]);
        const view = inApp(() => useCatalogEntries(options(http)));
        await view.setFeatureI18n('f1', { en: { label: 'F' } });
        await view.setQuotaI18n('q1', { en: { label: 'Q' } });
        await view.setFeatureBase('f1', { label: 'F' });
        await view.setQuotaBase('q1', { label: 'Q' });
        assert.deepEqual(
            calls.map((c) => c.url),
            [
                `${ADMIN}/catalog/features/f1/i18n`,
                `${ADMIN}/catalog/quotas/q1/i18n`,
                `${ADMIN}/catalog/features/f1`,
                `${ADMIN}/catalog/quotas/q1`,
            ],
        );
    });

    test('every editor rejects when the answer carries no entry', async () => {
        const { http } = httpQueue([{ status: 204 }]);
        const view = inApp(() => useCatalogEntries(options(http)));
        for (const [name, args] of [
            ['reviewFeature', ['f1', {}]],
            ['reviewQuota', ['q1', {}]],
            ['setFeatureI18n', ['f1', {}]],
            ['setQuotaI18n', ['q1', {}]],
            ['setFeatureBase', ['f1', {}]],
            ['setQuotaBase', ['q1', {}]],
            ['syncDiscovery', [{ capabilities: [] }]],
        ]) {
            const err = await rejected(view[name](...args));
            assert.ok(err instanceof CatalogEntriesApiError, name);
            assert.match(err.message, /returned no body/, name);
        }
    });

    test('syncDiscovery() posts the snapshot and reloads the three lists', async () => {
        const { http, calls } = httpQueue([
            { body: { created: 1, updated: 0 } },
            { body: [{ featureKey: 'f1' }] },
        ]);
        const view = inApp(() => useCatalogEntries(options(http)));
        const result = await view.syncDiscovery({ capabilities: [] });
        assert.equal(calls[0].url, `${ADMIN}/catalog/discovery/sync`);
        assert.equal(calls[0].method, 'POST');
        assert.deepEqual(result, { created: 1, updated: 0 });
        assert.equal(calls.length, 4, 'the sync, then the three list reads');
    });

    test('autoLoad fetches without being asked', async () => {
        const { http, calls } = httpQueue([{ body: [] }]);
        inApp(() => useCatalogEntries(options(http, { autoLoad: true })));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 3);
    });
});

describe('usePromotions', () => {
    const options = (http, extra) => ({ adminEndpoint: ADMIN, http, ...extra });

    test('the endpoint is required', () => {
        assert.throws(() => usePromotions({}), /adminEndpoint/);
    });

    test('load(), create(), update() and remove() keep the list in step', async () => {
        const { http, calls } = httpQueue([
            { body: [{ id: 'pr1', label: 'Launch' }] },
            { status: 201, body: { id: 'pr2', label: 'Summer' } },
            { body: { id: 'pr2', label: 'Summer sale' } },
            { status: 204 },
        ]);
        const view = inApp(() => usePromotions(options(http)));
        await view.load();
        assert.equal(calls[0].url, `${ADMIN}/catalog/promotions`);
        await view.create({ label: 'Summer' });
        await view.update('pr2', { label: 'Summer sale' });
        assert.deepEqual(view.promotions.value[1], { id: 'pr2', label: 'Summer sale' });
        await view.remove('pr1');
        assert.deepEqual(view.promotions.value, [{ id: 'pr2', label: 'Summer sale' }]);
    });

    test('a failed load lands on `error`', async () => {
        const { http } = httpQueue([{ status: 500, body: {} }]);
        const view = inApp(() => usePromotions(options(http)));
        await view.load();
        assert.ok(view.error.value instanceof PromotionsApiError);
        assert.match(view.error.value.message, /Promotions API responded with HTTP 500/);
    });

    test('autoLoad fetches without being asked', async () => {
        const { http, calls } = httpQueue([{ body: [] }]);
        inApp(() => usePromotions(options(http, { autoLoad: true })));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 1);
    });
});

describe('useMarketingProjections', () => {
    const options = (http, extra) => ({
        adminEndpoint: ADMIN,
        filter: {},
        http,
        ...extra,
    });

    test('the endpoint is required', () => {
        assert.throws(() => useMarketingProjections({ filter: {} }), /adminEndpoint/);
    });

    test('the query string carries only the filter parts that are set', async () => {
        const bare = httpQueue([{ body: [] }]);
        await inApp(() => useMarketingProjections(options(bare.http))).load();
        assert.equal(bare.calls[0].url, `${ADMIN}/catalog/marketing-projections`);

        const full = httpQueue([{ body: [] }]);
        const view = inApp(() =>
            useMarketingProjections({
                adminEndpoint: ADMIN,
                http: full.http,
                filter: {
                    targetType: 'PLAN',
                    targetVersionId: 'v1',
                    locale: 'de',
                },
            }),
        );
        await view.load();
        assert.equal(
            full.calls[0].url,
            `${ADMIN}/catalog/marketing-projections?targetType=PLAN&targetVersionId=v1&locale=de`,
        );
    });

    test('setFilter() replaces the filter and reloads with it', async () => {
        const { http, calls } = httpQueue([{ body: [] }]);
        const view = inApp(() => useMarketingProjections(options(http)));
        await view.setFilter({ locale: 'en' });
        assert.deepEqual(view.filter.value, { locale: 'en' });
        assert.match(calls[0].url, /locale=en/);
    });

    test('create() reloads, because a new tuple can fall inside the filter', async () => {
        const { http, calls } = httpQueue([
            { status: 201, body: { id: 'm1' } },
            { body: [{ id: 'm1' }] },
        ]);
        const view = inApp(() => useMarketingProjections(options(http)));
        await view.create({ targetType: 'PLAN' });
        assert.equal(calls.length, 2, 'create, then reload');
        assert.deepEqual(view.projections.value, [{ id: 'm1' }]);
    });

    test('update() patches the row in place, remove() drops it', async () => {
        const { http, calls } = httpQueue([
            {
                body: [
                    { id: 'm1', priority: 1 },
                    { id: 'm2', priority: 2 },
                ],
            },
            { body: { id: 'm2', priority: 9 } },
            { status: 204 },
        ]);
        const view = inApp(() => useMarketingProjections(options(http)));
        await view.load();
        await view.update('m2', { priority: 9 });
        assert.equal(calls[1].url, `${ADMIN}/catalog/marketing-projections/m2`);
        assert.deepEqual(view.projections.value[1], { id: 'm2', priority: 9 });
        await view.remove('m1');
        assert.deepEqual(view.projections.value, [{ id: 'm2', priority: 9 }]);
    });

    test('a mutation without a body rejects, and create() does not reload after it', async () => {
        const { http, calls } = httpQueue([{ status: 204 }]);
        const view = inApp(() => useMarketingProjections(options(http)));
        const err = await rejected(view.create({}));
        assert.ok(err instanceof MarketingProjectionsApiError);
        assert.equal(calls.length, 1, 'the reload is only reached on success');
        assert.ok(await rejected(view.update('m1', {})));
    });

    test('a failed load lands on `error`', async () => {
        const { http } = httpQueue([{ status: 500, body: {} }]);
        const view = inApp(() => useMarketingProjections(options(http)));
        await view.load();
        assert.match(view.error.value.message, /Marketing projections API responded with HTTP 500/);
    });

    test('autoLoad fetches without being asked', async () => {
        const { http, calls } = httpQueue([{ body: [] }]);
        inApp(() => useMarketingProjections(options(http, { autoLoad: true })));
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 1);
    });
});
