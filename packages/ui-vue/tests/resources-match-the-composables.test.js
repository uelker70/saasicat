// The descriptors request exactly what the composables request.
//
// `usePlans` and `usePlanVersions` had no test at all — and they own twelve of
// the package's endpoints. Rebuilding them on the descriptors is meant to
// change nothing, but "meant to" is not a check, and the suite that would have
// caught a changed URL did not exist.
//
// So rather than assert a hand-written list of expected URLs twice, this drives
// both implementations with the same arguments and compares what each one puts
// on the wire. It fails if they ever disagree — in either direction, whichever
// side moved.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import {
    auditResource,
    bindResource,
    bundleVersionsResource,
    bundlesResource,
    catalogResource,
    createAdminResourceClient,
    discoveryResource,
    emailHistoryResource,
    marketingResource,
    pilotsResource,
    platformEmailResource,
    planVersionsResource,
    plansResource,
    platformResources,
    promoCodesResource,
    promotionsResource,
    subscriptionsResource,
    tenantsResource,
    useBundleVersions,
    useBundles,
    useCatalogEntries,
    useDiscovery,
    useMarketingProjections,
    usePlanVersions,
    usePlans,
    usePromotions,
    useTenants,
    usersResource,
} from '../dist/index.js';

const ADMIN_ENDPOINT = '/api/v1/admin';
const PROJECT_KEY = 'demo app';
const PLAN_ID = 'plan-1';
const VERSION_ID = 'version-9';

/** Answers everything with a body rich enough that no operation bails early. */
function recorder() {
    const calls = [];
    const http = (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body,
            headers: init?.headers,
        });
        return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            // Deliberately without `items`, `page` or `pageSize`: an echoing
            // answer would move the list's own refs, and the list cases below
            // read those refs to drive the descriptor.
            json: async () => ({ id: 'x', planVersion: { id: VERSION_ID }, warnings: [] }),
            text: async () => '{}',
        });
    };
    return { http, calls };
}

/** What the composable put on the wire for one call. */
async function viaComposable(build) {
    const { http, calls } = recorder();
    await build(http);
    return calls;
}

/** What the descriptor put on the wire for the same call. */
async function viaResource(def, op, args) {
    const { http, calls } = recorder();
    const ctx = { apiBase: ADMIN_ENDPOINT, projectKey: PROJECT_KEY, locale: 'en' };
    await bindResource(def, http, ctx)[op](...args);
    return calls;
}

function plansComposable(http) {
    return usePlans({
        adminEndpoint: ADMIN_ENDPOINT,
        projectKey: PROJECT_KEY,
        http,
        autoLoad: false,
    });
}

function versionsComposable(http) {
    return usePlanVersions({
        adminEndpoint: ADMIN_ENDPOINT,
        planId: PLAN_ID,
        http,
        autoLoad: false,
    });
}

/**
 * The request itself: where it went, how, and with what.
 *
 * Headers are left out, and not because they always match — the descriptors go
 * through `requestJson`, which sets a JSON content-type even on a GET, while
 * `useApiList` sets none. That one difference is pinned by its own test at the
 * bottom of this file rather than being swallowed here.
 */
function wire(calls) {
    return calls.map(({ url, method, body }) => ({ url, method, body }));
}

const PLAN_CASES = [
    { name: 'list', run: (c) => c.load(), op: 'list', args: [] },
    { name: 'tenantCounts', run: (c) => c.loadTenantCounts(), op: 'tenantCounts', args: [] },
    {
        // The composable makes the caller supply the project; the descriptor
        // takes it from the bound context. Same bytes on the wire — that is
        // the point of comparing here rather than asserting a URL twice.
        name: 'create',
        run: (c) => c.create({ planKey: 'pro', projectKey: PROJECT_KEY }),
        op: 'create',
        args: [{ planKey: 'pro' }],
    },
    {
        name: 'update',
        run: (c) => c.update(PLAN_ID, { name: 'Pro' }),
        op: 'update',
        args: [PLAN_ID, { name: 'Pro' }],
    },
    { name: 'softDelete', run: (c) => c.softDelete(PLAN_ID), op: 'softDelete', args: [PLAN_ID] },
    { name: 'hardDelete', run: (c) => c.hardDelete(PLAN_ID), op: 'hardDelete', args: [PLAN_ID] },
];

