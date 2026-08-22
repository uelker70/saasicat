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
    CapabilityCatalogEntryRow,
    DiscoverySnapshot,
    FeatureCatalogEntryRow,
    MarketingProjectionRow,
    PlanRow,
    PlanVersionRow,
    QuotaCatalogEntryRow,
} from '@saasicat/types';

import type {
    SubscriptionBundleShape,
    UsageSnapshotShape,
} from '../../../src/vue/use-tenant-billing.js';
import type { CatalogPlan } from '../../../src/vue/use-tenant-billing-catalog.js';
import type { PlanChangePreviewShape } from '../../../src/vue/use-tenant-billing.js';

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

/**
 * The discovery snapshot, which is the LIBRARY every editor picks from.
 *
 * Passing `snapshot: null` was the same mistake the comment above `FIXTURE_
 * BUNDLES` names, one level further in: `BundlesPage` binds
 * `:available-features="snapshot?.features ?? []"`, so a null snapshot made
 * `BundleFeaturesEditor` render `bd-features-empty` and nothing else. Not one
 * `.bd-feature-pill` has ever existed under a baseline or a contrast reading —
 * and `.bd-feature-pill.on .bd-feature-key` was measured at 2.92:1 in the dark
 * theme by a human, on a screen no test can reach.
 *
 * `notes.export` is deliberately one of the keys `FIXTURE_BUNDLE_VERSIONS`
 * already selects, so both pill states render: one `on`, the rest off. A
 * fixture that only ever produced the resting state would leave the half that
 * was broken uncovered.
 */
export const FIXTURE_DISCOVERY: DiscoverySnapshot = {
    schemaVersion: 1,
    scannedAt: '2026-02-10T09:00:00.000Z',
    app: { key: 'fixture', version: '1.4.0' },
    capabilities: [
        {
            capabilityKey: 'notes.export.pdf',
            label: 'Export as PDF',
            feature: 'notes.export',
            status: 'active',
            kind: 'service',
            owner: null,
            replacementKey: null,
            removalPlannedAt: null,
            reason: null,
            requires: [],
            replaces: [],
            declaredAt: 'NotesExportService.toPdf',
        },
    ],
    features: [
        {
            featureKey: 'notes.export',
            capabilityKeys: ['notes.export.pdf'],
            requires: [],
            replaces: [],
        },
        { featureKey: 'notes.share', capabilityKeys: [], requires: ['notes.export'], replaces: [] },
        { featureKey: 'team.roles', capabilityKeys: [], requires: [], replaces: [] },
    ],
    quotas: [
        {
            quotaKey: 'notes',
            label: 'Notes',
            unit: 'notes',
            policy: 'continuous',
            feature: null,
            replaces: null,
            declaredAt: 'NotesService',
            enforcedBy: ['notes.export.pdf'],
        },
    ],
    hash: 'fixture-discovery-hash',
};

// ── The discovery CATALOG, which is not the discovery SNAPSHOT ───────────────
//
// `DiscoveryPage` takes both, and they are different things. The snapshot above
// is what the scan found in the code; the three lists below are the catalog
// rows the platform keeps for those findings — the approval status, the
// editable label, the translations. `DiscoveryFeatureCard` reads
// `feature.replaces.length` and `feature.i18n`, neither of which exists on a
// `DiscoveredFeature`, so handing the page `FIXTURE_DISCOVERY.features` takes it
// down before it reaches `data-visual-ready`. That is what the case did the
// first time somebody tried to give it data, and why it went back to `[]`.
//
// Chosen for the branches, not for realism:
//
//   - all four `discoveryStatus` values, so each `sa-review--*` pill and each
//     primary action of the status control renders at least once;
//   - two owners plus one ownerless feature, so the page's group rollup renders
//     three groups including the "no owner" one that sorts last;
//   - a deprecated and an experimental capability, a `replaces` list and a
//     `successorKey`, so the header flags are not all behind a false `v-if`;
//   - full, half and no English translation, so the coverage pill renders
//     `complete`, `warn` and `low`;
//   - one capability with no feature, so the orphan section exists;
//   - one quota without a `usageProvider`, which is the deploy-blocking state
//     that paints the card's warning tone.
//
// `notes.export.pdf` is deliberately the key `FIXTURE_DISCOVERY` declares, so
// the page's `declaredAtByKey` lookup resolves for one capability row and not
// for the others — both halves of that `v-if`.

