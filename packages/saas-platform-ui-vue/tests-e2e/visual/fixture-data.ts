// Deterministic responses for every request the platform pages make.
//
// Small on purpose. The baselines exist to detect *style* changes, so the data
// only has to be rich enough that each page renders its real chrome — a header,
// a filter row, a table with a couple of rows, a KPI strip. More rows would
// make the snapshots larger without covering another CSS rule.
//
// Every id, date and number is fixed. Nothing here may derive from the clock.

import type { AdminManifest, BundleRow, PlanRow } from '@saasicat/types';

export const FIXTURE_MANIFEST: AdminManifest = {
    schemaVersion: 1,
    project: {
        key: 'fixture',
        displayName: 'Fixture App',
        availableLocales: ['en', 'de'],
        defaultLocale: 'en',
    },
    build: {
        platformPackageVersion: '0.0.0-fixture',
        appVersion: '0.0.0-fixture',
        manifestHash: 'sha256-fixture',
    },
    planCatalogSnapshot: {
        source: 'fixture',
        hash: 'sha256-fixture',
        currency: 'EUR',
        vatRate: 19,
        plans: [],
    },
    capabilities: {},
    navigation: { standardPages: {} },
    // Real KPI cards, not an empty list: `AdminStatistics` and `AdminKpi` are
    // exactly the primitives the token migration rewrites, so a dashboard that
    // renders its empty state would leave them uncovered.
    dashboard: {
        kpiCards: [
            {
                id: 'tenants',
                label: 'Tenants',
                endpoint: '/api/admin/dashboard/tenants',
                displayHint: { type: 'value', icon: 'apartment' },
                slotPriority: 90,
            },
            {
                id: 'active-subscriptions',
                label: 'Active subscriptions',
                endpoint: '/api/admin/dashboard/subscriptions',
                displayHint: { type: 'value+delta', icon: 'card_membership' },
                slotPriority: 80,
            },
            {
                id: 'last-scan',
                label: 'Last discovery scan',
                endpoint: '/api/admin/dashboard/last-scan',
                displayHint: { type: 'value+timestamp', icon: 'radar' },
                slotPriority: 70,
            },
        ],
    },
    tenants: { columns: [], actions: [] },
    audit: { actions: [] },
};

const TENANTS = {
    items: [
        {
            id: 't-0001',
            name: 'Northwind Ltd',
            slug: 'northwind',
            isActive: true,
            plan: 'PRO',
            createdAt: '2025-03-04T09:00:00.000Z',
        },
        {
            id: 't-0002',
            name: 'Acme Industries',
            slug: 'acme',
            isActive: false,
            plan: 'STARTER',
            createdAt: '2025-06-18T09:00:00.000Z',
        },
    ],
    total: 2,
    page: 1,
    pageSize: 25,
};

const EMPTY_LIST = { items: [], total: 0, page: 1, pageSize: 25 };

const DISCOVERY = {
    app: { name: 'Fixture App', version: '0.0.0-fixture' },
    scannedAt: '2026-01-15T12:00:00.000Z',
    capabilities: [],
    features: [],
    quotas: [],
};

const BOOT = {
    project: { key: 'fixture', displayName: 'Fixture App' },
    needsSetup: false,
    availableLocales: ['en', 'de'],
};

/**
 * One bundle and one plan, shared by the routing table and by the pages that
 * take their data as props.
 *
 * They exist because several pages render only an empty-state placeholder
 * without them — a baseline of "no data" cannot detect a regression in the
 * rows, cards and version controls that make up the page.
 */
export const FIXTURE_BUNDLES: BundleRow[] = [
    {
        id: 'b-1',
        projectKey: 'fixture',
        bundleKey: 'STARTER_PACK',
        label: 'Starter Pack',
        description: 'Everything a small team needs to get going.',
        icon: 'inventory_2',
        sortOrder: 1,
        i18n: {},
        createdAt: '2026-01-05T09:00:00.000Z',
        updatedAt: '2026-02-10T09:00:00.000Z',
        deletedAt: null,
    },
];

export const FIXTURE_PLANS: PlanRow[] = [
    {
        id: 'pl-1',
        projectKey: 'fixture',
        planKey: 'PRO',
        label: 'Pro',
        description: 'For growing teams.',
        icon: 'workspace_premium',
        sortOrder: 2,
        createdAt: '2026-01-05T09:00:00.000Z',
        updatedAt: '2026-02-10T09:00:00.000Z',
        deletedAt: null,
    },
];

/**
 * Longest-prefix routing table. Order matters: `/catalog/plans/…` must win over
 * `/catalog/plans`.
 */
const ROUTES: ReadonlyArray<readonly [string, unknown]> = [
    ['/api/admin/boot', BOOT],
    ['/api/admin/manifest', FIXTURE_MANIFEST],
    ['/api/admin/tenants', TENANTS],
    ['/api/admin/users', EMPTY_LIST],
    ['/api/admin/audit', EMPTY_LIST],
    ['/api/admin/subscriptions', EMPTY_LIST],
    ['/api/admin/discovery', DISCOVERY],
    ['/api/admin/catalog/plans/tenant-counts', {}],
    ['/api/admin/catalog/features', []],
    ['/api/admin/catalog/quotas', []],
    ['/api/admin/catalog/plans', FIXTURE_PLANS],
    ['/api/admin/catalog/bundles', FIXTURE_BUNDLES],
    ['/api/admin/catalog/entries', []],
    ['/api/admin/promo-codes', EMPTY_LIST],
    ['/api/admin/setup/status', { needsSetup: false }],
    ['/api/admin/dashboard/tenants', { value: 42 }],
    ['/api/admin/dashboard/subscriptions', { value: 17, delta: 3 }],
    ['/api/admin/dashboard/last-scan', { value: 128, timestamp: '2026-01-15T09:00:00.000Z' }],
];

/** Returns the fixture body for a URL, or `null` to answer 404. */
export function respondTo(url: string, _method: string): unknown {
    const path = url.split('?')[0].replace(/\/+$/, '');
    let best: { length: number; body: unknown } | null = null;
    for (const [prefix, body] of ROUTES) {
        if (path.startsWith(prefix) && (best === null || prefix.length > best.length)) {
            best = { length: prefix.length, body };
        }
    }
    // An unmapped endpoint answers with an empty ARRAY, not a 404 and not a
    // paginated envelope: a 404 would make the baseline about the error banner,
    // and `{ items: [] }` is not iterable — several callers spread the body
    // directly. `[]` satisfies both, since `useApiList` accepts a bare array.
    return best ? best.body : [];
}