const VERSION_CASES = [
    { name: 'listForPlan', run: (c) => c.load(), op: 'listForPlan', args: [PLAN_ID] },
    {
        name: 'createDraft',
        run: (c) => c.createDraft({ version: 2 }),
        op: 'createDraft',
        args: [PLAN_ID, { version: 2 }],
    },
    {
        name: 'updateDraft',
        run: (c) => c.updateDraft(VERSION_ID, { price: 1 }),
        op: 'updateDraft',
        args: [VERSION_ID, { price: 1 }],
    },
    {
        name: 'publish',
        run: (c) => c.publish(VERSION_ID, { changeNote: 'note' }),
        op: 'publish',
        args: [VERSION_ID, { changeNote: 'note' }],
    },
    {
        name: 'discardDraft',
        run: (c) => c.discardDraft(VERSION_ID),
        op: 'discardDraft',
        args: [VERSION_ID],
    },
];

/** The only operation the two list descriptors declare. */
const LIST_OP = 'list';

// `auditResource` used to sit here, paired with `useAuditEntries`. It does not
// belong: that composable takes an endpoint from the app and speaks
// `AuditQuery`, the vocabulary of `AuditQueryPort` — one layer below the HTTP
// boundary. The platform's own `/admin/audit` accepts `actor`/`since`/`limit`
// and answers with a bare array, so the descriptor is not a paginated list at
// all and its counterpart is `createAdminResourceClient.loadAudit`, in FAMILIES
// below. Pairing them here was green while both sent parameters the controller
// ignores.
const LIST_RESOURCES = [
    {
        name: 'tenantsResource / useTenants',
        def: tenantsResource,
        build: (http, filter) =>
            useTenants({ endpoint: `${ADMIN_ENDPOINT}/tenants`, filter, http, autoLoad: false }),
    },
];

// Every value class the query-string rule decides about, in one filter. The
// three that are omitted and the falsy ones that are not are where a
// re-implementation diverges silently: `status=` filters every row away, and
// `page=0` is a page nobody asked for.
const EVERY_VALUE_CLASS = {
    str: 'active',
    empty: '',
    nul: null,
    undef: undefined,
    zero: 0,
    fals: false,
    encoded: 'a b&c=d',
    plus: 'a+b',
    filled: ['a', 'b'],
    emptyList: [],
};

const LIST_CASES = [
    { name: 'the first page, unfiltered', filter: {}, drive: (list) => list.reload() },
    {
        name: 'every value class in one filter',
        filter: EVERY_VALUE_CLASS,
        drive: (l) => l.reload(),
    },
    { name: 'a later page', filter: {}, drive: (list) => list.goToPage(3) },
    { name: 'a smaller page', filter: {}, drive: (list) => list.setPageSize(10) },
    { name: 'a page size past the cap', filter: {}, drive: (list) => list.setPageSize(500) },
    { name: 'a page below the first', filter: {}, drive: (list) => list.goToPage(0) },
    { name: 'a fractional page', filter: {}, drive: (list) => list.goToPage(2.7) },
    {
        // The filter is serialised after the pagination, so its `page` wins on
        // the wire while `list.page` keeps saying 3. `useResourceList` refuses
        // such a filter; the descriptor reproduces it, because reproducing what
        // goes out today is what this file measures.
        name: 'a filter that claims the pagination',
        filter: { page: 7, pageSize: 5 },
        drive: (list) => list.goToPage(3),
    },
    {
        name: 'a filter changed after paging away',
        filter: { status: 'active' },
        drive: async (list, filter) => {
            await list.goToPage(4);
            filter.value = { status: 'suspended' };
            // The filter watcher resets the page and reloads on the next tick.
            await nextTick();
        },
    },
];

