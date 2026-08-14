// Deterministic responses for every request the platform pages make.
//
// Small on purpose. The baselines exist to detect *style* changes, so the data
// only has to be rich enough that each page renders its real chrome — a header,
// a filter row, a table with a couple of rows, a KPI strip. More rows would
// make the snapshots larger without covering another CSS rule.
//
// Every id, date and number is fixed. Nothing here may derive from the clock.

import type {
    AdminManifest,
    BundleRow,
    BundleVersionRow,
    MarketingProjectionRow,
    PlanRow,
    PlanVersionRow,
} from '@saasicat/types';

import type {
    SubscriptionBundleShape,
    UsageSnapshotShape,
} from '../../src/vue/use-tenant-billing.js';
import type { CatalogPlan } from '../../src/vue/use-tenant-billing-catalog.js';
import type { PlanChangePreviewShape } from '../../src/vue/use-tenant-billing.js';

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
 * The live version behind `FIXTURE_PLANS[0]`.
 *
 * Nested routes need their own entry: `/catalog/plans/pl-1/versions` used to
 * fall through to the plans collection, so the page consumed a `PlanRow` as a
 * `PlanVersionRow`. That was harmless only while the collection was empty.
 */
export const FIXTURE_PLAN_VERSIONS: PlanVersionRow[] = [
    {
        id: 'plv-1',
        planId: 'pl-1',
        version: 3,
        baseVersionId: 'plv-0',
        features: ['notes.export', 'notes.share'],
        bundles: ['STARTER_PACK'],
        quotas: { notes: 500, storageGb: 5 },
        monthlyNet: '49.00',
        yearlyNet: '490.00',
        marketed: true,
        publishedAt: '2026-02-10T09:00:00.000Z',
        supersededAt: null,
        publishedChanges: null,
        changeNote: 'Raised the note quota.',
        nonRegressive: true,
        validFrom: '2026-03-01T00:00:00.000Z',
        validUntil: null,
        createdByUserId: 'u-1',
        publishedByUserId: 'u-1',
        createdAt: '2026-01-05T09:00:00.000Z',
        updatedAt: '2026-02-10T09:00:00.000Z',
        isLatestInChain: true,
    },
];

/** Same story for the bundle: its version controls only render with one. */
export const FIXTURE_BUNDLE_VERSIONS: BundleVersionRow[] = [
    {
        id: 'bv-1',
        bundleId: 'b-1',
        bundleKey: 'STARTER_PACK',
        label: 'Starter Pack',
        version: 2,
        baseVersionId: 'bv-0',
        features: ['notes.export'],
        quotas: { notes: 100 },
        compatibility: {},
        pricingOverrides: [],
        marketed: true,
        monthlyNet: '9.00',
        yearlyNet: '90.00',
        publishedAt: '2026-02-10T09:00:00.000Z',
        supersededAt: null,
        publishedChanges: null,
        changeNote: 'Added export.',
        nonRegressive: true,
        validFrom: '2026-03-01T00:00:00.000Z',
        validUntil: null,
        createdByUserId: 'u-1',
        publishedByUserId: 'u-1',
        createdAt: '2026-01-05T09:00:00.000Z',
        updatedAt: '2026-02-10T09:00:00.000Z',
        isLatestInChain: true,
    },
];

/**
 * The marketing card for `FIXTURE_PLANS[0]`.
 *
 * Without it the marketing catalog snapshots its empty-plans banner, which is
 * the one part of that page the baseline does not need to protect — the
 * preview and admin cards are where its styles live.
 */
export const FIXTURE_MARKETING_PROJECTIONS: MarketingProjectionRow[] = [
    {
        id: 'mp-1',
        projectKey: 'fixture',
        targetType: 'PLAN',
        targetVersionId: 'plv-1',
        locale: 'en',
        displayLabel: 'Pro',
        description: 'For growing teams that need more room.',
        visible: true,
        badge: 'Popular',
        topFeatures: [
            { key: 'notes.export', label: 'Export', strong: 'unlimited' },
            { key: 'notes.share', label: 'Sharing', strong: 'with your whole team' },
        ],
        trialEnabled: true,
        trialDays: 14,
        priceTag: null,
        ctaLabel: null,
        priority: 10,
        highlight: true,
        createdAt: '2026-01-05T09:00:00.000Z',
        updatedAt: '2026-02-10T09:00:00.000Z',
    },
];

// ── Tenant-facing surfaces ───────────────────────────────────────────────────
//
// `pages-tenant/*` renders in the CONSUMER's own app rather than in the admin
// shell, and until now no fixture rendered any of it. That gap produced three
// separate defects in one review round — the plan flag at 1.48:1, the sub-row
// indent, the unstyled portals — because every guard the package owns only ever
// looked at the nineteen admin pages.
//
// The data below is chosen to light up the states that hid: a CURRENT plan (the
// inverted flag needs `currentPlanId`), a PENDING version (the banner is behind
// a `v-if`), a booked bundle AND a cancelled one, and a trial.

