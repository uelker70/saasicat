import type { Component } from 'vue';

import type { HttpClient } from '../../src/client/types.js';
import type {
    PlatformEmailProvider,
    PlatformEmailTestResult,
} from '../../src/internal/platform-email/platform-email.types.js';
import type {
    EmailHistoryDetail,
    EmailHistoryListResult,
} from '../../src/internal/email-history/email-history.types.js';
import type { BundleRow, BundleVersionMutationResult, BundleVersionRow } from '@saasicat/types';
import type { AuditRow } from '../../src/pages/AuditPage.vue';
import type { PromoDetailData } from '../../src/pages/PromoCodeDetailPage.vue';
import type { TenantDetailData } from '../../src/internal/tenant-detail/types.js';
import type { PromoRow } from '../../src/pages/PromoCodesPage.vue';
import type { UserRow } from '../../src/pages/UsersPage.vue';
import type { BillingCycleStr } from '../../src/vue/use-tenant-billing.js';
import {
    FIXTURE_BUNDLES,
    FIXTURE_BUNDLE_VERSIONS,
    FIXTURE_CATALOG_CAPABILITIES,
    FIXTURE_CATALOG_FEATURES,
    FIXTURE_CATALOG_QUOTAS,
    FIXTURE_DISCOVERY,
    FIXTURE_PLAN_CHANGE_PREVIEW,
    TENANT_CATALOG_PLANS,
} from './fixture-data.js';
import {
    defaultTenantPlanSectionI18n,
    planChangeWizardI18n,
} from '@saasicat/ui-vue-tenant/default-i18n.js';

// The roster the baselines cover, and what each page needs to render its real
// chrome instead of an empty frame or an error banner.
//
// Data-driven on purpose: adding a page here is the only step needed to put it
// under the baseline, and the spec asserts the roster has not silently shrunk.

/** What the fixture can hand a page. */
export interface CaseContext {
    /**
     * The stubbed HttpClient from `main.ts`.
     *
     * Typed as the contract rather than as `unknown`: every page that takes an
     * `http` prop declares it as `HttpClient`, so an `unknown` here would be the
     * one value in a case that no page could ever accept.
     */
    http: HttpClient;
    adminBase: string;
}

export interface VisualCase {
    /** URL key — `?page=<id>`. Also the snapshot file name. */
    id: string;
    load: () => Promise<{ default: Component }>;
    /**
     * Props for this page, with the component type erased.
     *
     * This is the shape the HARNESS reads — `main.ts` hands the result to `h()`
     * and knows nothing about which page it is mounting. The shape a case is
     * WRITTEN against is `TypedVisualCase` below, which checks the same function
     * against the page's own `defineProps`.
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
     *
     * **Name the STATE, not the component.** The loop hovers `.first()` match,
     * so a selector that covers several states reads whichever the fixture
     * happens to render first and leaves the rest unhovered — the same
     * "the state exists but nothing reaches it" gap this field was added to
     * close. Write `.x.on` and `.x:not(.on)` rather than `.x`.
     */
    hoverBy?: readonly string[];
}

/**
 * The props a component declares, read off the component itself.
 *
 * Vue puts the resolved prop set on the instance as `$props`, so the declared
 * props of an SFC are reachable from its constructor type without the component
 * having to export anything. The intersection Vue adds there — `VNodeProps`,
 * `AllowedComponentProps`, `ComponentCustomProps` — is what makes `key`, `ref`,
 * `class` and `style` legal on any case.
 *
 * Written out rather than imported: `vue-component-type-helpers` ships the same
 * one line, and it is not a dependency of this package.
 */
type PropsOf<T> = T extends new (...args: never[]) => { $props: infer P } ? NonNullable<P> : never;

/**
 * A case as it is WRITTEN — its props checked against the page it loads.
 *
 * `load()` is a dynamic import, so the component type is not knowable from the
 * `VisualCase` declaration; it only exists at the roster entry, where the import
 * is written. `visualCase()` captures it there as `T` and `PropsOf<T>` turns it
 * into the return type `props` has to satisfy.
 *
 * That is the whole point of the helper. Until it existed, `props` returned
 * `Record<string, unknown>`, which accepts anything: the `discovery` case shipped
 * for months missing six REQUIRED props (Vue warns and passes `undefined`, so
 * every review dialog and save button under that baseline was wired to nothing),
 * and handing a page an array of the wrong shape took it down at runtime while
 * `pnpm -r typecheck` stayed green.
 */