/**
 * Drives the composable, and reports both what it sent and the state it ended
 * in — so the descriptor can be driven with that same state instead of with a
 * page number and a clamped size written down a second time.
 */
async function viaListComposable(resource, testCase) {
    const { http, calls } = recorder();
    const filter = ref({ ...testCase.filter });
    const list = resource.build(http, filter);
    await testCase.drive(list, filter);
    return {
        calls,
        query: { page: list.page.value, pageSize: list.pageSize.value, filter: filter.value },
    };
}

describe('the list descriptors match the list composables', () => {
    for (const resource of LIST_RESOURCES) {
        for (const testCase of LIST_CASES) {
            test(`${resource.name}: ${testCase.name}`, async () => {
                const { calls, query } = await viaListComposable(resource, testCase);
                const fromResource = await viaResource(resource.def, LIST_OP, [query]);
                // Only the last request: a case may page first and filter after,
                // and it is the request the composable ended on that the
                // descriptor is asked to reproduce.
                assert.deepEqual(wire(fromResource), wire(calls.slice(-1)));
            });
        }
    }

    test('the list operation these cases drive is the one they name', () => {
        // Narrower than it looks: it asserts the operation exists and is the
        // one being driven, not that the descriptor has no others.
        // `tenantsResource` grew `detail`, `suspend` and `reactivate` when the
        // roster was completed — they have no composable and are compared
        // against the admin client in the table below. What keeps *those*
        // covered is the derived guard at the end of this file, which reads the
        // operation list off the descriptor rather than out of a sentence here.
        for (const resource of LIST_RESOURCES) {
            assert.ok(
                Object.keys(resource.def.ops).includes(LIST_OP),
                `${resource.name} no longer declares the operation these cases drive`,
            );
        }
    });
});

describe('plansResource matches usePlans', () => {
    for (const testCase of PLAN_CASES) {
        test(`${testCase.name} sends the same request`, async () => {
            const fromComposable = await viaComposable((http) =>
                testCase.run(plansComposable(http)),
            );
            const fromResource = await viaResource(plansResource, testCase.op, testCase.args);
            assert.deepEqual(wire(fromResource), wire(fromComposable));
        });
    }
});

describe('planVersionsResource matches usePlanVersions', () => {
    for (const testCase of VERSION_CASES) {
        test(`${testCase.name} sends the same request`, async () => {
            const fromComposable = await viaComposable((http) =>
                testCase.run(versionsComposable(http)),
            );
            const fromResource = await viaResource(
                planVersionsResource,
                testCase.op,
                testCase.args,
            );
            assert.deepEqual(wire(fromResource), wire(fromComposable));
        });
    }
});

describe('the comparison itself', () => {
    test('covers every operation both sides declare', () => {
        // A case list that quietly stopped covering an operation would make
        // this whole file agree about less and less while staying green.
        assert.deepEqual(PLAN_CASES.map((c) => c.op).sort(), Object.keys(plansResource.ops).sort());
        const versionOps = Object.keys(planVersionsResource.ops).sort();
        const covered = VERSION_CASES.map((c) => c.op).sort();
        assert.deepEqual(
            versionOps.filter((op) => op !== 'terminate'),
            covered,
            'every plan-version operation except terminate, which the composable exposes ' +
                'under a different name and is compared separately',
        );
    });

    test('terminate matches too, under the composable’s own name', async () => {
        const fromComposable = await viaComposable((http) =>
            versionsComposable(http).terminateVersion(VERSION_ID, '2026-01-01'),
        );
        const fromResource = await viaResource(planVersionsResource, 'terminate', [
            VERSION_ID,
            '2026-01-01',
        ]);
        assert.deepEqual(wire(fromResource), wire(fromComposable));
    });

    test('the one header the two sides do not agree on', async () => {
        // `wire()` drops headers, so this is the difference it would otherwise
        // hide: the descriptors go through the resource layer's JSON policy,
        // which sets a content-type on every request including a GET with no
        // body, while `useApiList` sets none. Recorded rather than smoothed
        // over — a GET that declares a JSON body it does not have costs a CORS
        // preflight in a browser, and whichever way that is settled should be
        // settled deliberately.
        const { calls: fromComposable } = await viaListComposable(LIST_RESOURCES[0], {
            filter: {},
            drive: (list) => list.reload(),
        });
        const fromResource = await viaResource(tenantsResource, LIST_OP, []);

        assert.deepEqual(fromComposable[0].headers, {});
        assert.deepEqual(fromResource[0].headers, { 'content-type': 'application/json' });
    });
});

