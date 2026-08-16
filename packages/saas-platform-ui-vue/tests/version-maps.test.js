// useLivePlanVersions and useBundleVersionsMap — the two 1+N loaders that turn
// a list of catalog roots into a per-root mapping of versions.
//
// They came up while giving the catalog seams their "did the server answer"
// precondition and were deliberately left alone: neither reads an absent body
// as an empty response, so neither carries the sentinel this change is about.
// What they do carry is a per-item fallback — one failing root must not blank
// the mapping for the others — and a watcher that decides when to reload at
// all. Both are behaviour a page depends on and neither had a test, so the
// boundary of the change is pinned here rather than left to be re-derived.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTick, ref } from 'vue';

import { useBundleVersionsMap, useLivePlanVersions } from '../dist/index.js';

const ADMIN = '/api/v1/admin';

/** Answers per URL suffix; anything unlisted is a 500. */
function httpByPath(byPath) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, headers: init?.headers });
        const key = Object.keys(byPath).find((path) => url.endsWith(path));
        const answer = key ? byPath[key] : { status: 500, body: null };
        return Promise.resolve({
            status: answer.status ?? 200,
            headers: { get: () => null },
            json: async () => {
                if (answer.unparseable) throw new SyntaxError('Unexpected end of JSON input');
                return answer.body;
            },
            text: async () => JSON.stringify(answer.body),
        });
    };
    return { http, calls };
}

/** A published, un-superseded version — the shape "live" is picked from. */
const live = (id, version, validFrom) => ({
    id,
    version,
    validFrom,
    publishedAt: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
});

/** Lets the watcher's own refresh run to completion. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Silences the deliberate per-item `console.warn` while a case runs. */
async function withoutWarnings(run) {
    const original = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
        return { result: await run(), warnings };
    } finally {
        console.warn = original;
    }
}

describe('useLivePlanVersions', () => {
    test('the endpoint and the plan list are both required', () => {
        assert.throws(() => useLivePlanVersions({ plans: ref([]) }), /adminEndpoint/);
        assert.throws(() => useLivePlanVersions({ adminEndpoint: ADMIN }), /plans/);
    });

    test('an empty plan list asks nothing', async () => {
        const { http, calls } = httpByPath({});
        const view = useLivePlanVersions({ adminEndpoint: ADMIN, plans: ref([]), http });
        await nextTick();
        assert.equal(calls.length, 0);
        assert.deepEqual(view.livePlanVersions.value, {});
    });

    test('the live version is the newest published one that was not superseded', async () => {
        const { http, calls } = httpByPath({
            '/plans/p1/versions': {
                body: [
                    live('v1', 1, '2026-01-01'),
                    live('v2', 2, '2026-06-01'),
                    { ...live('v3', 3, '2026-09-01'), supersededAt: '2026-10-01' },
                    { id: 'v4', version: 4, validFrom: '2026-12-01', publishedAt: null },
                ],
            },
        });
        const view = useLivePlanVersions({
            adminEndpoint: ADMIN,
            plans: ref([{ id: 'p1', planKey: 'pro' }]),
            http,
            getAuthToken: () => 'tok',
        });
        await view.refresh();
        assert.equal(calls[0].headers.Authorization, 'Bearer tok');
        assert.equal(view.livePlanVersions.value.pro.id, 'v2');
        assert.equal(view.error.value, null);
        assert.equal(view.loading.value, false);
    });

    test('two versions activated on the same day are ordered by version number', async () => {
        const { http } = httpByPath({
            '/plans/p1/versions': {
                body: [live('v1', 1, '2026-01-01'), live('v2', 2, '2026-01-01')],
            },
        });
        const view = useLivePlanVersions({
            adminEndpoint: ADMIN,
            plans: ref([{ id: 'p1', planKey: 'pro' }]),
            http,
        });
        await view.refresh();
        assert.equal(view.livePlanVersions.value.pro.id, 'v2');
    });

    test('a plan with no published version maps to null, not to a missing key', async () => {
        const { http } = httpByPath({
            '/plans/p1/versions': { body: [{ id: 'v1', version: 1, publishedAt: null }] },
            '/plans/p2/versions': { body: [] },
        });
        const view = useLivePlanVersions({
            adminEndpoint: ADMIN,
            plans: ref([
                { id: 'p1', planKey: 'pro' },
                { id: 'p2', planKey: 'free' },
            ]),
            http,
        });
        await view.refresh();
        assert.deepEqual(view.livePlanVersions.value, { pro: null, free: null });
    });

    test('one failing plan does not blank the others', async () => {
        const { http } = httpByPath({
            '/plans/p1/versions': { body: [live('v1', 1, '2026-01-01')] },
            '/plans/p2/versions': { status: 500, body: null },
        });
        const view = useLivePlanVersions({
            adminEndpoint: ADMIN,
            plans: ref([
                { id: 'p1', planKey: 'pro' },
                { id: 'p2', planKey: 'free' },
            ]),
            http,
        });
        // The watcher already fired one refresh on creation; let it finish, so
        // the count below belongs to the explicit call alone.
        await settled();
        const { warnings } = await withoutWarnings(() => view.refresh());
        assert.equal(view.livePlanVersions.value.pro.id, 'v1');
        assert.equal(view.livePlanVersions.value.free, null);
        assert.equal(view.error.value, null, 'a per-plan failure is not a page-level error');
        assert.equal(warnings.length, 1, 'but it is not silent either');
    });

    test('an unreadable body is treated as no versions', async () => {
        const { http } = httpByPath({ '/plans/p1/versions': { unparseable: true } });
        const view = useLivePlanVersions({
            adminEndpoint: ADMIN,
            plans: ref([{ id: 'p1', planKey: 'pro' }]),
            http,
        });
        await view.refresh();
        assert.equal(view.livePlanVersions.value.pro, null);
    });

    test('a changed plan list reloads on its own; an unchanged one does not', async () => {
        const { http, calls } = httpByPath({
            '/plans/p1/versions': { body: [] },
            '/plans/p2/versions': { body: [] },
        });
        const plans = ref([{ id: 'p1', planKey: 'pro' }]);
        useLivePlanVersions({ adminEndpoint: ADMIN, plans, http });
        await nextTick();
        assert.equal(calls.length, 1);

        // Same IDs in a new array: nothing changed that a reload would reveal.
        plans.value = [{ id: 'p1', planKey: 'pro' }];
        await nextTick();
        assert.equal(calls.length, 1);

        plans.value = [...plans.value, { id: 'p2', planKey: 'free' }];
        await nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(calls.length, 3);
    });
});