const TENANT_USAGE: UsageSnapshotShape = {
    plan: 'PRO',
    effectivePlan: 'PRO',
    billingCycle: 'MONTHLY',
    status: 'TRIAL',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: '2026-02-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    currentPeriodStart: '2026-01-01T00:00:00.000Z',
    currentPeriodEnd: '2026-02-01T00:00:00.000Z',
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: {
        id: 'pv-1',
        planId: 'pl-1',
        version: 3,
        publishedAt: '2025-12-01T00:00:00.000Z',
        supersededAt: null,
        changeNote: 'More storage',
    },
    // The pending-version banner only renders when this is set, and it is the
    // surface that paints `--sa-color-inverse-notice`.
    pendingPlanVersion: {
        id: 'pv-2',
        planId: 'pl-1',
        version: 4,
        nonRegressive: true,
        changeNote: 'Adds the export feature',
        publishedChanges: null,
    },
    pendingPlanVersionEffectiveAt: '2026-03-01T00:00:00.000Z',
    pendingPlanVersionAccepted: false,
    pendingPlanVersionAcceptedAt: null,
    limits: {
        plan: 'PRO',
        quotas: { users: 25, storage: 50, projects: 10 },
        features: ['export', 'sso'],
    },
    usage: { users: 18, storage: 31.5, projects: 4 },
    packageSnapshot: null,
    checkoutOfferId: null,
};

const TENANT_BUNDLES: SubscriptionBundleShape[] = [
    {
        id: 'sb-1',
        subscriptionId: 'sub-1',
        bundleVersionId: 'bv-1',
        bundleKey: 'ANALYTICS',
        label: 'Analytics',
        monthlyNet: '19.00',
        startedAt: '2026-01-02T00:00:00.000Z',
        minimumTermEndsAt: '2026-07-02T00:00:00.000Z',
        canceledAt: null,
        canceledEffectiveAt: null,
    },
    // A cancelled booking renders a different pill and a different row tone —
    // one row of each, so neither branch is the one nobody looks at.
    {
        id: 'sb-2',
        subscriptionId: 'sub-1',
        bundleVersionId: 'bv-2',
        bundleKey: 'SUPPORT',
        label: 'Priority support',
        monthlyNet: '49.00',
        startedAt: '2025-11-02T00:00:00.000Z',
        minimumTermEndsAt: null,
        canceledAt: '2026-01-10T00:00:00.000Z',
        canceledEffectiveAt: '2026-02-01T00:00:00.000Z',
    },
];

export const TENANT_CATALOG_PLANS: CatalogPlan[] = [
    {
        id: 'pl-0',
        name: 'Starter',
        tagline: 'For trying things out',
        monthlyNet: 0,
        yearlyNet: 0,
        popular: false,
        quotas: { users: 3, storage: 5, projects: 1 },
        features: [],
    },
    {
        id: 'pl-1',
        name: 'Pro',
        tagline: 'For growing teams',
        monthlyNet: 49,
        yearlyNet: 490,
        popular: true,
        quotas: { users: 25, storage: 50, projects: 10 },
        features: ['export', 'sso'],
    },
    {
        id: 'pl-2',
        name: 'Enterprise',
        tagline: 'For the whole company',
        monthlyNet: 199,
        yearlyNet: 1990,
        popular: false,
        quotas: { users: -1, storage: 500, projects: -1 },
        features: ['export', 'sso', 'audit'],
    },
];

const TENANT_CATALOG_BUNDLES = [
    {
        bundleVersionId: 'bv-1',
        bundleKey: 'ANALYTICS',
        label: 'Analytics',
        description: 'Dashboards and scheduled reports',
        features: ['reports'],
        quotas: { dashboards: 10 },
        monthlyNet: '19.00',
        yearlyNet: '190.00',
        requiresFeatures: [],
        priceTag: null,
    },
];

/**
 * What the plan-change wizard shows in its confirm step.
 *
 * An UPGRADE with proration and one exceeded limit: the price summary, the
 * prorated delta and the blocking-limit row are three separate branches, and a
 * NOOP preview would render none of them.
 */