// =============================================================================
// The families added when the roster was completed.
//
// Same measurement, expressed as data: each family names the implementation it
// mirrors and one case per operation. The guard at the bottom derives what has
// to be covered from `platformResources` itself rather than from a list kept
// here, so a descriptor that grows an operation fails until a case drives it.
// =============================================================================

const BUNDLE_ID = 'bundle-3';

/** The admin client the pages receive `loadUsers`, `loadPromos`, … through. */
function adminClient(http) {
    return createAdminResourceClient({ http, adminBase: ADMIN_ENDPOINT });
}

const FAMILIES = [
    {
        name: 'bundlesResource / useBundles',
        def: bundlesResource,
        build: (http) =>
            useBundles({
                adminEndpoint: ADMIN_ENDPOINT,
                projectKey: PROJECT_KEY,
                http,
                autoLoad: false,
            }),
        cases: [
            { op: 'list', run: (c) => c.load(), args: [] },
            {
                // Same asymmetry as `plansResource.create`: the composable
                // takes the project from the caller, the descriptor from the
                // context. Identical bytes, which is what is being checked.
                op: 'create',
                run: (c) => c.create({ bundleKey: 'starter', projectKey: PROJECT_KEY }),
                args: [{ bundleKey: 'starter' }],
            },
            {
                op: 'update',
                run: (c) => c.update(BUNDLE_ID, { name: 'Starter' }),
                args: [BUNDLE_ID, { name: 'Starter' }],
            },
            { op: 'softDelete', run: (c) => c.softDelete(BUNDLE_ID), args: [BUNDLE_ID] },
        ],
    },
    {
        name: 'bundleVersionsResource / useBundleVersions',
        def: bundleVersionsResource,
        build: (http) =>
            useBundleVersions({
                adminEndpoint: ADMIN_ENDPOINT,
                bundleId: BUNDLE_ID,
                http,
                autoLoad: false,
            }),
        cases: [
            { op: 'listForBundle', run: (c) => c.load(), args: [BUNDLE_ID] },
            {
                op: 'createDraft',
                run: (c) => c.createDraft({ version: 2 }),
                args: [BUNDLE_ID, { version: 2 }],
            },
            {
                op: 'updateDraft',
                run: (c) => c.updateDraft(VERSION_ID, { price: 5 }),
                args: [VERSION_ID, { price: 5 }],
            },
            {
                // The composable reloads the list after publishing; the
                // descriptor issues the publish alone. Only the publish itself
                // is compared — see `firstCall`.
                op: 'publish',
                run: (c) => c.publish(VERSION_ID, { forceRegressive: true }),
                args: [VERSION_ID, { forceRegressive: true }],
            },
            { op: 'discardDraft', run: (c) => c.discardDraft(VERSION_ID), args: [VERSION_ID] },
        ],
    },
    {
        name: 'catalogResource / useCatalogEntries',
        def: catalogResource,
        build: (http) =>
            useCatalogEntries({
                adminEndpoint: ADMIN_ENDPOINT,
                projectKey: PROJECT_KEY,
                http,
                autoLoad: false,
            }),
        cases: [
            // `load()` fires all three list requests at once, so each of the
            // three operations is compared against its own request out of that
            // one call rather than against a separate drive.
            { op: 'capabilities', run: (c) => c.load(), args: [], pick: 0 },
            { op: 'features', run: (c) => c.load(), args: [], pick: 1 },
            { op: 'quotas', run: (c) => c.load(), args: [], pick: 2 },
            {
                op: 'reviewFeature',
                run: (c) => c.reviewFeature('notes.export', { status: 'approved' }),
                args: ['notes.export', { status: 'approved' }],
            },
            {
                op: 'reviewQuota',
                run: (c) => c.reviewQuota('notes.count', { status: 'approved' }),
                args: ['notes.count', { status: 'approved' }],
            },
            {
                op: 'setFeatureI18n',
                run: (c) => c.setFeatureI18n('notes.export', { en: { label: 'Export' } }),
                args: ['notes.export', { en: { label: 'Export' } }],
            },
            {
                op: 'setQuotaI18n',
                run: (c) => c.setQuotaI18n('notes.count', { en: { label: 'Notes' } }),
                args: ['notes.count', { en: { label: 'Notes' } }],
            },
            {
                op: 'setFeatureBase',
                run: (c) => c.setFeatureBase('notes.export', { tier: 'PRO' }),
                args: ['notes.export', { tier: 'PRO' }],
            },
            {
                op: 'setQuotaBase',
                run: (c) => c.setQuotaBase('notes.count', { tier: 'PRO' }),
                args: ['notes.count', { tier: 'PRO' }],
            },
            {
                // The composable reloads all three lists afterwards.
                op: 'syncDiscovery',
                run: (c) => c.syncDiscovery({ capabilities: [] }),
                args: [{ capabilities: [] }],
            },
        ],
    },
    {
        name: 'discoveryResource / useDiscovery',
        def: discoveryResource,
        build: (http) =>
            useDiscovery({ endpoint: `${ADMIN_ENDPOINT}/discovery`, http, autoLoad: false }),
        cases: [
            { op: 'read', run: (c) => c.load(), args: [] },
            { op: 'rescan', run: (c) => c.rescan(), args: [] },
        ],
    },
    {
        name: 'marketingResource / useMarketingProjections',
        def: marketingResource,
        build: (http) =>
            useMarketingProjections({
                adminEndpoint: ADMIN_ENDPOINT,
                filter: { projectKey: PROJECT_KEY },
                http,
                autoLoad: false,
            }),
        cases: [
            { op: 'listProjections', run: (c) => c.load(), args: [] },
            {
                // The composable reloads after creating.
                op: 'createProjection',
                run: (c) => c.create({ targetType: 'PLAN', locale: 'en' }),
                args: [{ targetType: 'PLAN', locale: 'en' }],
            },
            {
                op: 'updateProjection',
                run: (c) => c.update('proj-1', { headline: 'Hi' }),
                args: ['proj-1', { headline: 'Hi' }],
            },
            { op: 'deleteProjection', run: (c) => c.remove('proj-1'), args: ['proj-1'] },
            // No composable owns these two. `MarketingCatalogPage` builds both
            // requests inline through its own `httpClient` prop, so there is no
            // second implementation to drive — the expectation is written down
            // instead, and says so. It stops being the weaker kind of evidence
            // when the page reaches them through the registry.
            {
                op: 'settings',
                args: [],
                expect: [
                    {
                        url: `${ADMIN_ENDPOINT}/catalog/marketing-settings?projectKey=demo%20app`,
                        method: 'GET',
                        body: undefined,
                    },
                ],
            },
            {
                op: 'saveSettings',
                args: [['en', 'de']],
                expect: [
                    {
                        url: `${ADMIN_ENDPOINT}/catalog/marketing-settings`,
                        method: 'PUT',
                        body: JSON.stringify({
                            projectKey: PROJECT_KEY,
                            activeLocales: ['en', 'de'],
                        }),
                    },
                ],
            },
        ],
    },
    {
        name: 'promotionsResource / usePromotions',
        def: promotionsResource,
        build: (http) =>
            usePromotions({
                adminEndpoint: ADMIN_ENDPOINT,
                projectKey: PROJECT_KEY,
                http,
                autoLoad: false,
            }),
        cases: [
            { op: 'list', run: (c) => c.load(), args: [] },
            {
                op: 'create',
                run: (c) => c.create({ type: 'percent', value: 10 }),
                args: [{ type: 'percent', value: 10 }],
            },
            {
                op: 'update',
                run: (c) => c.update('promo-1', { value: 20 }),
                args: ['promo-1', { value: 20 }],
            },
            { op: 'remove', run: (c) => c.remove('promo-1'), args: ['promo-1'] },
        ],
    },
    {
        name: 'auditResource / createAdminResourceClient',
        def: auditResource,
        build: adminClient,
        cases: [
            {
                op: 'list',
                run: (c) =>
                    c.loadAudit({
                        actor: 'a b',
                        action: 'TENANT_SUSPENDED',
                        entity: null,
                        since: '2026-01-01',
                        limit: 50,
                    }),
                args: [
                    {
                        actor: 'a b',
                        action: 'TENANT_SUSPENDED',
                        entity: null,
                        since: '2026-01-01',
                        limit: 50,
                    },
                ],
            },
        ],
    },
    {
        name: 'promoCodesResource / createAdminResourceClient',
        def: promoCodesResource,
        build: adminClient,
        cases: [
            {
                op: 'list',
                run: (c) => c.loadPromos({ search: 'a b', status: null }),
                args: [{ search: 'a b', status: null }],
            },
            {
                op: 'create',
                run: (c) => c.createPromo({ code: 'WELCOME' }),
                args: [{ code: 'WELCOME' }],
            },
            {
                op: 'update',
                run: (c) => c.updatePromo('p 1', { status: 'PAUSED' }),
                args: ['p 1', { status: 'PAUSED' }],
            },
            { op: 'remove', run: (c) => c.deletePromo('p 1'), args: ['p 1'] },
        ],
    },
    {
        name: 'usersResource / createAdminResourceClient',
        def: usersResource,
        build: adminClient,
        cases: [
            {
                op: 'list',
                run: (c) => c.loadUsers({ q: 'a b', tenant: '' }),
                args: [{ q: 'a b', tenant: '' }],
            },
        ],
    },
    {
        name: 'subscriptionsResource / createAdminResourceClient',
        def: subscriptionsResource,
        build: adminClient,
        cases: [{ op: 'list', run: (c) => c.loadSubscriptions(), args: [] }],
    },
    {
        name: 'tenantsResource (the by-slug half) / createAdminResourceClient',
        def: tenantsResource,
        build: adminClient,
        // `list` is driven by the paginated comparison above, against
        // `useTenants`; these three have no composable and reach the pages
        // through the admin client instead.
        skipOps: ['list'],
        cases: [
            { op: 'detail', run: (c) => c.loadTenantDetail('a b'), args: ['a b'] },
            {
                op: 'suspend',
                run: (c) => c.suspendTenant('a b', 'unpaid'),
                args: ['a b', 'unpaid'],
            },
            { op: 'reactivate', run: (c) => c.reactivateTenant('a b'), args: ['a b'] },
        ],
    },
];

