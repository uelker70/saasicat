// createSuperAdminApp — universal bootstrap helper for SuperAdmin Vue apps.
// Bundles the Quasar/Pinia/Router setup that every consumer app rebuilds itself
// today, and exposes the platform contract maps (`extensions:`, `actions:`)
// via `provide()`.
//
// This module is the Quasar layer entry (`@saasicat/ui-vue/quasar`) — the only
// non-page module in the package that imports `quasar`. The injection keys,
// option types and the navigation guard live in the Vue layer
// (`super-admin-context.ts`) so the main entry stays Quasar-free.
//
// What the helper does NOT do:
//   - Auth stores, login flows, JWT refresh — app-specific.
//   - CSS imports (Quasar CSS, Material Icons, app theme) — these stay in the
//     app's own `main.ts`, because tsup does not bundle CSS.

import { createApp, type App, type Component } from 'vue';
import { Quasar, Notify, Dialog, Loading, type QuasarPluginOptions } from 'quasar';
import { createPinia, type Pinia } from 'pinia';
import {
    createRouter,
    createWebHistory,
    type RouteRecordRaw,
    type Router,
    type RouterHistory,
} from 'vue-router';

import { defaultHttpClient, type HttpClient } from '../client/types.js';
import {
    SUPER_ADMIN_ACTIONS_KEY,
    SUPER_ADMIN_BRAND_KEY,
    SUPER_ADMIN_ENDPOINTS_KEY,
    SUPER_ADMIN_EXTENSIONS_KEY,
    SUPER_ADMIN_HTTP_KEY,
    SUPER_ADMIN_LOGIN_ADAPTER_KEY,
    SUPER_ADMIN_MANIFEST_KEY,
    buildNavigationGuard,
    type ActionsMap,
    type ExtensionsMap,
    type InstallPlugin,
    type SuperAdminBrand,
    type SuperAdminEndpoints,
    type SuperAdminGuardOptions,
    type SuperAdminLoginAdapter,
} from '../vue/super-admin-context.js';
import { SUPER_ADMIN_NOTIFY_KEY, type UiNotify } from '../vue/ui-notify.js';
import { quasarNotify } from './notify.js';

export interface CreateSuperAdminAppOptions extends SuperAdminGuardOptions {
    /** App root component (`App.vue`). */
    rootComponent: Component;
    /** App branding (logo, name). */
    brand: SuperAdminBrand;
    /** Endpoint configuration. */
    endpoints: SuperAdminEndpoints;
    /** App's own routes (login, standard pages, bundle pages, …). */
    appRoutes: RouteRecordRaw[];
    /**
     * Static `extensions:` map. Manifest `projectPages[].componentKey` is
     * looked up in it (see Spec §4.4).
     */
    extensions?: ExtensionsMap;
    /**
     * Static `actions:` map. Manifest `tenants.actions[].actionKey` is looked
     * up in it.
     */
    actions?: ActionsMap;
    /**
     * Optional: login adapter. When set, it is exposed via `provide()` for the
     * shared `<SuperAdminLoginPage>` (from `pages-standard/`) — the app no
     * longer needs to hold its own LoginPage Vue component.
     */
    loginAdapter?: SuperAdminLoginAdapter;
    /**
     * Optional: router history variant, default `createWebHistory()`.
     * Apps with a subpath mount override this.
     */
    routerHistory?: RouterHistory;
    /**
     * Optional: Quasar configuration. Default loads `Notify`/`Dialog`/`Loading`
     * with the established consumer convention (`top-right`, 3 s).
     */
    quasarOptions?: Partial<QuasarPluginOptions>;
    /**
     * Optional: notify port for the standard pages' toasts. Default is the
     * Quasar `Notify` implementation — apps with their own notification
     * center replace it here without touching the pages.
     */
    notify?: UiNotify;
    /**
     * Optional: additional Vue plugins (e.g. an app's own NotificationCenter)
     * that are installed after the platform setup, before the mount.
     */
    installPlugins?: InstallPlugin[];
    /**
     * Optional: `HttpClient` for all pre-login calls (boot, first-run setup).
     * Default `defaultHttpClient()` (= `fetch`). Consumers pass their own
     * variant through (auth header, baseURL, retry) — it then applies uniformly,
     * including for the setup wizard. Consumed via `useSuperAdminHttp()`.
     */
    http?: HttpClient;
}

export interface SuperAdminAppHandle {
    app: App;
    router: Router;
    pinia: Pinia;
    /** Mounts the app on a selector. Returns the root component instance. */
    mount: (selector: string | Element) => ReturnType<App['mount']>;
}

const DEFAULT_QUASAR_OPTIONS: QuasarPluginOptions = {
    plugins: { Notify, Dialog, Loading },
    config: { notify: { position: 'top-right', timeout: 3000 } },
};

/**
 * Universal bootstrap function for SuperAdmin apps. Replaces the `main.ts`
 * boilerplate duplicated per app today (Quasar + Pinia + Router + manifest
 * guard) and exposes the platform maps via `provide()` for downstream
 * components.
 */
export function createSuperAdminApp(options: CreateSuperAdminAppOptions): SuperAdminAppHandle {
    const app = createApp(options.rootComponent);

    app.use(Quasar, options.quasarOptions ?? DEFAULT_QUASAR_OPTIONS);

    const pinia = createPinia();
    app.use(pinia);

    const router = createRouter({
        history: options.routerHistory ?? createWebHistory(),
        routes: options.appRoutes,
    });

    const navGuard = buildNavigationGuard(options);
    if (navGuard) {
        router.beforeEach(navGuard);
    }

    app.use(router);

    const endpoints: Required<SuperAdminEndpoints> = {
        apiBase: options.endpoints.apiBase,
        publicBootEndpoint:
            options.endpoints.publicBootEndpoint ?? `${options.endpoints.apiBase}/boot`,
        manifestEndpoint:
            options.endpoints.manifestEndpoint ?? `${options.endpoints.apiBase}/manifest`,
    };

    app.provide(SUPER_ADMIN_BRAND_KEY, { tag: 'SuperAdmin', ...options.brand });
    app.provide(SUPER_ADMIN_ENDPOINTS_KEY, endpoints);
    app.provide(SUPER_ADMIN_EXTENSIONS_KEY, options.extensions ?? {});
    app.provide(SUPER_ADMIN_ACTIONS_KEY, options.actions ?? {});
    app.provide(SUPER_ADMIN_NOTIFY_KEY, options.notify ?? quasarNotify);
    if (options.manifestGuard?.getManifest) {
        app.provide(SUPER_ADMIN_MANIFEST_KEY, options.manifestGuard.getManifest);
    }
    if (options.loginAdapter) {
        app.provide(SUPER_ADMIN_LOGIN_ADAPTER_KEY, options.loginAdapter);
    }
    app.provide(SUPER_ADMIN_HTTP_KEY, options.http ?? defaultHttpClient());

    for (const plugin of options.installPlugins ?? []) {
        plugin(app);
    }

    return {
        app,
        router,
        pinia,
        mount: (selector) => app.mount(selector),
    };
}