const FEATURE_APPROVED_AT = '2026-01-20T09:00:00.000Z';

export const FIXTURE_CATALOG_CAPABILITIES: CapabilityCatalogEntryRow[] = [
    {
        id: 'cap-1',
        projectKey: 'fixture',
        capabilityKey: 'notes.export.pdf',
        label: 'Export as PDF',
        description: null,
        featureKey: 'notes.export',
        bundleKey: null,
        codeStatus: 'active',
        owner: 'notes',
        kind: 'service',
        replacementKey: null,
        deprecatedAt: null,
        removalPlannedAt: null,
        reason: null,
        i18n: {},
        sortOrder: 1,
        // After the feature's approval, so the card's "new since approval" flag
        // and the row's own `new` flag both render.
        createdAt: '2026-02-01T09:00:00.000Z',
        updatedAt: '2026-02-01T09:00:00.000Z',
        deletedAt: null,
    },
    {
        id: 'cap-2',
        projectKey: 'fixture',
        capabilityKey: 'notes.export.csv',
        label: 'Export as CSV',
        description: null,
        featureKey: 'notes.export',
        bundleKey: null,
        codeStatus: 'deprecated',
        owner: 'notes',
        kind: 'endpoint',
        replacementKey: 'notes.export.pdf',
        deprecatedAt: '2026-01-05T09:00:00.000Z',
        removalPlannedAt: '2026-06-01T00:00:00.000Z',
        reason: 'Superseded by the PDF exporter.',
        i18n: {},
        sortOrder: 2,
        createdAt: '2025-11-02T09:00:00.000Z',
        updatedAt: '2026-01-05T09:00:00.000Z',
        deletedAt: null,
    },
    {
        id: 'cap-3',
        projectKey: 'fixture',
        capabilityKey: 'notes.share.link',
        label: 'Share via link',
        description: null,
        featureKey: 'notes.share',
        bundleKey: null,
        codeStatus: 'experimental',
        owner: 'notes',
        kind: 'event',
        replacementKey: null,
        deprecatedAt: null,
        removalPlannedAt: null,
        reason: null,
        i18n: {},
        sortOrder: 3,
        createdAt: '2026-01-08T09:00:00.000Z',
        updatedAt: '2026-01-08T09:00:00.000Z',
        deletedAt: null,
    },
    {
        id: 'cap-4',
        projectKey: 'fixture',
        capabilityKey: 'team.roles.assign',
        label: 'Assign a role',
        description: null,
        featureKey: 'team.roles',
        bundleKey: null,
        codeStatus: 'active',
        owner: 'team',
        kind: 'endpoint',
        replacementKey: null,
        deprecatedAt: null,
        removalPlannedAt: null,
        reason: null,
        i18n: {},
        sortOrder: 4,
        createdAt: '2025-12-01T09:00:00.000Z',
        updatedAt: '2025-12-01T09:00:00.000Z',
        deletedAt: null,
    },
    {
        // No `featureKey` — the page's orphan bucket, and the only thing that
        // makes its section and its hint paragraph exist.
        id: 'cap-5',
        projectKey: 'fixture',
        capabilityKey: 'legacy.import',
        label: 'Import from the legacy store',
        description: null,
        featureKey: null,
        bundleKey: null,
        codeStatus: 'active',
        owner: null,
        kind: 'job',
        replacementKey: null,
        deprecatedAt: null,
        removalPlannedAt: null,
        reason: null,
        i18n: {},
        sortOrder: 5,
        createdAt: '2025-10-01T09:00:00.000Z',
        updatedAt: '2025-10-01T09:00:00.000Z',
        deletedAt: null,
    },
];

