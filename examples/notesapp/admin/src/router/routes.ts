import type { RouteRecordRaw } from 'vue-router';
import SuperAdminLoginPage from '@saasicat/ui-vue/pages/SuperAdminLoginPage.vue';
import AdminLayout from '@saasicat/ui-vue/pages/AdminLayout.vue';
import AdminManifestErrorPage from '@saasicat/ui-vue/pages/AdminManifestErrorPage.vue';
import DashboardPage from '@saasicat/ui-vue/pages/DashboardPage.vue';

// This example runs the lightweight (YAML-plan) platform surface, so only the
// Dashboard is backed by endpoints. The manifest contribution
// (`src/saas/admin-manifest.contribution.ts`) switches every other standard
// page off, keeping the sidebar and the routes in sync. Add a page here once
// the backend grows the tables it needs, and flip it back on there.

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
        ],
    },
];
