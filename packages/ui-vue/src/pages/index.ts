// The pages this package publishes, and the route each one answers.
//
// Written out rather than globbed, and that is deliberate: a bundler has to see
// every `import()` as a literal to split it, and a consumer has to be able to
// read what they are getting. `tests/pages-barrel-is-complete.test.js` holds
// the list against the directory, so "written out" does not mean "maintained by
// remembering".
//
// Two kinds of entry, and the difference matters for anyone assembling routes:
//
//   - STANDARD pages answer a fixed path under `/admin` and are what
//     `createAdminRoutes({ standardPages: true })` mounts.
//   - The error page is not one of them. It sits at `/admin-error`, outside the
//     layout, public, and reachable only when the manifest fails to load —
//     mounting it as a child would put a fail-closed screen behind the guard
//     that failed.
//
// It is listed here for completeness, but IMPORT IT STATICALLY:
//
//     import AdminManifestErrorPage from '@saasicat/ui-vue/pages/AdminManifestErrorPage.vue';
//
// A screen that exists to report a failed load must not be behind a load of its
// own. Bundlers say so out loud — Rollup warns that the static import wins and
// the module stays in the main chunk, which is exactly what this screen needs.

import type { RouteRecordRaw } from 'vue-router';

import { PLAN_STEP_META } from '../features/plan/plan-area-context.js';

/** A lazily loaded SFC, the shape Vue Router takes as `component`. */
export type PageLoader = () => Promise<unknown>;

/** Every published page, by name. */
export const adminPages = {
    AuditPage: () => import('./AuditPage.vue'),
    BundlesPage: () => import('./BundlesPage.vue'),
    DashboardPage: () => import('./DashboardPage.vue'),
    DiscoveryPage: () => import('./DiscoveryPage.vue'),
    EmailHistoryPage: () => import('./EmailHistoryPage.vue'),
    MarketingCatalogPage: () => import('./MarketingCatalogPage.vue'),
    PilotsPage: () => import('./PilotsPage.vue'),
    PlansPage: () => import('./PlansPage.vue'),
    PlanVersionEditorPage: () => import('./PlanVersionEditorPage.vue'),
    PlanReviewPage: () => import('./PlanReviewPage.vue'),
    PlatformEmailPage: () => import('./PlatformEmailPage.vue'),
    PromoCodeDetailPage: () => import('./PromoCodeDetailPage.vue'),
    PromoCodesPage: () => import('./PromoCodesPage.vue'),
    SettingsPage: () => import('./SettingsPage.vue'),
    SubscriptionsPage: () => import('./SubscriptionsPage.vue'),
    TenantDetailPage: () => import('./TenantDetailPage.vue'),
    TenantsPage: () => import('./TenantsPage.vue'),
    UsersPage: () => import('./UsersPage.vue'),
    AdminManifestErrorPage: () => import('./AdminManifestErrorPage.vue'),
} satisfies Record<string, PageLoader>;

export type AdminPageName = keyof typeof adminPages;

/**
 * The path each standard page answers, relative to `/admin`.
 *
 * The paths are part of the contract, not a suggestion: the manifest's sidebar
 * entries and `ProjectPageHost` resolve against them, so an app that mounts
 * `TenantsPage` somewhere else gets a sidebar link that goes nowhere.
 */
export const STANDARD_ADMIN_ROUTES: ReadonlyArray<{
    readonly path: string;
    readonly page: AdminPageName;
    /**
     * Nested routes, mounted inside the parent's `<router-view>`.
     *
     * `plans` has two: the version editor and the review are steps of one
     * wizard whose draft is never saved between them, so the page that holds
     * that draft has to stay mounted while they render. Flat siblings would
     * unmount it, and "back" from the review would show an empty form.
     */
    readonly children?: ReadonlyArray<{ readonly path: string; readonly page: AdminPageName }>;
}> = [
    { path: 'dashboard', page: 'DashboardPage' },
    { path: 'discovery', page: 'DiscoveryPage' },
    {
        path: 'plans',
        page: 'PlansPage',
        children: [
            { path: 'version/edit', page: 'PlanVersionEditorPage' },
            { path: 'version/review', page: 'PlanReviewPage' },
        ],
    },
    { path: 'bundles', page: 'BundlesPage' },
    { path: 'marketing-catalog', page: 'MarketingCatalogPage' },
    { path: 'tenants', page: 'TenantsPage' },
    { path: 'tenants/:slug', page: 'TenantDetailPage' },
    { path: 'users', page: 'UsersPage' },
    { path: 'audit', page: 'AuditPage' },
    { path: 'subscriptions', page: 'SubscriptionsPage' },
    { path: 'promo-codes', page: 'PromoCodesPage' },
    { path: 'promo-codes/:code', page: 'PromoCodeDetailPage' },
    { path: 'pilots', page: 'PilotsPage' },
    { path: 'platform-email', page: 'PlatformEmailPage' },
    { path: 'email-history', page: 'EmailHistoryPage' },
    { path: 'settings', page: 'SettingsPage' },
];

/**
 * The standard pages as route records, ready to be the `children` of `/admin`.
 *
 * Pass your own routes and they win on a path collision — that is the point:
 * wrapping one page, to bind it to your own resource client for instance, must
 * not cost you the other fifteen and must not mount both at one path.
 *
 *     createAdminRoutes({
 *         loginPage, adminLayout, adminErrorPage,
 *         children: standardAdminChildren([
 *             { path: 'dashboard', component: MyDashboard },
 *         ]),
 *     })
 *
 * This lives here rather than in `createAdminRoutes` because the loaders reach
 * `.vue` files: `src/vue/` is bundled, and a bundler has no loader for those.
 * The layer boundary is the reason, and ESLint enforces it.
 */
export function standardAdminChildren(own: RouteRecordRaw[] = []): RouteRecordRaw[] {
    const claimed = new Set(own.map((route) => route.path));
    const standard = STANDARD_ADMIN_ROUTES.filter(({ path }) => !claimed.has(path)).map(
        ({ path, page, children }) =>
            ({
                path,
                component: adminPages[page],
                ...(children ? { children: stepsOf(children) } : {}),
            }) as RouteRecordRaw,
    );
    // A claimed route keeps the standard steps beneath it. Wrapping `PlansPage`
    // is the documented way to bind it to an app's own client, and the wrapped
    // page still navigates to `version/edit` — without the steps the router
    // fell through to the admin catch-all. An own `children` list wins outright.
    const adopted = own.map((route) => {
        const steps = STANDARD_ADMIN_ROUTES.find((s) => s.path === route.path)?.children;
        if (!steps || route.children) return route;
        return { ...route, children: stepsOf(steps) } as RouteRecordRaw;
    });
    return [...adopted, ...standard];
}

/**
 * A nested standard route is a STEP of its parent: it renders in the parent's
 * `<router-view>` and takes the page chrome over while it does. The parent
 * reads the marker to know it should stand aside, which beats comparing paths
 * — the consumer picks the base path, not us.
 */
function stepsOf(
    children: ReadonlyArray<{ readonly path: string; readonly page: AdminPageName }>,
): RouteRecordRaw[] {
    return children.map((child) => ({
        path: child.path,
        component: adminPages[child.page],
        meta: { [PLAN_STEP_META]: true },
    }));
}