export const FIXTURE_CATALOG_FEATURES: FeatureCatalogEntryRow[] = [
    {
        id: 'fce-1',
        projectKey: 'fixture',
        featureKey: 'notes.export',
        label: 'Notizen exportieren',
        description: 'Notizen als PDF oder CSV herunterladen.',
        marketingLabel: null,
        marketingDescription: null,
        icon: 'ios_share',
        tier: 'CORE',
        discoveryStatus: 'approved',
        requires: [],
        replaces: [],
        successorKey: null,
        approvedAt: FEATURE_APPROVED_AT,
        approvedBy: 'u-1',
        approvedSignature: 'notes.export.csv@deprecated|notes.export.pdf@active',
        plannedOnly: false,
        core: true,
        // Both fields translated — the coverage pill reads `complete`.
        i18n: { en: { label: 'Export notes', description: 'Download notes as PDF or CSV.' } },
        sortOrder: 1,
        createdAt: '2025-11-02T09:00:00.000Z',
        updatedAt: '2026-02-01T09:00:00.000Z',
        deletedAt: null,
    },
    {
        id: 'fce-2',
        projectKey: 'fixture',
        featureKey: 'notes.share',
        label: 'Notizen teilen',
        description: 'Notizen über einen Link freigeben.',
        marketingLabel: null,
        marketingDescription: null,
        icon: 'share',
        tier: 'ADVANCED',
        discoveryStatus: 'pending',
        requires: ['notes.export'],
        replaces: ['notes.public-link'],
        successorKey: null,
        approvedAt: null,
        approvedBy: null,
        approvedSignature: null,
        plannedOnly: false,
        core: false,
        // Label only — the coverage pill reads `warn`.
        i18n: { en: { label: 'Share notes' } },
        sortOrder: 2,
        createdAt: '2026-01-08T09:00:00.000Z',
        updatedAt: '2026-01-08T09:00:00.000Z',
        deletedAt: null,
    },
    {
        id: 'fce-3',
        projectKey: 'fixture',
        featureKey: 'team.roles',
        label: 'Rollen',
        description: 'Rollen und Berechtigungen im Team.',
        marketingLabel: null,
        marketingDescription: null,
        icon: 'groups',
        tier: 'PRO',
        // Drift: approved once, and the code has moved since.
        discoveryStatus: 'outdated',
        requires: [],
        replaces: [],
        successorKey: null,
        approvedAt: '2025-12-02T09:00:00.000Z',
        approvedBy: 'u-1',
        approvedSignature: 'team.roles.assign@active',
        plannedOnly: false,
        core: false,
        // Untranslated — the coverage pill reads `low`.
        i18n: {},
        sortOrder: 3,
        createdAt: '2025-12-01T09:00:00.000Z',
        updatedAt: '2026-01-30T09:00:00.000Z',
        deletedAt: null,
    },
    {
        // No capability declares it, so it lands in the ownerless group that
        // sorts last, and its card body shows the "no capabilities" hint.
        id: 'fce-4',
        projectKey: 'fixture',
        featureKey: 'notes.attachments',
        label: 'Anhänge',
        description: 'Dateien an eine Notiz hängen.',
        marketingLabel: null,
        marketingDescription: null,
        icon: 'attach_file',
        tier: null,
        discoveryStatus: 'obsolete',
        requires: [],
        replaces: [],
        successorKey: 'notes.files',
        approvedAt: null,
        approvedBy: null,
        approvedSignature: null,
        plannedOnly: false,
        core: false,
        i18n: {},
        sortOrder: 4,
        createdAt: '2025-09-01T09:00:00.000Z',
        updatedAt: '2026-01-12T09:00:00.000Z',
        deletedAt: null,
    },
];