interface TypedVisualCase<T> extends Omit<VisualCase, 'load' | 'props'> {
    load: () => Promise<{ default: T }>;
    props?: (ctx: CaseContext) => PropsOf<T>;
}

/**
 * Declares one case, checked against the page it mounts.
 *
 * Inference runs in two passes, which is what makes this work: `load` takes no
 * parameters, so `T` is fixed from its return type in the first pass, and the
 * context-sensitive `props` is then checked against the `PropsOf<T>` that
 * produced.
 */
function visualCase<T extends Component>(entry: TypedVisualCase<T>): VisualCase {
    return entry;
}

/**
 * What `DiscoveryPage` gets handed on both of its cases.
 *
 * Written once: the two cases differ only in which tab they reveal, and the same
 * catalog in two places is the duplication rule's own example.
 */
const discoveryProps = () => ({
    // The snapshot is the SCAN; `capabilities`, `features` and `quotas` are the
    // CATALOG rows kept for what the scan found, and the two have different
    // shapes. Handing the page the snapshot's arrays is what took it down the
    // first time somebody tried to fill this case in, so it went back to empty
    // and stayed there — a baseline of `sa-discovery__empty-row` and nothing
    // else. Both mistakes are compile errors now: `visualCase()` checks this
    // object against the page's own `defineProps`.
    //
    // The snapshot is still passed, because that is what it is FOR here: the
    // meta banner's app name and scan time, and the `declaredAt` the capability
    // rows are annotated with.
    snapshot: FIXTURE_DISCOVERY,
    capabilities: FIXTURE_CATALOG_CAPABILITIES,
    features: FIXTURE_CATALOG_FEATURES,
    quotas: FIXTURE_CATALOG_QUOTAS,
    loading: false,
    error: null,
    // `de` is this page's translation base (`DISCOVERY_DEFAULT_LOCALE`), so it
    // is the second entry that produces a coverage pill at all.
    activeLocales: ['de', 'en'],
    runDiscovery: async () => {},
    // Six required props this case never supplied, for as long as it has
    // existed. The page rendered anyway — Vue warns about a missing required
    // prop and passes `undefined` — so every review dialog and every save
    // button under that baseline was wired to nothing.
    reviewFeature: async () => ({}),
    reviewQuota: async () => ({}),
    setFeatureI18n: async () => ({}),
    setQuotaI18n: async () => ({}),
    setFeatureBase: async () => ({}),
    setQuotaBase: async () => ({}),
});

