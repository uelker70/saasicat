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

// The notesapp backend serves the full DB-backed catalog plane
// (NotesCatalogModule), so the manifest contribution switches these standard
// pages on: dashboard, discovery, plans, planVersions, bundles, businessTypes
// and marketingCatalog. The child paths below mirror the platform's
// DEFAULT_STANDARD_PAGE_ROUTES so the sidebar links (built from the manifest)
// resolve. Thin wrappers under `src/pages/` bind each platform page to
// `platformHttp` + `projectKey='notesapp'`.

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
        ],
    },
];