/**
 * Which of the composable's requests this operation is compared against.
 *
 * The two sides do not send the same NUMBER of requests, and that is by
 * design rather than a mismatch to smooth over: `useCatalogEntries.load()`
 * fetches three lists at once where the descriptor has three operations, and
 * `publish`, `syncDiscovery` and `create` reload afterwards to keep the
 * composable's own refs true. A descriptor operation that issued that second
 * request would make every override inherit a reload it cannot see.
 *
 * So the case says which request it means, the descriptor is held to sending
 * exactly one, and a reload appearing on the descriptor side fails rather than
 * being absorbed.
 */
function pickComposableCall(calls, testCase) {
    const index = testCase.pick ?? 0;
    assert.ok(
        calls[index],
        `the composable sent ${calls.length} request(s); this case asks for #${index}`,
    );
    return [calls[index]];
}

for (const family of FAMILIES) {
    describe(family.name, () => {
        for (const testCase of family.cases) {
            test(`${testCase.op} sends the same request`, async () => {
                const fromResource = await viaResource(family.def, testCase.op, testCase.args);
                assert.equal(
                    fromResource.length,
                    1,
                    `${testCase.op} put ${fromResource.length} requests on the wire; ` +
                        'a descriptor operation is one request',
                );

                if (testCase.expect) {
                    // The weaker form, used where the only other implementation
                    // is written inline in a page rather than in a composable
                    // or in the admin client. It is a written-down expectation,
                    // not a differential one — named as such so nobody reads it
                    // as the same kind of evidence as the cases around it.
                    assert.deepEqual(wire(fromResource), testCase.expect);
                    return;
                }

                const fromComposable = await viaComposable((http) =>
                    testCase.run(family.build(http)),
                );
                assert.deepEqual(
                    wire(fromResource),
                    wire(pickComposableCall(fromComposable, testCase)),
                );
            });
        }
    });
}