export const VISUAL_CASES: readonly VisualCase[] = [
    visualCase({
        id: 'tenants',
        load: () => import('../../src/pages/TenantsPage.vue'),
        props: ({ http, adminBase }) => ({
            endpoint: `${adminBase}/tenants`,
            subtitle: 'All tenants on this installation',
            http,
            usageFields: [{ icon: 'person', field: 'users' }],
        }),
    }),
    visualCase({
        id: 'audit',
        load: () => import('../../src/pages/AuditPage.vue'),
        // `loadAudit` returns a plain array — the page owns paging itself.
        props: () => ({
            loadAudit: async (): Promise<AuditRow[]> => [
                {
                    id: 'a-1',
                    action: 'TENANT_SUSPENDED',
                    // `entity` and `user`, not `entityType` and `actorEmail`.
                    // The table has an Entity column and derives its Actor
                    // column from `user.email ?? userEmail`, so the fixture's
                    // own spellings rendered a blank cell and an em dash.
                    entity: 'Tenant',
                    entityId: 't-0001',
                    user: { email: 'admin@fixture.test' },
                    changes: { isActive: { from: true, to: false } },
                    createdAt: '2026-01-10T08:30:00.000Z',
                },
            ],
        }),
    }),
    visualCase({
        id: 'subscriptions',
        load: () => import('../../src/pages/SubscriptionsPage.vue'),
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
    }),
    visualCase({
        id: 'dashboard',
        load: () => import('../../src/pages/DashboardPage.vue'),
        // Nothing: the manifest comes from `SUPER_ADMIN_MANIFEST_KEY` and the
        // KPI reads from the registry, both installed by `main.ts`.
    }),
    visualCase({
        id: 'discovery',
        load: () => import('../../src/pages/DiscoveryPage.vue'),
        // Fully prop-driven: this page receives data, it does not fetch.
        props: discoveryProps,
        // Opens the first feature card. `DiscoveryFeatureCard` moved to
        // `AdminAccordion` in 0.25.0 and no test had ever rendered one, open or
        // closed; the body behind this click is the master-data subtab with the
        // read-only capability list.
        revealBy: ['.sa-fc .sa-accordion__trigger'],
    }),
    visualCase({
        // The same page on its other tab, for the same reason `marketing-
        // catalog-admin` is its own case: `q-tab-panels` mounts one panel, so
        // one case can cover the feature cards or the quota cards, never both.
        // `DiscoveryQuotaCard` is the second of the two accordion migrations
        // and had no baseline at all.
        id: 'discovery-quotas',
        load: () => import('../../src/pages/DiscoveryPage.vue'),
        props: discoveryProps,
        // Ordered: the tab mounts the quota list, the trigger opens the first
        // card. The quota card has no subtabs, so its body IS the shared
        // translation panel — the one surface the feature case cannot reach
        // without losing its capability list.
        revealBy: ['.sa-discovery__tabs .q-tab:nth-child(2)', '.sa-qc .sa-accordion__trigger'],
    }),
    visualCase({
        id: 'plans',
        load: () => import('../../src/pages/PlansPage.vue'),
        props: ({ http, adminBase }) => ({
            adminEndpoint: adminBase,
            projectKey: 'fixture',
            http,
        }),
    }),
    visualCase({
        id: 'login',
        load: () => import('../../src/auth/SuperAdminLoginPage.vue'),
    }),
    visualCase({
        id: 'manifest-error',
        load: () => import('../../src/pages/AdminManifestErrorPage.vue'),
        props: () => ({ errorMessage: 'Manifest endpoint responded with HTTP 500' }),
    }),
    visualCase({
        id: 'setup-wizard',
        load: () => import('../../src/auth/SuperAdminSetupWizard.vue'),
    }),
    visualCase({
        id: 'users',
        load: () => import('../../src/pages/UsersPage.vue'),
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
    }),
    visualCase({
        id: 'promo-codes',
        load: () => import('../../src/pages/PromoCodesPage.vue'),
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
    }),
    visualCase({
        id: 'pilots',
        load: () => import('../../src/pages/PilotsPage.vue'),
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
    }),
    visualCase({
        id: 'tenant-detail',
        load: () => import('../../src/pages/TenantDetailPage.vue'),
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
    }),
    visualCase({
        id: 'promo-code-detail',
        load: () => import('../../src/pages/PromoCodeDetailPage.vue'),
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
    }),
    visualCase({
        id: 'email-history',
        load: () => import('../../src/pages/EmailHistoryPage.vue'),
        props: () => ({
            loadEmails: async (): Promise<EmailHistoryListResult> => ({
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
            loadEmailDetail: async (): Promise<EmailHistoryDetail> => ({
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
    }),
    visualCase({
        id: 'platform-email',
        load: () => import('../../src/pages/PlatformEmailPage.vue'),
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
            // A RESULT, not `void`: the page renders the returned message in its
            // test dialog, so a void stub is a button wired to nothing — the
            // same shape as the six missing props on `discovery`.
            testProvider: async (): Promise<PlatformEmailTestResult> => ({
                success: true,
                message: 'Test mail delivered to admin@fixture.test',
            }),
        }),
    }),
    visualCase({
        id: 'marketing-catalog',
        load: () => import('../../src/pages/MarketingCatalogPage.vue'),
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
    }),
    visualCase({
        // The same page on its other tab. Two cases rather than one with a
        // click, because the preview is what the page opens on and both halves
        // carry styles worth protecting — `MarketingCatalogAdmin` is only
        // mounted once the tab is selected, so a single case can cover one or
        // the other, never both.
        id: 'marketing-catalog-admin',
        load: () => import('../../src/pages/MarketingCatalogPage.vue'),
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
    }),
    visualCase({
        // 14 required props, ten of them functions — the page AP3 replaces.
        // Kept under baseline precisely because it is about to change the most.
        id: 'bundles',
        load: () => import('../../src/pages/BundlesPage.vue'),
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
            // The rows the page would get back, not a two-field sketch of them.
            // `create`/`update` answer with a `BundleRow` and the mutations with
            // `{ bundleVersion, warnings }` — the fixture's `{ version, warnings }`
            // was a field name the page never reads, and `classifyDiff` returned
            // a `kind` where the editor reads `nonRegressive`.
            create: async (): Promise<BundleRow> => FIXTURE_BUNDLES[0],
            update: async (): Promise<BundleRow> => FIXTURE_BUNDLES[0],
            softDelete: async () => {},
            loadVersions: async (): Promise<BundleVersionRow[]> => FIXTURE_BUNDLE_VERSIONS,
            createDraft: async (): Promise<BundleVersionMutationResult> => ({
                bundleVersion: FIXTURE_BUNDLE_VERSIONS[0],
                warnings: [],
            }),
            updateDraft: async (): Promise<BundleVersionMutationResult> => ({
                bundleVersion: FIXTURE_BUNDLE_VERSIONS[0],
                warnings: [],
            }),
            publish: async (): Promise<BundleVersionMutationResult> => ({
                bundleVersion: FIXTURE_BUNDLE_VERSIONS[0],
                warnings: [],
            }),
            classifyDiff: () => ({ changes: [], nonRegressive: true }),
        }),
        // Opens the bundle so its version controls and inline editor render.
        revealBy: ['.sa-bd-card__head'],
        // The feature pill, which only exists at all since this case got a
        // discovery snapshot. `.bd-feature-pill:hover:not(:disabled)` moves its
        // background while the label and the key keep theirs.
        //
        // BOTH states, named separately, because the hover loop takes
        // `.first()` and the first pill is `notes.export` — the one the fixture
        // version selects. A bare `.bd-feature-pill` would therefore only ever
        // read the `.on` variant, and the unselected one carries a different
        // foreground and a different key colour. That is this PR's own subject
        // one level in: a state the fixture renders and the check cannot reach.
        hoverBy: ['.bd-feature-pill.on', '.bd-feature-pill:not(.on)'],
    }),
    // ── Tenant-facing. These render in the CONSUMER's app, not in the admin
    // shell, and nothing in this suite reached them before. Three defects in a
    // single review round had exactly that as their root cause — a state no
    // fixture renders. Each case below is chosen for the branch that hid:
    // `currentPlanId` for the inverted "current plan" flag (1.48:1 in dark),
    // a pending version for the banner behind its `v-if`, and a dialog for the
    // teleported portal.
    visualCase({
        id: 'tenant-plan',
        load: () => import('@saasicat/ui-vue-tenant/TenantPlanSection.vue'),
        props: ({ http }) => ({
            http,
            apiPrefix: '/api/billing',
            formatCurrency: (n: number) => `€ ${n.toFixed(2)}`,
            formatDate: (iso: string | Date) => String(iso).slice(0, 10),
            quotaLabel: (key: string) => key,
            featureLabel: (key: string) => key,
        }),
    }),
    visualCase({
        id: 'tenant-bundles',
        load: () => import('@saasicat/ui-vue-tenant/MySubscriptionBundlesPage.vue'),
        props: ({ http }) => ({
            http,
            billingEndpoint: '/api',
            currentPlanKey: 'PRO',
            bundleLabels: {
                'bv-1': { bundleKey: 'ANALYTICS', label: 'Analytics' },
                'bv-2': { bundleKey: 'SUPPORT', label: 'Priority support' },
            },
        }),
    }),
    visualCase({
        id: 'tenant-plan-change',
        load: () => import('@saasicat/ui-vue-tenant/PlanChangeWizard.vue'),
        props: () => ({
            // Open from the start: the wizard is a dialog, so a closed one
            // renders nothing and the case would be a snapshot of an empty div.
            modelValue: true,
            // No `http` and no `apiPrefix`: this wizard declares neither. It
            // reaches the server through `previewPlanChange`/`changePlan`, so
            // both were landing on the root element as stray attributes.
            plans: TENANT_CATALOG_PLANS,
            // The flag that reads "your current plan" is an INVERSION of the
            // card — a foreground role painted as a surface. It needs this
            // prop to render at all, and it measured 1.48:1 in dark.
            currentPlanId: 'pl-1',
            currentPlanName: 'Pro',
            currentCycle: 'MONTHLY' as BillingCycleStr,
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
    }),
];

export const VISUAL_CASE_IDS = VISUAL_CASES.map((c) => c.id);