describe('useBundleVersionsMap', () => {
    test('the endpoint and the bundle list are both required', () => {
        assert.throws(() => useBundleVersionsMap({ bundles: ref([]) }), /adminEndpoint/);
        assert.throws(() => useBundleVersionsMap({ adminEndpoint: ADMIN }), /bundles/);
    });

    test('an empty bundle list asks nothing and holds an empty mapping', async () => {
        const { http, calls } = httpByPath({});
        const view = useBundleVersionsMap({ adminEndpoint: ADMIN, bundles: ref([]), http });
        await nextTick();
        assert.equal(calls.length, 0);
        assert.deepEqual(view.versionsByBundle.value, {});
    });

    test('every bundle gets its list, keyed by id', async () => {
        const { http, calls } = httpByPath({
            '/bundles/b1/versions': { body: [{ id: 'bv1' }] },
            '/bundles/b2/versions': { body: [] },
        });
        const view = useBundleVersionsMap({
            adminEndpoint: ADMIN,
            bundles: ref([
                { id: 'b1', bundleKey: 'starter' },
                { id: 'b2', bundleKey: 'extra' },
            ]),
            http,
            getAuthToken: () => 'tok',
        });
        await view.refresh();
        assert.equal(calls[0].headers.Authorization, 'Bearer tok');
        assert.deepEqual(view.versionsByBundle.value, { b1: [{ id: 'bv1' }], b2: [] });
    });

    test('a bundle whose versions fail gets an empty list, not a missing key', async () => {
        const { http } = httpByPath({
            '/bundles/b1/versions': { body: [{ id: 'bv1' }] },
            '/bundles/b2/versions': { status: 404, body: null },
        });
        const view = useBundleVersionsMap({
            adminEndpoint: ADMIN,
            bundles: ref([
                { id: 'b1', bundleKey: 'starter' },
                { id: 'b2', bundleKey: 'extra' },
            ]),
            http,
        });
        await settled();
        const { warnings } = await withoutWarnings(() => view.refresh());
        assert.deepEqual(view.versionsByBundle.value, { b1: [{ id: 'bv1' }], b2: [] });
        assert.equal(view.error.value, null);
        assert.equal(warnings.length, 1);
    });

    test('an unreadable body becomes an empty list', async () => {
        const { http } = httpByPath({ '/bundles/b1/versions': { unparseable: true } });
        const view = useBundleVersionsMap({
            adminEndpoint: ADMIN,
            bundles: ref([{ id: 'b1', bundleKey: 'starter' }]),
            http,
        });
        await view.refresh();
        assert.deepEqual(view.versionsByBundle.value, { b1: [] });
    });

    test('refreshOne() replaces one entry and leaves the rest as they were', async () => {
        const answers = {
            '/bundles/b1/versions': { body: [{ id: 'bv1' }] },
            '/bundles/b2/versions': { body: [{ id: 'bv2' }] },
        };
        const { http } = httpByPath(answers);
        const view = useBundleVersionsMap({
            adminEndpoint: ADMIN,
            bundles: ref([
                { id: 'b1', bundleKey: 'starter' },
                { id: 'b2', bundleKey: 'extra' },
            ]),
            http,
        });
        await view.refresh();
        answers['/bundles/b2/versions'] = { body: [{ id: 'bv2' }, { id: 'bv3' }] };
        await view.refreshOne('b2');
        assert.deepEqual(view.versionsByBundle.value, {
            b1: [{ id: 'bv1' }],
            b2: [{ id: 'bv2' }, { id: 'bv3' }],
        });
    });

    test('a failing refreshOne() leaves the previous entry standing', async () => {
        const answers = { '/bundles/b1/versions': { body: [{ id: 'bv1' }] } };
        const { http } = httpByPath(answers);
        const view = useBundleVersionsMap({
            adminEndpoint: ADMIN,
            bundles: ref([{ id: 'b1', bundleKey: 'starter' }]),
            http,
        });
        await view.refresh();
        answers['/bundles/b1/versions'] = { status: 500, body: null };
        const { warnings } = await withoutWarnings(() => view.refreshOne('b1'));
        assert.deepEqual(view.versionsByBundle.value, { b1: [{ id: 'bv1' }] });
        assert.equal(warnings.length, 1);
    });
});
