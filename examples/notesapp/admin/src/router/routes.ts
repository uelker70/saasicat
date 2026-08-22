import type { RouteRecordRaw } from 'vue-router';
import { createAdminRoutes } from '@saasicat/ui-vue';
import { standardAdminChildren } from '@saasicat/ui-vue/pages';
import SuperAdminLoginPage from '@saasicat/ui-vue/auth/SuperAdminLoginPage.vue';
import AdminLayout from '@saasicat/ui-vue/layouts/AdminLayout.vue';
import AdminManifestErrorPage from '@saasicat/ui-vue/pages/AdminManifestErrorPage.vue';

import AdminTenantsPage from '../pages/AdminTenantsPage.vue';
import AdminTenantDetailPage from '../pages/AdminTenantDetailPage.vue';
import AdminUsersPage from '../pages/AdminUsersPage.vue';
import AdminAuditPage from '../pages/AdminAuditPage.vue';
import AdminSubscriptionsPage from '../pages/AdminSubscriptionsPage.vue';
import AdminPromoCodesPage from '../pages/AdminPromoCodesPage.vue';

// The backend enables SaaSiCat's complete standard Admin API, and most pages
// need no wrapper at all: they read the platform's resource registry and take
// their project and locales from the shell. `standardAdminChildren` fills in
// everything this list does not claim — discovery, plans, bundles and the
// marketing catalogue among them — and `createAdminRoutes` supplies the shell
// every SuperAdmin app has (public `/login`, fail-closed `/admin-error`, the
// `/admin` layout with its redirect and the manifest catch-all).
//
// What is still listed here is listed for a reason: each of those wrappers
// carries a decision this app makes — its wording, its plan options, the row
// actions its operators get.

export const appRoutes: RouteRecordRaw[] = createAdminRoutes({
    loginPage: SuperAdminLoginPage,
    adminLayout: AdminLayout,
    adminErrorPage: AdminManifestErrorPage,
    children: standardAdminChildren([
        { path: 'tenants', component: AdminTenantsPage },
        { path: 'tenants/:slug', component: AdminTenantDetailPage },
        { path: 'users', component: AdminUsersPage },
        { path: 'audit', component: AdminAuditPage },
        { path: 'subscriptions', component: AdminSubscriptionsPage },
        { path: 'promo-codes', component: AdminPromoCodesPage },
    ]),
});