/**
 * Operations already compared by the hand-written blocks earlier in this file.
 *
 * Listed rather than derived, because those blocks predate the table and each
 * asserts its own completeness against its descriptor — `plansResource` and
 * `planVersionsResource` in "the comparison itself", the two list descriptors
 * in "every operation those resources declare". This map only records which
 * key that older guard speaks for, so the derived check above does not report
 * them twice.
 */
const COVERED_BY_THE_OLDER_COMPARISONS = {
    // Four descriptors the platform ships and does NOT serve — pilots, SMTP
    // providers, the send log, and the two user-lifecycle writes. This file
    // works by driving a descriptor and a second implementation of the same
    // contract and comparing the requests; for these there is no second
    // implementation, which is the reason they exist. They are measured in
    // `tests/app-served-resources.test.js`, which pins the request each one
    // issues — and that file carries its own completeness assertion per
    // descriptor, so an operation added here still cannot ship unmeasured.
    // The dashboard's endpoint comes off the manifest card rather than from
    // `apiBase`, so there is no second implementation to compare against — the
    // page that used to hold one now asks the descriptor.
    dashboard: ['kpi'],
    pilots: Object.keys(pilotsResource.ops),
    platformEmail: Object.keys(platformEmailResource.ops),
    emailHistory: Object.keys(emailHistoryResource.ops),
    // Two more of the same kind, on descriptors the platform DOES otherwise
    // serve: `promoCodes.detail` and the two user-lifecycle writes have no
    // route in the platform's own admin controller. Same file, same reason.
    promoCodes: ['detail'],
    users: ['resetPassword', 'deactivate'],
    plans: Object.keys(plansResource.ops),
    planVersions: Object.keys(planVersionsResource.ops),
    tenants: [LIST_OP],
};

describe('the comparison covers the whole roster', () => {
    // The expectation is derived from `platformResources`, not written down
    // beside it. A descriptor added without a case, or an operation added to an
    // existing descriptor, fails here rather than shipping unmeasured.
    const drivenOps = new Map();
    for (const family of FAMILIES) {
        const driven = drivenOps.get(family.def) ?? new Set();
        for (const op of family.cases) driven.add(op.op);
        for (const op of family.skipOps ?? []) driven.add(op);
        drivenOps.set(family.def, driven);
    }
    for (const [key, def] of Object.entries(platformResources)) {
        test(`${key}: every operation is driven by a case`, () => {
            const driven = drivenOps.get(def) ?? new Set();
            const declared = Object.keys(def.ops);
            // `plans`, `planVersions` and `tenants.list` are driven by the
            // hand-written comparisons above; they carry their own completeness
            // assertions and are exempt only where one exists.
            const coveredElsewhere = COVERED_BY_THE_OLDER_COMPARISONS[key] ?? [];
            const missing = declared.filter(
                (op) => !driven.has(op) && !coveredElsewhere.includes(op),
            );
            assert.deepEqual(missing, [], `${key} has operations no case drives`);
        });
    }
});
