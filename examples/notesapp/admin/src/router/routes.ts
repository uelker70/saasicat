import type { RouteRecordRaw } from 'vue-router';
import { createAdminRoutes } from '@saasicat/ui-vue';
import { standardAdminChildren } from '@saasicat/ui-vue/pages';
import SuperAdminLoginPage from '@saasicat/ui-vue/auth/SuperAdminLoginPage.vue';
import AdminLayout from '@saasicat/ui-vue/layouts/AdminLayout.vue';
import AdminManifestErrorPage from '@saasicat/ui-vue/pages/AdminManifestErrorPage.vue';

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

// The backend enables SaaSiCat's complete standard Admin API. NotesApp wraps
// most pages to bind them to one shared resource client, and takes the rest —
// the dashboard among them — straight from the package: `standardAdminChildren`
// fills in whatever this list does not claim, and `createAdminRoutes` supplies
// the shell every SuperAdmin app has (public `/login`, fail-closed
// `/admin-error`, the `/admin` layout with its redirect and the manifest
// catch-all).

export const appRoutes: RouteRecordRaw[] = createAdminRoutes({
    loginPage: SuperAdminLoginPage,
    adminLayout: AdminLayout,
    adminErrorPage: AdminManifestErrorPage,
    children: standardAdminChildren([
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
    ]),
});
