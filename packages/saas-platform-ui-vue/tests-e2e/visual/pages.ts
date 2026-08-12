import type { Component } from 'vue';

import type { PlatformEmailProvider } from '../../src/pages-standard/platform-email.types.js';
import type { PromoRow } from '../../src/pages-standard/PromoCodesPage.vue';
import type { UserRow } from '../../src/pages-standard/UsersPage.vue';
import { FIXTURE_BUNDLES } from './fixture-data.js';

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
    {
        id: 'users',
        load: () => import('../../src/pages-standard/UsersPage.vue'),
        props: () => ({
            loadUsers: async (): Promise<UserRow[]> => [
                {
                    id: 'u-1',
                    email: 'admin@fixture.test',
                    firstName: 'Ada',
                    lastName: 'Lovelace',
                    // `role`, not `platformRole` — the page reads it for both
                    // the Role column and its `isSuperAdmin()` check.
                    role: 'SUPER_ADMIN',
                    isActive: true,
                    lastLoginAt: '2026-07-30T08:15:00.000Z',
                },
            ],
        }),
    },
    {
        id: 'promo-codes',
        load: () => import('../../src/pages-standard/PromoCodesPage.vue'),
        props: () => ({
            loadPromos: async (): Promise<PromoRow[]> => [
                {
                    id: 'p-1',
                    code: 'WELCOME20',
                    valueType: 'PERCENT',
                    value: 20,
                    status: 'ACTIVE',
                    maxRedemptions: 100,
                    // `redemptionsCount` — the table formats this field
                    // directly, so the singular spelling rendered "undefined / 100".
                    redemptionsCount: 12,
                    campaignTag: 'launch-2026',
                    validFrom: '2026-01-01',
                    validUntil: '2026-12-31',
                },
            ],
        }),
    },
    {
        id: 'pilots',
        load: () => import('../../src/pages-standard/PilotsPage.vue'),
        props: () => ({
            loadPilots: async () => [
                {
                    id: 'pil-1',
                    tenant: { id: 't-0001', slug: 'northwind', name: 'Northwind Ltd' },
                    plan: 'PRO',
                    pilotEndsAt: '2026-03-01T00:00:00.000Z',
                    pilotNote: 'Evaluation until Q1',
                    grantedBy: 'admin@fixture.test',
                    grantedAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        }),
    },
    {
        id: 'tenant-detail',
        load: () => import('../../src/pages-standard/TenantDetailPage.vue'),
        props: () => ({
            backRoute: '/admin/tenants',
            manifest: null,
            loadDetail: async () => ({
                id: 't-0001',
                name: 'Northwind Ltd',
                slug: 'northwind',
                isActive: true,
                plan: 'PRO',
                createdAt: '2025-03-04T09:00:00.000Z',
                users: [],
            }),
        }),
    },
    {
        id: 'promo-code-detail',
        load: () => import('../../src/pages-standard/PromoCodeDetailPage.vue'),
        props: () => ({
            backRoute: '/admin/promo-codes',
            loadDetail: async () => ({
                promo: {
                    id: 'p-1',
                    code: 'WELCOME20',
                    valueType: 'PERCENT',
                    value: 20,
                    status: 'ACTIVE',
                    maxRedemptions: 100,
                    redemptionCount: 12,
                    validFrom: '2026-01-01',
                    validUntil: '2026-12-31',
                },
                redemptions: [],
            }),
        }),
    },
    {
        id: 'email-history',
        load: () => import('../../src/pages-standard/EmailHistoryPage.vue'),
        props: () => ({
            loadEmails: async () => ({
                rows: [
                    {
                        id: 'e-1',
                        fromEmail: 'noreply@fixture.test',
                        toEmail: 'admin@fixture.test',
                        subject: 'Welcome',
                        status: 'SENT',
                        sentAt: '2026-01-14T10:00:00.000Z',
                        createdAt: '2026-01-14T09:59:00.000Z',
                    },
                ],
                total: 1,
            }),
            loadEmailDetail: async () => ({
                id: 'e-1',
                fromEmail: 'noreply@fixture.test',
                toEmail: 'admin@fixture.test',
                subject: 'Welcome',
                status: 'SENT',
                sentAt: '2026-01-14T10:00:00.000Z',
                createdAt: '2026-01-14T09:59:00.000Z',
                bodyHtml: '<p>Hello</p>',
            }),
            deleteEmail: async () => ({}),
            resendEmail: async () => ({ success: true }),
        }),
    },
    {
        id: 'platform-email',
        load: () => import('../../src/pages-standard/PlatformEmailPage.vue'),
        props: () => ({
            // Typed against the page's own contract on purpose. The first
            // version of this fixture set `isActive` (the tenant spelling)
            // where the page reads `active`, and left out every SMTP field —
            // so the baseline captured empty host/encryption columns and an
            // "inactive" pill, and would have accepted a page that renders
            // nothing at all.
            loadProviders: async (): Promise<PlatformEmailProvider[]> => [
                {
                    id: 'prov-1',
                    name: 'Fixture SMTP',
                    smtpHost: 'smtp.fixture.test',
                    smtpPort: 587,
                    smtpUser: 'noreply@fixture.test',
                    encryption: 'STARTTLS',
                    fromEmail: 'noreply@fixture.test',
                    fromName: 'Fixture',
                    isDefault: true,
                    active: true,
                },
            ],
            createProvider: async () => {},
            updateProvider: async () => {},
            deleteProvider: async () => {},
            testProvider: async () => {},
        }),
    },
    {
        id: 'marketing-catalog',
        load: () => import('../../src/pages-standard/MarketingCatalogPage.vue'),
        props: ({ http, adminBase }) => ({
            adminEndpoint: adminBase,
            projectKey: 'fixture',
            http,
        }),
    },
    {
        // 14 required props, ten of them functions — the page AP3 replaces.
        // Kept under baseline precisely because it is about to change the most.
        id: 'bundles',
        load: () => import('../../src/pages-standard/BundlesPage.vue'),
        props: () => ({
            projectKey: 'fixture',
            // Not `[]`. An empty list snapshots `sa-bundles__empty` and nothing
            // else, so a regression in the rows — the surfaces this page is
            // under baseline for — would leave the image untouched.
            bundles: FIXTURE_BUNDLES,
            loading: false,
            error: null,
            snapshot: null,
            load: async () => {},
            create: async () => ({ id: 'b-1', bundleKey: 'STARTER_PACK' }),
            update: async () => ({ id: 'b-1', bundleKey: 'STARTER_PACK' }),
            softDelete: async () => {},
            loadVersions: async () => [],
            createDraft: async () => ({ version: {}, warnings: [] }),
            updateDraft: async () => ({ version: {}, warnings: [] }),
            publish: async () => ({ version: {}, warnings: [] }),
            classifyDiff: () => ({ kind: 'NON_REGRESSIVE', changes: [] }),
        }),
    },
];

export const VISUAL_CASE_IDS = VISUAL_CASES.map((c) => c.id);