export const FIXTURE_CATALOG_QUOTAS: QuotaCatalogEntryRow[] = [
    {
        id: 'qce-1',
        projectKey: 'fixture',
        quotaKey: 'notes',
        label: 'Notizen',
        description: 'Wie viele Notizen ein Mandant anlegen darf.',
        unit: 'Notizen',
        featureKey: 'notes.export',
        usageProvider: 'NotesService',
        enforcementMode: 'hard',
        discoveryStatus: 'approved',
        replaces: [],
        successorKey: null,
        approvedAt: FEATURE_APPROVED_AT,
        approvedBy: 'u-1',
        approvedSignature: 'Notizen|hard|NotesService|notes.export',
        i18n: {
            en: {
                label: 'Notes',
                unit: 'notes',
                description: 'How many notes a tenant may create.',
            },
        },
        sortOrder: 1,
        createdAt: '2025-11-02T09:00:00.000Z',
        updatedAt: '2026-01-20T09:00:00.000Z',
        deletedAt: null,
    },
    {
        // `usageProvider: null` on a HARD quota — deploy-blocking, and the only
        // state that paints the card's negative mark and its warning line.
        id: 'qce-2',
        projectKey: 'fixture',
        quotaKey: 'storageGb',
        label: 'Speicher',
        description: null,
        unit: 'GB',
        featureKey: null,
        usageProvider: null,
        enforcementMode: 'hard',
        discoveryStatus: 'pending',
        replaces: ['diskQuota'],
        successorKey: null,
        approvedAt: null,
        approvedBy: null,
        approvedSignature: null,
        i18n: {},
        sortOrder: 2,
        createdAt: '2026-01-08T09:00:00.000Z',
        updatedAt: '2026-01-08T09:00:00.000Z',
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

// ─── Rows the PAGES fetch ────────────────────────────────────────────────────
//
// These used to be handed to a page as a prop by the case that rendered it.
// Since the pages read the resource registry, the fixture has to answer the
// request instead — which is closer to what a consumer's app does, and is why
// the shapes below are the server's rather than a component's.

const AUDIT_ROWS = [
    {
        id: 'a-1',
        action: 'TENANT_SUSPENDED',
        // `entity` and `user`, not `entityType` and `actorEmail`. The table has
        // an Entity column and derives its Actor column from
        // `user.email ?? userEmail`, so the other spellings render a blank cell
        // and an em dash.
        entity: 'Tenant',
        entityId: 't-0001',
        user: { email: 'admin@fixture.test' },
        changes: { isActive: { from: true, to: false } },
        createdAt: '2026-01-10T08:30:00.000Z',
    },
];

const SUBSCRIPTION_ROWS = [
    {
        id: 's-1',
        tenantName: 'Northwind Ltd',
        planKey: 'PRO',
        status: 'ACTIVE',
        startsAt: '2025-03-04T00:00:00.000Z',
    },
];

const USER_ROWS = [
    {
        id: 'u-1',
        email: 'admin@fixture.test',
        firstName: 'Ada',
        lastName: 'Lovelace',
        // `role`, not `platformRole` — the page reads it for both the Role
        // column and its `isSuperAdmin()` check.
        role: 'SUPER_ADMIN',
        isActive: true,
        lastLoginAt: '2026-07-30T08:15:00.000Z',
    },
];

const PROMO_ROWS = [
    {
        id: 'p-1',
        code: 'WELCOME20',
        valueType: 'PERCENT',
        value: 20,
        status: 'ACTIVE',
        maxRedemptions: 100,
        // `redemptionsCount` — the table formats this field directly, so
        // the singular spelling renders "undefined / 100".
        redemptionsCount: 12,
        campaignTag: 'launch-2026',
        validFrom: '2026-01-01',
        validUntil: '2026-12-31',
    },
];

const PROMO_DETAIL = {
    promo: PROMO_ROWS[0],
    // Required. The page serialises this block, so leaving it out baselines an
    // empty one — an invalid response recorded as if it were the design.
    stats: {
        redemptions: 12,
        remaining: 88,
        discountedNetTotal: '240.00',
        firstRedeemedAt: '2026-01-08T10:00:00.000Z',
        lastRedeemedAt: '2026-02-19T16:30:00.000Z',
    },
    redemptions: [],
};

const PILOT_ROWS = [
    {
        id: 'pil-1',
        tenant: { id: 't-0001', slug: 'northwind', name: 'Northwind Ltd' },
        plan: 'PRO',
        pilotEndsAt: '2026-03-01T00:00:00.000Z',
        pilotNote: 'Evaluation until Q1',
        grantedBy: 'admin@fixture.test',
        grantedAt: '2026-01-01T00:00:00.000Z',
    },
];

const TENANT_DETAIL = {
    id: 't-0001',
    name: 'Northwind Ltd',
    slug: 'northwind',
    isActive: true,
    vatId: 'DE123456789',
    // Nested, not top-level: TenantMasterData reads `data.subscription?.plan`
    // and friends, so a flat `plan` renders an em dash in every one of them.
    subscription: {
        plan: 'PRO',
        status: 'ACTIVE',
        isPilot: false,
        trialEndsAt: null,
        pilotEndsAt: null,
    },
    users: [],
};

const EMAIL_ROW = {
    id: 'e-1',
    fromEmail: 'noreply@fixture.test',
    toEmail: 'admin@fixture.test',
    subject: 'Welcome',
    status: 'SENT',
    sentAt: '2026-01-14T10:00:00.000Z',
    createdAt: '2026-01-14T09:59:00.000Z',
};

const EMAIL_HISTORY = { rows: [EMAIL_ROW], total: 1 };
const EMAIL_DETAIL = { ...EMAIL_ROW, bodyHtml: '<p>Hello</p>' };

const EMAIL_PROVIDERS = [
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
        // `active`, not `isActive` — the tenant spelling leaves the pill
        // reading "inactive" and every SMTP column empty.
        active: true,
    },
];

/** Routing table. Matched EXACTLY — see `respondTo` for why. */
const ROUTES: ReadonlyArray<readonly [string, unknown]> = [
    ['/api/admin/boot', BOOT],
    ['/api/admin/manifest', FIXTURE_MANIFEST],
    ['/api/admin/tenants', TENANTS],
    ['/api/admin/users', USER_ROWS],
    ['/api/admin/audit', AUDIT_ROWS],
    ['/api/admin/subscriptions', SUBSCRIPTION_ROWS],
    // The full snapshot, not an empty stand-in. It used to be one, because the
    // pages that render a scan were handed `FIXTURE_DISCOVERY` as a prop and
    // nothing read this route for its contents. They fetch it now: an empty
    // snapshot leaves `BundlesPage` with no feature pills at all, and the
    // baseline recorded exactly that.
    ['/api/admin/discovery', FIXTURE_DISCOVERY],
    ['/api/admin/catalog/plans/tenant-counts', {}],
    ['/api/admin/catalog/plans/pl-1/versions', FIXTURE_PLAN_VERSIONS],
    ['/api/admin/catalog/bundles/b-1/versions', FIXTURE_BUNDLE_VERSIONS],
    // `{ bundle, versions }`, not a bare row: PlansPage reads
    // `body.bundle.bundleKey` to build its bundle cards.
    [
        '/api/admin/catalog/bundles/b-1',
        { bundle: FIXTURE_BUNDLES[0], versions: FIXTURE_BUNDLE_VERSIONS },
    ],
    ['/api/admin/catalog/features', FIXTURE_CATALOG_FEATURES],
    ['/api/admin/catalog/quotas', FIXTURE_CATALOG_QUOTAS],
    ['/api/admin/catalog/plans', FIXTURE_PLANS],
    ['/api/admin/catalog/bundles', FIXTURE_BUNDLES],
    ['/api/admin/catalog/entries', []],
    ['/api/admin/catalog/marketing-projections', FIXTURE_MARKETING_PROJECTIONS],
    ['/api/admin/catalog/marketing-settings', { activeLocales: ['en', 'de'] }],
    // Deliberately empty, and registered so that stays a decision rather than
    // an accident: it contributes no surface the token migration touches.
    ['/api/admin/catalog/promotions', []],
    ['/api/admin/catalog/capabilities', FIXTURE_CATALOG_CAPABILITIES],
    ['/api/admin/promo-codes', PROMO_ROWS],
    ['/api/admin/promo-codes/WELCOME20', PROMO_DETAIL],
    ['/api/admin/tenants/northwind', TENANT_DETAIL],
    ['/api/admin/pilots', PILOT_ROWS],
    // The page loads both lists. Deliberately empty and registered as such: an
    // unregistered path is a named gap, and the review strip carries no surface
    // the token migration touches.
    ['/api/admin/pilots/review', []],
    ['/api/admin/platform-email/providers', EMAIL_PROVIDERS],
    ['/api/admin/platform-email/history', EMAIL_HISTORY],
    ['/api/admin/platform-email/history/e-1', EMAIL_DETAIL],
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
