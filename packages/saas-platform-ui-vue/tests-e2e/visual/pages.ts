import type { Component } from 'vue';

// The roster the baselines cover, and what each page needs to render its real
// chrome instead of an empty frame or an error banner.
//
// Data-driven on purpose: adding a page here is the only step needed to put it
// under the baseline, and the spec asserts the roster has not silently shrunk.

/** What the fixture can hand a page. */
export interface CaseContext {
    /** The stubbed HttpClient from `main.ts`. */
    http: unknown;
    adminBase: string;
}

export interface VisualCase {
    /** URL key — `?page=<id>`. Also the snapshot file name. */
    id: string;
    load: () => Promise<{ default: Component }>;
    /**
     * Props for this page.
     *
     * Several composables still read `http` from an OPTION rather than from the
     * shell (`useSuperAdminHttp()`), so the fixture has to pass it explicitly or
     * the page falls back to a real `fetch()` and renders its error banner. That
     * is the prop-vs-shell split AP3 collapses; until then it is threaded here,
     * and the baseline covers the happy path rather than an error state.
     */
    props?: (ctx: CaseContext) => Record<string, unknown>;
}

export const VISUAL_CASES: readonly VisualCase[] = [
    {
        id: 'tenants',
        load: () => import('../../src/pages-standard/TenantsPage.vue'),
        props: ({ http, adminBase }) => ({
            endpoint: `${adminBase}/tenants`,
            subtitle: 'All tenants on this installation',
            http,
            usageFields: [{ icon: 'person', field: 'users' }],
        }),
    },
    {
        id: 'audit',
        load: () => import('../../src/pages-standard/AuditPage.vue'),
        // `loadAudit` returns a plain array — the page owns paging itself.
        props: () => ({
            loadAudit: async () => [
                {
                    id: 'a-1',
                    action: 'TENANT_SUSPENDED',
                    actorEmail: 'admin@fixture.test',
                    entityType: 'Tenant',
                    entityId: 't-0001',
                    createdAt: '2026-01-10T08:30:00.000Z',
                },
            ],
        }),
    },
    {
        id: 'subscriptions',
        load: () => import('../../src/pages-standard/SubscriptionsPage.vue'),
        props: () => ({
            loadSubscriptions: async () => [
                {
                    id: 's-1',
                    tenantName: 'Northwind Ltd',
                    planKey: 'PRO',
                    status: 'ACTIVE',
                    startsAt: '2025-03-04T00:00:00.000Z',
                },
            ],
        }),
    },
    {
        id: 'dashboard',
        load: () => import('../../src/pages-standard/DashboardPage.vue'),
        props: ({ http }) => ({ http }),
    },
    {
        id: 'discovery',
        load: () => import('../../src/pages-standard/DiscoveryPage.vue'),
        // Fully prop-driven: this page receives data, it does not fetch.
        props: () => ({
            snapshot: null,
            capabilities: [],
            features: [],
            quotas: [],
            loading: false,
            error: null,
            activeLocales: ['en'],
            runDiscovery: async () => {},
        }),
    },
    {
        id: 'plans',
        load: () => import('../../src/pages-standard/PlansPage.vue'),
        props: ({ http, adminBase }) => ({
            adminEndpoint: adminBase,
            projectKey: 'fixture',
            http,
        }),
    },
    {
        id: 'login',
        load: () => import('../../src/pages-standard/SuperAdminLoginPage.vue'),
    },
    {
        id: 'manifest-error',
        load: () => import('../../src/pages-standard/AdminManifestErrorPage.vue'),
        props: () => ({ errorMessage: 'Manifest endpoint responded with HTTP 500' }),
    },
    {
        id: 'setup-wizard',
        load: () => import('../../src/pages-standard/SuperAdminSetupWizard.vue'),
    },
];

export const VISUAL_CASE_IDS = VISUAL_CASES.map((c) => c.id);
