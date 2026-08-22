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
    SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY,
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
import { SUPER_ADMIN_CONFIRM_KEY, type UiConfirm } from '../vue/ui-confirm.js';
import {
    SUPER_ADMIN_RESOURCES_KEY,
    createResourceRegistry,
    type ResourceOverrides,
} from '../vue/resource-registry.js';
import { platformResources } from '../client/resources/index.js';
import {
    SA_THEME_KEY,
    createSaTheme,
    type SaTheme,
    type SaThemeOptions,
} from '../vue/use-sa-theme.js';
import {
    SUPER_ADMIN_I18N_KEY,
    createSuperAdminI18n,
    type SuperAdminI18n,
    type SuperAdminI18nOptions,
} from '../vue/use-super-admin-i18n.js';
import { bindSaThemeToDocument } from './dark-bridge.js';
import { resolveSuperAdminEndpoints } from '../vue/platform-loaders.js';
import { quasarNotify } from './notify.js';
import { quasarConfirm } from './confirm.js';

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
     * Optional: confirm port for the standard pages' "are you sure" step.
     * Default is the Quasar `Dialog` implementation — apps with their own
     * modal system replace it here without touching the pages.
     *
     * An implementation must actually ask. Resolving `{ ok: true }` outright
     * turns every guarded action into an unguarded one.
     */
    confirm?: UiConfirm;
    /**
     * Optional: per-resource adjustments to the platform's own endpoint
     * definitions — a different path for one resource, a different transport,
     * or a single operation wrapped. Everything not named keeps the platform
     * implementation.
     */
    resourceOverrides?: ResourceOverrides<typeof platformResources>;
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
    /**
     * Optional: UI locale + string overrides. Default is German. The created
     * context is returned on the handle (`handle.i18n`) — set
     * `handle.i18n.locale.value = 'en'` (or pass a `Ref` here) to switch at
     * runtime. Consumed via `useSuperAdminI18n()` / `useSaMessages()`.
     */
    i18n?: SuperAdminI18nOptions;
    /**
     * Optional: colour scheme. Default follows the operating system and
     * remembers an explicit pick. The context is returned on the handle
     * (`handle.theme`) — set `handle.theme.scheme.value = 'dark'` to switch at
     * runtime, and read it anywhere via `useSaTheme()`. The shell chrome
     * renders a three-way switcher for it; `theme: { switcher: false }` drops
     * it, as `i18n: { switcher: false }` drops the language one.
     *
     * Whatever it resolves to is mirrored onto `<html data-sa-theme>` AND into
     * Quasar's `Dark`, so the platform's surfaces and Quasar's own components
     * never disagree.
     */
    theme?: SaThemeOptions;
}

export interface SuperAdminAppHandle {
    app: App;
    router: Router;
    pinia: Pinia;
    /** i18n context of the shell — switch locale via `i18n.locale.value`. */
    i18n: SuperAdminI18n;
    /** Colour scheme of the shell — switch via `theme.scheme.value`. */
    theme: SaTheme;
    /** Mounts the app on a selector. Returns the root component instance. */
    mount: (selector: string | Element) => ReturnType<App['mount']>;
    /**
     * Releases what this helper attached to the DOCUMENT — the theme's
     * `prefers-color-scheme` subscription and the bridge that mirrors it onto
     * `data-sa-theme` and Quasar's `Dark`. Idempotent; it does not unmount the
     * app, which is `handle.app.unmount()`.
     *
     * Only matters where a shell is torn down while the document survives: hot
     * reload, a micro-frontend, a second shell in one page. Skip it and the old
     * bridge keeps writing to the one document on the next OS theme change, and
     * can overrule the scheme the new shell was given.
     */
    dispose: () => void;
}

/** Marks Quasar's teleported nodes so the theme can reach them. Exported so a
 * test fixture can install the same config a real app gets — without it the
 * `.sa-portal` rules are exercised by nothing. */
export const SA_PORTAL_CLASS = 'sa-portal';

const DEFAULT_QUASAR_OPTIONS: QuasarPluginOptions = {
    plugins: { Notify, Dialog, Loading },
    config: { notify: { position: 'top-right', timeout: 3000 } },
};

/**
 * Merges an app's Quasar options over the platform's, keeping the plugins the
 * shell's own ports depend on.
 *
 * The bootstrap provides `quasarConfirm`, which calls `Dialog.create`, and the
 * notify port's fallback calls `Notify.create`. Taking the app's options whole
 * — as this did — left those uninstalled for anything passing
 * `{ plugins: {}, … }`, a shape this package's own tests use: the first
 * confirmation threw instead of asking, turning a guarded action into a broken
 * one rather than a stricter one.
 *
 * An app's own entry still wins on a key collision, so its build of a plugin
 * replaces the platform's.
 *
 * Exported because it is the whole of the decision, and the only part of the
 * bootstrap that can be checked without driving a real Quasar install.
 */
export function resolveQuasarOptions(own?: Partial<QuasarPluginOptions>): QuasarPluginOptions {
    if (!own) return DEFAULT_QUASAR_OPTIONS;
    return {
        ...own,
        plugins: { ...DEFAULT_QUASAR_OPTIONS.plugins, ...own.plugins },
    } as QuasarPluginOptions;
}

/**
 * Universal bootstrap function for SuperAdmin apps. Replaces the `main.ts`
 * boilerplate duplicated per app today (Quasar + Pinia + Router + manifest
 * guard) and exposes the platform maps via `provide()` for downstream
 * components.
 */
