// createAdminRoutes — geteilte Routen-Shell für SuperAdmin-Apps.
//
// Die Struktur (öffentliche `/login`, fail-closed `/admin-error`, `/admin`-Layout
// mit `→ dashboard`-Redirect + `ProjectPageHost`-Catch-all, `/`- und
// 404-Redirect) ist über alle Konsumenten identisch. App-spezifisch sind nur die
// Layout-/Error-/Login-Komponenten und die konkreten Child-Pages — die reicht die
// App durch. Ersetzt die je App ~25 Zeilen kopierte Routen-Boilerplate.

import type { RouteRecordRaw } from 'vue-router';

import { createProjectPageHostRoute } from './project-page-host.js';

/** Eager- oder Lazy-Component-Loader (`() => import(...)`). */
type RouteComponent = NonNullable<RouteRecordRaw['component']>;

export interface CreateAdminRoutesOptions {
    /**
     * Loader der geteilten Login-Seite. Die App reicht ihn als Package-Pfad-Import
     * durch (resolved im App-Bundler):
     * `() => import('@saasicat/ui-vue/pages-standard/SuperAdminLoginPage.vue')`.
     */
    loginPage: RouteComponent;
    /** Layout-Komponente für `/admin` (z. B. `() => import('@/layouts/AdminLayout.vue')`). */
    adminLayout: RouteComponent;
    /** Fail-closed-Error-Seite für `manifestGuard.errorRoute` (`/admin-error`, public). */
    adminErrorPage: RouteComponent;
    /**
     * App-spezifische Seiten unter `/admin` (ohne den `→ dashboard`-Redirect und
     * den `ProjectPageHost`-Catch-all — die ergänzt die Factory). Genau die
     * `children`-Einträge, die heute je App dupliziert sind.
     */
    children: RouteRecordRaw[];
    /** Default-Ziel des `/admin`-Index-Redirects. Default `/admin/dashboard`. */
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
            // `meta.public: true` MUSS gesetzt sein, sonst läuft die Route wieder
            // durch den Manifest-Guard → Redirect-Schleife.
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
                // Catch-all für Manifest-ProjectPages — Vue-Router-4 matcht
                // spezifischere Children zuerst; der Host springt nur ein, wenn
                // keine statische Page passt. MUSS zuletzt stehen.
                createProjectPageHostRoute(),
            ],
        },
        { path: '/', redirect: '/admin' },
        { path: '/:pathMatch(.*)*', redirect: '/admin' },
    ];
}
