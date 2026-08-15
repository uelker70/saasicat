import type { Component } from 'vue';

import type { PlatformEmailProvider } from '../../src/pages-standard/platform-email.types.js';
import type { BundleVersionRow } from '@saasicat/types';
import type { PromoDetailData } from '../../src/pages-standard/PromoCodeDetailPage.vue';
import type { TenantDetailData } from '../../src/pages-standard/tenant-detail/types.js';
import type { PromoRow } from '../../src/pages-standard/PromoCodesPage.vue';
import type { UserRow } from '../../src/pages-standard/UsersPage.vue';
import {
    FIXTURE_BUNDLES,
    FIXTURE_BUNDLE_VERSIONS,
    FIXTURE_DISCOVERY,
    FIXTURE_PLAN_CHANGE_PREVIEW,
    TENANT_CATALOG_PLANS,
} from './fixture-data.js';
import {
    defaultTenantPlanSectionI18n,
    planChangeWizardI18n,
} from '../../src/pages-tenant/default-i18n.js';

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
    /**
     * CSS selectors to click before the styles are collected, in order.
     *
     * Some surfaces only exist once something is opened — a bundle's version
     * controls and inline editor sit behind its row. Without a click the
     * baseline covers the collapsed card and nothing else, so a regression in
     * exactly the surfaces the case was added for leaves the snapshot
     * untouched.
     */
    revealBy?: readonly string[];
    /**
     * Selectors to hover, one at a time, each read on its own.
     *
     * A `:hover` rule is a screen nobody screenshots and no static check can
     * pair: 60 rules in this package move a background on hover, and the ones
     * that also move a foreground do it in a DIFFERENT rule. The marketing
     * chip's `<em>` sat at 2.92:1 in the dark theme for exactly that reason —
     * `:hover` moved the surface under it and its own colour stayed put.
     *
     * Only the contrast check reads this. The baselines deliberately do not: a
     * hovered snapshot would record one arbitrary pointer position as the
     * truth, which is the opposite of what a baseline is for.
     */
    hoverBy?: readonly string[];
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
        //
        // Still empty, and knowingly so. This page records a baseline of empty
        // states, exactly like `bundles` did — but its `capabilities`,
        // `features` and `quotas` are CATALOG ROWS, not the snapshot's
        // `Discovered*` shapes, so it needs its own fixture rather than the one
        // next door. Filling it with the snapshot's arrays took the page down
        // (it never reached `data-visual-ready`), and `props` is typed
        // `Record<string, unknown>`, so `pnpm typecheck` said nothing — which
        // is the same hole that let this case ship with six missing required
        // props. Both belong in the follow-up, together.
        props: () => ({
            snapshot: null,
            capabilities: [],
            features: [],
            quotas: [],
            loading: false,
            error: null,
            activeLocales: ['en'],
            runDiscovery: async () => {},
            // Six required props this case never supplied. The page rendered
            // anyway — Vue warns and passes `undefined` — so every review
            // dialog and every save button under this baseline was wired to
            // nothing, for as long as the case has existed.
            reviewFeature: async () => ({}),
            reviewQuota: async () => ({}),
            setFeatureI18n: async () => ({}),
            setQuotaI18n: async () => ({}),
            setFeatureBase: async () => ({}),
            setQuotaBase: async () => ({}),
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
            loadDetail: async (): Promise<TenantDetailData> => ({
                id: 't-0001',
                name: 'Northwind Ltd',
                slug: 'northwind',
                isActive: true,
                vatId: 'DE123456789',
                // Nested, not top-level: TenantMasterData reads
                // `data.subscription?.plan` and friends, so a flat `plan`
                // rendered an em dash in every one of those fields.
                subscription: {
                    plan: 'PRO',
                    status: 'ACTIVE',
                    isPilot: false,
                    trialEndsAt: null,
                    pilotEndsAt: null,
                },
                users: [],
            }),
        }),
    },
    {
        id: 'promo-code-detail',
        load: () => import('../../src/pages-standard/PromoCodeDetailPage.vue'),
        props: () => ({
            backRoute: '/admin/promo-codes',
            loadDetail: async (): Promise<PromoDetailData> => ({
                promo: {
                    id: 'p-1',
                    code: 'WELCOME20',
                    valueType: 'PERCENT',
                    value: 20,
                    status: 'ACTIVE',
                    maxRedemptions: 100,
                    redemptionsCount: 12,
                    validFrom: '2026-01-01',
                    validUntil: '2026-12-31',
                },
                // Required. The page serialises this block, so leaving it out
                // baselined an empty one — an invalid response recorded as if
                // it were the design.
                stats: {
                    redemptions: 12,
                    remaining: 88,
                    discountedNetTotal: '240.00',
                    firstRedeemedAt: '2026-01-08T10:00:00.000Z',
                    lastRedeemedAt: '2026-02-19T16:30:00.000Z',
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
        // Opens the detail dialog — `@row-click` on the table. Without it
        // `loadEmailDetail` never runs and the dialog, its preview frame and
        // its actions stay out of the snapshot.
        revealBy: ['tbody tr'],
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
            // Without it the page falls back to a `['de']` pool, filters the
            // settings response down to German, and renders the English
            // projections as the German catalog — with the second locale's
            // controls missing entirely.
            availableLocales: ['en', 'de'],
        }),
    },
    {
        // The same page on its other tab. Two cases rather than one with a
        // click, because the preview is what the page opens on and both halves
        // carry styles worth protecting — `MarketingCatalogAdmin` is only
        // mounted once the tab is selected, so a single case can cover one or
        // the other, never both.
        id: 'marketing-catalog-admin',
        load: () => import('../../src/pages-standard/MarketingCatalogPage.vue'),
        props: ({ http, adminBase }) => ({
            adminEndpoint: adminBase,
            projectKey: 'fixture',
            http,
            availableLocales: ['en', 'de'],
        }),
        // Ordered: the tab mounts the admin view, the expand button mounts
        // its editors. Stopping after the tab left every editor guarded by
        // `expandedKey` unrendered — the surfaces this case exists for.
        revealBy: ['.sa-marketing-tab:nth-of-type(2)', '.sa-marketing-expand-btn'],
        // The chip whose `<em>` measured 2.92:1 in the dark theme — `:hover`
        // moved the surface to a 22 % accent tint and the `<em>` kept its own
        // colour. It is fixed; this is what stops it coming back.
        hoverBy: ['.sa-marketing-tf-chip'],
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
            // Not `null`, for the same reason `bundles` is not `[]` — one level
            // in. The editors bind `snapshot?.features ?? []`, so a null
            // snapshot renders `bd-features-empty` and no feature pill has ever
            // existed under a baseline. The 2.92:1 reading on
            // `.bd-feature-pill.on .bd-feature-key` came from a human looking at
            // a screen this suite could not reach.
            snapshot: FIXTURE_DISCOVERY,
            load: async () => {},
            create: async () => ({ id: 'b-1', bundleKey: 'STARTER_PACK' }),
            update: async () => ({ id: 'b-1', bundleKey: 'STARTER_PACK' }),
            softDelete: async () => {},
            loadVersions: async (): Promise<BundleVersionRow[]> => FIXTURE_BUNDLE_VERSIONS,
            createDraft: async () => ({ version: {}, warnings: [] }),
            updateDraft: async () => ({ version: {}, warnings: [] }),
            publish: async () => ({ version: {}, warnings: [] }),
            classifyDiff: () => ({ kind: 'NON_REGRESSIVE', changes: [] }),
        }),
        // Opens the bundle so its version controls and inline editor render.
        revealBy: ['.sa-bd-card__head'],
        // The feature pill, which only exists at all since this case got a
        // discovery snapshot. `.bd-feature-pill:hover:not(:disabled)` moves its
        // background while the label and the key keep theirs.
        hoverBy: ['.bd-feature-pill'],
    },
    // ── Tenant-facing. These render in the CONSUMER's app, not in the admin
    // shell, and nothing in this suite reached them before. Three defects in a
    // single review round had exactly that as their root cause — a state no
    // fixture renders. Each case below is chosen for the branch that hid:
    // `currentPlanId` for the inverted "current plan" flag (1.48:1 in dark),
    // a pending version for the banner behind its `v-if`, and a dialog for the
    // teleported portal.
    {
        id: 'tenant-plan',
        load: () => import('../../src/pages-tenant/TenantPlanSection.vue'),
        props: ({ http }) => ({
            http,
            apiPrefix: '/api/billing',
            formatCurrency: (n: number) => `€ ${n.toFixed(2)}`,
            formatDate: (iso: string | Date) => String(iso).slice(0, 10),
            quotaLabel: (key: string) => key,
            featureLabel: (key: string) => key,
        }),
    },
    {
        id: 'tenant-bundles',
        load: () => import('../../src/pages-tenant/MySubscriptionBundlesPage.vue'),
        props: ({ http }) => ({
            http,
            billingEndpoint: '/api',
            currentPlanKey: 'PRO',
            bundleLabels: {
                'bv-1': { bundleKey: 'ANALYTICS', label: 'Analytics' },
                'bv-2': { bundleKey: 'SUPPORT', label: 'Priority support' },
            },
        }),
    },
    {
        id: 'tenant-plan-change',
        load: () => import('../../src/pages-tenant/PlanChangeWizard.vue'),
        props: ({ http }) => ({
            // Open from the start: the wizard is a dialog, so a closed one
            // renders nothing and the case would be a snapshot of an empty div.
            modelValue: true,
            http,
            apiPrefix: '/api/billing',
            plans: TENANT_CATALOG_PLANS,
            // The flag that reads "your current plan" is an INVERSION of the
            // card — a foreground role painted as a surface. It needs this
            // prop to render at all, and it measured 1.48:1 in dark.
            currentPlanId: 'pl-1',
            currentPlanName: 'Pro',
            currentCycle: 'MONTHLY',
            currentStatus: 'TRIAL',
            trialEndsAt: '2026-02-01T00:00:00.000Z',
            catalogQuotaKeys: ['users', 'storage', 'projects'],
            formatCurrency: (n: number) => `€ ${n.toFixed(2)}`,
            formatDate: (iso: string) => iso.slice(0, 10),
            quotaLabel: (key: string) => key,
            featureLabel: (key: string) => key,
            // The wizard is a controlled component: without these three it
            // renders, warns, and hands its buttons `undefined`. That is
            // defect L1's shape, which is why the spec now fails on a Vue
            // warning instead of snapshotting past one.
            previewPlanChange: async () => FIXTURE_PLAN_CHANGE_PREVIEW,
            changePlan: async () => {},
            i18n: planChangeWizardI18n(defaultTenantPlanSectionI18n('en')),
        }),
    },
];

export const VISUAL_CASE_IDS = VISUAL_CASES.map((c) => c.id);