export const FIXTURE_PLAN_CHANGE_PREVIEW: PlanChangePreviewShape = {
    changeType: 'UPGRADE',
    current: {
        plan: {
            id: 'pl-1',
            name: 'Pro',
            monthlyNet: 49,
            yearlyNet: 490,
            quotas: { users: 25, storage: 50 },
            features: ['export'],
        },
        billingCycle: 'MONTHLY',
    },
    target: {
        plan: {
            id: 'pl-2',
            name: 'Enterprise',
            monthlyNet: 199,
            yearlyNet: 1990,
            quotas: { users: -1, storage: 500 },
            features: ['export', 'audit'],
        },
        billingCycle: 'MONTHLY',
    },
    effectiveAt: '2026-02-01T00:00:00.000Z',
    isImmediate: false,
    projectedTrialEndsAt: null,
    proration: {
        daysRemainingInPeriod: 17,
        daysInPeriod: 31,
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-02-01T00:00:00.000Z',
        currentPriceNet: 49,
        targetPriceNet: 199,
        prorataDeltaNet: 82.26,
    },
    limitsCheck: {
        users: { used: 18, currentMax: 25, targetMax: -1, exceeded: false },
        projects: { used: 4, currentMax: 10, targetMax: 2, exceeded: true },
    },
    featuresLost: [],
    featuresGained: ['audit'],
    blockers: [],
    warnings: [{ code: 'LIMIT_EXCEEDED', message: 'Projects over the target limit' }],
};

/** Routing table. Matched EXACTLY — see `respondTo` for why. */
const ROUTES: ReadonlyArray<readonly [string, unknown]> = [
    ['/api/admin/boot', BOOT],
    ['/api/admin/manifest', FIXTURE_MANIFEST],
    ['/api/admin/tenants', TENANTS],
    ['/api/admin/users', EMPTY_LIST],
    ['/api/admin/audit', EMPTY_LIST],
    ['/api/admin/subscriptions', EMPTY_LIST],
    ['/api/admin/discovery', DISCOVERY],
    ['/api/admin/catalog/plans/tenant-counts', {}],
    ['/api/admin/catalog/plans/pl-1/versions', FIXTURE_PLAN_VERSIONS],
    ['/api/admin/catalog/bundles/b-1/versions', FIXTURE_BUNDLE_VERSIONS],
    // `{ bundle, versions }`, not a bare row: PlansPage reads
    // `body.bundle.bundleKey` to build its bundle cards.
    [
        '/api/admin/catalog/bundles/b-1',
        { bundle: FIXTURE_BUNDLES[0], versions: FIXTURE_BUNDLE_VERSIONS },
    ],
    ['/api/admin/catalog/features', []],
    ['/api/admin/catalog/quotas', []],
    ['/api/admin/catalog/plans', FIXTURE_PLANS],
    ['/api/admin/catalog/bundles', FIXTURE_BUNDLES],
    ['/api/admin/catalog/entries', []],
    ['/api/admin/catalog/marketing-projections', FIXTURE_MARKETING_PROJECTIONS],
    ['/api/admin/catalog/marketing-settings', { activeLocales: ['en', 'de'] }],
    // Deliberately empty, and registered so that stays a decision rather than
    // an accident: neither contributes a surface the token migration touches.
    ['/api/admin/catalog/promotions', []],
    ['/api/admin/catalog/capabilities', []],
    ['/api/admin/promo-codes', EMPTY_LIST],
    ['/api/admin/setup/status', { needsSetup: false }],
    ['/api/admin/dashboard/tenants', { value: 42 }],
    ['/api/admin/dashboard/subscriptions', { value: 17, delta: 3 }],
    ['/api/admin/dashboard/last-scan', { value: 128, timestamp: '2026-01-15T09:00:00.000Z' }],
    // Tenant-facing. `apiPrefix` is the sub-path under the adapter's base, so
    // the fixture's cases pass `/api/billing` and these are the full paths.
    ['/api/billing/usage', TENANT_USAGE],
    ['/api/billing/subscription-bundles', TENANT_BUNDLES],
    ['/api/billing/plans', TENANT_CATALOG_PLANS],
    ['/api/billing/feature-registry', { features: {}, quotas: {} }],
    ['/api/billing/bundles', TENANT_CATALOG_BUNDLES],
];

/**
 * Paths the fixture was asked for and does not have.
 *
 * The visual spec reads this and fails the case. Matching used to be
 * longest-PREFIX, which meant a nested route silently inherited its
 * collection's body: `/catalog/bundles/b-1` got the bundle *list*, so
 * `body.bundle.bundleKey` threw, the page swallowed it, and the baseline
 * recorded an empty card as if that were the design. Twice. Exact matching
 * turns that into a named gap instead of a plausible-looking snapshot.
 */
export const unmatchedRequests: string[] = [];

/** Returns the fixture body for a URL. */
export function respondTo(url: string, _method: string): unknown {
    const path = url.split('?')[0].replace(/\/+$/, '');
    for (const [route, body] of ROUTES) {
        if (path === route) return body;
    }

    if (!unmatchedRequests.includes(path)) unmatchedRequests.push(path);

    // An unmapped endpoint answers with an empty ARRAY, not a 404 and not a
    // paginated envelope: a 404 would make the baseline about the error banner,
    // and `{ items: [] }` is not iterable — several callers spread the body
    // directly. `[]` satisfies both, since `useApiList` accepts a bare array.
    return [];
}
