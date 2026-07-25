import type { RouteRecordRaw } from 'vue-router';
import SuperAdminLoginPage from '@saasicat/ui-vue/pages/SuperAdminLoginPage.vue';
import AdminLayout from '@saasicat/ui-vue/pages/AdminLayout.vue';
import AdminManifestErrorPage from '@saasicat/ui-vue/pages/AdminManifestErrorPage.vue';
import DashboardPage from '@saasicat/ui-vue/pages/DashboardPage.vue';
import AdminDiscoveryPage from '../pages/AdminDiscoveryPage.vue';
import AdminPlansPage from '../pages/AdminPlansPage.vue';
import AdminBundlesPage from '../pages/AdminBundlesPage.vue';
import AdminMarketingCatalogPage from '../pages/AdminMarketingCatalogPage.vue';
import AdminTenantsPage from '../pages/AdminTenantsPage.vue';
import AdminTenantDetailPage from '../pages/AdminTenantDetailPage.vue';
import AdminUsersPage from '../pages/AdminUsersPage.vue';
import AdminAuditPage from '../pages/AdminAuditPage.vue';
import AdminSubscriptionsPage from '../pages/AdminSubscriptionsPage.vue';
import AdminPromoCodesPage from '../pages/AdminPromoCodesPage.vue';

// The backend enables SaaSiCat's complete standard Admin API: discovery,
// catalog, tenants, users, audit, subscriptions and promo codes. NotesApp adds
// only its dashboard KPIs. These routes keep every standard page visible; the
// thin wrappers bind the reusable pages to one shared resource client.

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
            { path: 'bundles', component: AdminBundlesPage },
            { path: 'marketing-catalog', component: AdminMarketingCatalogPage },
            { path: 'tenants', component: AdminTenantsPage },
            { path: 'tenants/:slug', component: AdminTenantDetailPage },
            { path: 'users', component: AdminUsersPage },
            { path: 'audit', component: AdminAuditPage },
            { path: 'subscriptions', component: AdminSubscriptionsPage },
            { path: 'promo-codes', component: AdminPromoCodesPage },
        ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/admin' },
];
