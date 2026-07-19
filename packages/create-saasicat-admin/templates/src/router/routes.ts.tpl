import type { RouteRecordRaw } from 'vue-router';
import SuperAdminLoginPage from '@saasicat/ui-vue/pages/SuperAdminLoginPage.vue';
import AdminLayout from '@saasicat/ui-vue/pages/AdminLayout.vue';
import AdminManifestErrorPage from '@saasicat/ui-vue/pages/AdminManifestErrorPage.vue';
import DashboardPage from '@saasicat/ui-vue/pages/DashboardPage.vue';
import TenantsPage from '@saasicat/ui-vue/pages/TenantsPage.vue';
import PlansPage from '@saasicat/ui-vue/pages/PlansPage.vue';
import DiscoveryPage from '@saasicat/ui-vue/pages/DiscoveryPage.vue';

// Standard-Pages der Plattform. Eigene Project-Pages werden über
// `createProjectPageHostRoute()` als Catch-all am Ende gemountet.

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
            { path: 'tenants', component: TenantsPage },
            { path: 'plans', component: PlansPage },
            { path: 'discovery', component: DiscoveryPage },
        ],
    },
];
