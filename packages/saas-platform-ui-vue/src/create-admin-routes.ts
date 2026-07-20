// createAdminRoutes — shared route shell for SuperAdmin apps.
//
// The structure (public `/login`, fail-closed `/admin-error`, `/admin` layout
// with `→ dashboard` redirect + `ProjectPageHost` catch-all, `/` and
// 404 redirect) is identical across all consumers. App-specific are only the
// layout/error/login components and the concrete child pages — those the app
// passes through. Replaces the ~25 lines of copied route boilerplate per app.

import type { RouteRecordRaw } from 'vue-router';

import { createProjectPageHostRoute } from './project-page-host.js';

/** Eager or lazy component loader (`() => import(...)`). */
type RouteComponent = NonNullable<RouteRecordRaw['component']>;

export interface CreateAdminRoutesOptions {
    /**
     * Loader for the shared login page. The app passes it through as a
     * package-path import (resolved by the app bundler):
     * `() => import('@saasicat/ui-vue/pages-standard/SuperAdminLoginPage.vue')`.
     */
    loginPage: RouteComponent;
    /** Layout component for `/admin` (e.g. `() => import('@/layouts/AdminLayout.vue')`). */
    adminLayout: RouteComponent;
    /** Fail-closed error page for `manifestGuard.errorRoute` (`/admin-error`, public). */
    adminErrorPage: RouteComponent;
    /**
     * App-specific pages under `/admin` (without the `→ dashboard` redirect and
     * the `ProjectPageHost` catch-all — those the factory adds). Exactly the
     * `children` entries that are duplicated per app today.
     */
    children: RouteRecordRaw[];
    /** Default target of the `/admin` index redirect. Default `/admin/dashboard`. */
    dashboardPath?: string;
}

export function createAdminRoutes(options: CreateAdminRoutesOptions): RouteRecordRaw[] {
    return [
        {
            path: '/login',
            name: 'login',
            component: options.loginPage,
            meta: { public: true },
        },
        {
            // `meta.public: true` MUST be set, otherwise the route runs through
            // the manifest guard again → redirect loop.
            path: '/admin-error',
            name: 'admin-error',
            component: options.adminErrorPage,
            meta: { public: true },
        },
        {
            path: '/admin',
            component: options.adminLayout,
            children: [
                { path: '', redirect: options.dashboardPath ?? '/admin/dashboard' },
                ...options.children,
                // Catch-all for manifest ProjectPages — Vue Router 4 matches
                // more specific children first; the host only steps in when
                // no static page matches. MUST come last.
                createProjectPageHostRoute(),
            ],
        },
        { path: '/', redirect: '/admin' },
        { path: '/:pathMatch(.*)*', redirect: '/admin' },
    ];
}
