import type { RouteRecordRaw } from 'vue-router';
import SuperAdminLoginPage from '@saasicat/ui-vue/pages/SuperAdminLoginPage.vue';
import AdminLayout from '@saasicat/ui-vue/pages/AdminLayout.vue';
import AdminManifestErrorPage from '@saasicat/ui-vue/pages/AdminManifestErrorPage.vue';
import DashboardPage from '@saasicat/ui-vue/pages/DashboardPage.vue';
import AdminDiscoveryPage from '../pages/AdminDiscoveryPage.vue';
import AdminPlansPage from '../pages/AdminPlansPage.vue';
import AdminPlanVersionsPage from '../pages/AdminPlanVersionsPage.vue';
import AdminBundlesPage from '../pages/AdminBundlesPage.vue';
import AdminBusinessTypesPage from '../pages/AdminBusinessTypesPage.vue';
import AdminMarketingCatalogPage from '../pages/AdminMarketingCatalogPage.vue';
import AdminTenantsPage from '../pages/AdminTenantsPage.vue';
import AdminTenantDetailPage from '../pages/AdminTenantDetailPage.vue';
import AdminUsersPage from '../pages/AdminUsersPage.vue';
import AdminAuditPage from '../pages/AdminAuditPage.vue';
import AdminSubscriptionsPage from '../pages/AdminSubscriptionsPage.vue';
import AdminPromoCodesPage from '../pages/AdminPromoCodesPage.vue';

// The notesapp backend serves the full DB-backed catalog plane
// (NotesCatalogModule) plus the app-owned domain pages (NotesPlatformPagesModule),
// so the manifest contribution switches these standard pages on: dashboard,
// discovery, plans, planVersions, bundles, businessTypes, marketingCatalog,
// tenants, users, audit, subscriptions and promoCodes. The child paths below
// mirror the platform's DEFAULT_STANDARD_PAGE_ROUTES so the sidebar links
// (built from the manifest) resolve. Thin wrappers under `src/pages/` bind each
// platform page to `platformHttp` + the app-owned loader callbacks.

export const appRoutes: RouteRecordRaw[] = [
    { path: '/login', component: SuperAdminLoginPage, meta: { public: true } },
    {
        path: '/admin-error',
        component: AdminManifestErrorPage,
        meta: { public: true },
    },
    {
        path: '/admin',
        component: AdminLayout,
        children: [
            { path: '', redirect: '/admin/dashboard' },
            { path: 'dashboard', component: DashboardPage },
            { path: 'discovery', component: AdminDiscoveryPage },
            { path: 'plans', component: AdminPlansPage },
            { path: 'plan-versions', component: AdminPlanVersionsPage },
            { path: 'bundles', component: AdminBundlesPage },
            { path: 'business-types', component: AdminBusinessTypesPage },
            { path: 'marketing-catalog', component: AdminMarketingCatalogPage },
            { path: 'tenants', component: AdminTenantsPage },
            { path: 'tenants/:slug', component: AdminTenantDetailPage },
            { path: 'users', component: AdminUsersPage },
            { path: 'audit', component: AdminAuditPage },
            { path: 'subscriptions', component: AdminSubscriptionsPage },
            { path: 'promo-codes', component: AdminPromoCodesPage },
        ],
    },
];
