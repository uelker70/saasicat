import type { RouteRecordRaw } from 'vue-router';
import { createAdminRoutes } from '@saasicat/ui-vue';
import { standardAdminChildren } from '@saasicat/ui-vue/pages';
import SuperAdminLoginPage from '@saasicat/ui-vue/auth/SuperAdminLoginPage.vue';
import AdminLayout from '@saasicat/ui-vue/layouts/AdminLayout.vue';
import AdminManifestErrorPage from '@saasicat/ui-vue/pages/AdminManifestErrorPage.vue';

// `createAdminRoutes` supplies the shell every SuperAdmin app has: a public
// `/login`, a fail-closed `/admin-error`, and `/admin` with its index redirect
// and the catch-all that mounts manifest-declared project pages.
//
// `standardAdminChildren()` fills in the platform's own screens. Pass your own
// routes to it and yours win on a matching path:
//
//     children: standardAdminChildren([
//         { path: 'tenants', component: MyTenantsPage },
//     ])
//
// The error page is imported statically on purpose — a screen that reports a
// failed load must not be behind a load of its own.

export const appRoutes: RouteRecordRaw[] = createAdminRoutes({
    loginPage: SuperAdminLoginPage,
    adminLayout: AdminLayout,
    adminErrorPage: AdminManifestErrorPage,
    children: standardAdminChildren(),
});