export function createSuperAdminApp(options: CreateSuperAdminAppOptions): SuperAdminAppHandle {
    const app = createApp(options.rootComponent);

    // Quasar teleports every dialog, menu and tooltip into a div appended to
    // `<body>`, so a rule prefixed with `.sa-page` never reaches them — which is
    // why dialog cards kept Quasar's neutral grey in dark mode while the page
    // behind them was slate, and why the outlined-field correction had silently
    // never applied inside a dialog.
    //
    // Scope, stated plainly: `globalNodes` is document-wide, not per-owner —
    // `createGlobalNode` stamps the class on every portal Quasar opens, the
    // shell's own and any a contributed project page opens inside it. That is
    // intended: a page mounted in the admin shell is admin UI, and the same
    // theme already repaints its cards via `.sa-page`. What the class buys is
    // that an app which never calls `createSuperAdminApp` stays untouched —
    // which a bare `.q-dialog .q-card` rule could not promise.
    const quasarOptions = resolveQuasarOptions(options.quasarOptions);
    // `globalNodes` is a documented Quasar config option that its TypeScript
    // types do not declare (see quasar/src/utils/private.config/nodes.js, which
    // reads `globalConfig.globalNodes.class`). The cast is the exception this
    // codebase allows for an API that exists and is simply untyped upstream.
    const config = quasarOptions.config as Record<string, unknown> | undefined;
    const existingPortalClass = (config?.globalNodes as { class?: string } | undefined)?.class;
    app.use(Quasar, {
        ...quasarOptions,
        config: {
            ...quasarOptions.config,
            globalNodes: {
                class: [existingPortalClass, SA_PORTAL_CLASS].filter(Boolean).join(' '),
            },
        },
    } as QuasarPluginOptions);

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

    const endpoints = resolveSuperAdminEndpoints(options.endpoints);
    const http = options.http ?? defaultHttpClient();

    const i18n = createSuperAdminI18n(options.i18n);
    // An app that configured Quasar's dark mode has STATED a preference; the
    // platform's default of 'system' has not. Seeding from it keeps the
    // documented "Quasar decided" path working here — without it the bridge's
    // first, immediate tick resolved 'system' against the machine and called
    // `Dark.set()` with the answer, erasing the app's own choice one line after
    // it was applied. In both directions: a configured `true` was undone on a
    // light machine, a configured `false` on a dark one.
    //
    // Read from the OPTION rather than from `Dark.isActive`, because the option
    // distinguishes three states and the resulting flag only two: `'auto'` means
    // "follow the machine", which is what 'system' already does, and reading the
    // flag would freeze whatever the machine happened to say at boot.
    //
    // A stored operator pick still outranks this — `createSaTheme` gives storage
    // precedence over the `scheme` option — because that is a person choosing
    // rather than a default.
    const configuredDark = options.quasarOptions?.config?.dark;
    const theme = createSaTheme({
        ...options.theme,
        scheme:
            options.theme?.scheme ??
            (typeof configuredDark === 'boolean' ? (configuredDark ? 'dark' : 'light') : undefined),
    });
    const stopThemeBridge = bindSaThemeToDocument(theme);

    app.provide(SUPER_ADMIN_BRAND_KEY, { tag: 'SuperAdmin', ...options.brand });
    app.provide(SUPER_ADMIN_I18N_KEY, i18n);
    app.provide(SA_THEME_KEY, theme);
    app.provide(SUPER_ADMIN_ENDPOINTS_KEY, endpoints);
    app.provide(SUPER_ADMIN_EXTENSIONS_KEY, options.extensions ?? {});
    app.provide(SUPER_ADMIN_ACTIONS_KEY, options.actions ?? {});
    app.provide(SUPER_ADMIN_NOTIFY_KEY, options.notify ?? quasarNotify);
    app.provide(SUPER_ADMIN_CONFIRM_KEY, options.confirm ?? quasarConfirm);
    // Only when the app named its client. `createResourceRegistry` refuses to
    // be built without one, because a bare `fetch` sends every request without
    // the app's Authorization header and the failure is silent. Handing it the
    // `defaultHttpClient()` fallback here would defeat exactly that guarantee
    // from inside the bootstrap: the pages would keep rendering while every
    // request they issued collected a 401.
    //
    // Without a client the registry is simply absent, and `useResource` says
    // so — a named failure at the first call beats a page that renders empty.
    if (options.http) {
        app.provide(
            SUPER_ADMIN_RESOURCES_KEY,
            createResourceRegistry({
                http: options.http,
                // Read per call: the locale changes while the app runs.
                context: () => ({
                    apiBase: endpoints.apiBase,
                    projectKey: endpoints.projectKey,
                    locale: i18n.locale.value,
                }),
                resources: platformResources,
                overrides: options.resourceOverrides,
            }),
        );
    }
    if (options.manifestGuard?.getManifest) {
        app.provide(SUPER_ADMIN_MANIFEST_KEY, options.manifestGuard.getManifest);
    }
    if (options.manifestGuard?.clearCache) {
        app.provide(SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY, options.manifestGuard.clearCache);
    }
    if (options.loginAdapter) {
        app.provide(SUPER_ADMIN_LOGIN_ADAPTER_KEY, options.loginAdapter);
    }
    app.provide(SUPER_ADMIN_HTTP_KEY, http);

    for (const plugin of options.installPlugins ?? []) {
        plugin(app);
    }

    return {
        app,
        router,
        pinia,
        i18n,
        theme,
        mount: (selector) => app.mount(selector),
        dispose: () => {
            stopThemeBridge();
            theme.dispose();
        },
    };
}
