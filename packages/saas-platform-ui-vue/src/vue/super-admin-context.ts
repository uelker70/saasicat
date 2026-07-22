// SuperAdmin shell contract — injection keys, option types and the
// navigation guard shared between the Quasar bootstrap
// (`createSuperAdminApp()`, `@saasicat/ui-vue/quasar`) and the framework
// components/composables in this package.
//
// Lives in the Vue layer (no Quasar import) so that the main entry and all
// composables stay consumable without Quasar being installed.

import type { App, Component, InjectionKey } from 'vue';
import type { NavigationGuardWithThis, RouteLocationNormalized } from 'vue-router';

import type { ActionKey, AdminManifest, ComponentKey } from '@saasicat/types';
import type { ActionHandler } from '../client/action-registry.js';
import type { HttpClient } from '../client/types.js';

/**
 * App-specific branding data that the platform `AdminLayout` and other
 * consumers read via `useSuperAdminBrand()`.
 */
export interface SuperAdminBrand {
    /** 2-letter abbreviation in the logo badge (`'ma'`, `'da'`, …). */
    logoText: string;
    /** Full display name (`'DemoApp'`, `'ClubApp'`, …). */
    name: string;
    /** Optional: tag to the right of the name, default `'SuperAdmin'`. */
    tag?: string;
}

/**
 * Endpoint configuration. `apiBase` is the shared prefix under which
 * `/manifest`, `/boot` and extra routes live.
 */
export interface SuperAdminEndpoints {
    /** Shared prefix, e.g. `'/api/admin'` or `'/api/v1/admin'`. */
    apiBase: string;
    /** Pre-login branding endpoint, default `${apiBase}/boot`. */
    publicBootEndpoint?: string;
    /** Post-login full-manifest endpoint, default `${apiBase}/manifest`. */
    manifestEndpoint?: string;
}

export type ExtensionLoader = () => Promise<Component | { default: Component }>;
export type ExtensionsMap = Record<ComponentKey, ExtensionLoader>;
export type ActionsMap = Record<ActionKey, ActionHandler>;

export interface SuperAdminAuthGuardOptions {
    /** App provides: is the user currently logged in? */
    isAuthenticated: () => boolean;
    /** App provides: does the user have the SuperAdmin role? Default: only check `isAuthenticated`. */
    isSuperAdmin?: () => boolean;
    /** App provides: redirect path for unauthenticated calls (e.g. `'/login'`). */
    onUnauthenticated: () => string;
}

/**
 * Result of a login attempt. Apps pass this back from their auth store to the
 * platform LoginPage; the page renders an appropriate error message.
 *
 * `ok: true` → login succeeded, page redirects to `redirectAfterLogin`.
 * `ok: false` → page shows `message` or a translation derived from `code`.
 *
 * Known codes:
 *   - `BAD_CREDENTIALS` — wrong email/password combination.
 *   - `NOT_SUPER_ADMIN` — account does not have the SuperAdmin role.
 *   - otherwise          — app-specific; `message` is displayed directly.
 */
export type SuperAdminLoginResult =
    | { ok: true }
    | { ok: false; code?: 'BAD_CREDENTIALS' | 'NOT_SUPER_ADMIN' | string; message?: string };

/**
 * Login adapter. The app passes its auth-store call through here. The platform
 * LoginPage consumes it via `useSuperAdminLoginAdapter()`, without knowledge
 * of app-specific stores (Pinia, auth API routes, MFA hooks).
 */
export interface SuperAdminLoginAdapter {
    /**
     * Performs the login. The app store encapsulates the API call, token
     * storage, MFA hops etc.
     */
    login(email: string, password: string): Promise<SuperAdminLoginResult>;
    /**
     * Target route after a successful login. Default: `/admin/dashboard`
     * (platform convention for the standard pages — apps with a different
     * default mount override this here).
     */
    redirectAfterLogin?: string;
    /**
     * Optional: dev hint (test account), shown below the form. Deliberately
     * rendered only when `environment !== 'production'`.
     */
    devHint?: { email: string; password: string };
}

export interface SuperAdminManifestGuardOptions {
    /**
     * App provides: loads the manifest into the app store. The router guard
     * `await`s the promise before the route is resolved.
     *
     * **On loader error:** the promise REJECTS. The router guard catches the
     * rejection and decides depending on `errorRoute`:
     *   - `errorRoute` set → redirect to this route (fail-closed).
     *   - `errorRoute` not set → `console.error` + render allowed
     *     (defensive default behavior; the app must render the manifest gap
     *     itself).
     */
    ensureLoaded: () => Promise<void>;
    /**
     * Optional: read accessor on the loaded manifest. When set, it is exposed
     * via `provide(SUPER_ADMIN_MANIFEST_KEY)` — the `<ProjectPageHost>`
     * resolves manifest `projectPages` through it against the
     * `extensions:` map.
     */
    getManifest?: () => AdminManifest | null;
    /**
     * Optional: path that the router guard redirects to on a manifest load
     * error (fail-closed mode). The app must register the route in `appRoutes`
     * and mark it as `meta.public = true`, otherwise it runs through the
     * manifest guard again and produces a redirect loop.
     */
    errorRoute?: string;
}

/**
 * Guard configuration shared by `buildNavigationGuard()` and
 * `createSuperAdminApp()` (which embeds both fields in its options).
 */
export interface SuperAdminGuardOptions {
    /**
     * Optional: auth guard. When set, `router.beforeEach` is wired up
     * automatically — `to.meta.public === true` bypasses the guard.
     */
    authGuard?: SuperAdminAuthGuardOptions;
    /**
     * Optional: manifest guard. Runs after a successful auth guard, blocks the
     * render until the manifest is loaded (prevents sidebar flicker).
     */
    manifestGuard?: SuperAdminManifestGuardOptions;
}

// Vue inject keys are registered globally via `Symbol.for(...)`. Reason:
// apps import `createSuperAdminApp` (and thus `app.provide(KEY, ...)`) from
// the built `dist/` bundles, but shared `.vue` pages in the
// `pages-standard/` directory directly from `src/`. Both paths produce two
// independent module instances — with local `Symbol(...)` the identity would
// differ, and `inject()` would always throw "not found". `Symbol.for(...)`
// resolves both imports to the same symbol.

/** Vue inject key for `useSuperAdminBrand()`. */
export const SUPER_ADMIN_BRAND_KEY: InjectionKey<SuperAdminBrand> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_BRAND',
);
/** Vue inject key for `useSuperAdminEndpoints()`. */
export const SUPER_ADMIN_ENDPOINTS_KEY: InjectionKey<Required<SuperAdminEndpoints>> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_ENDPOINTS',
);
/** Vue inject key for `useSuperAdminExtensions()`. */
export const SUPER_ADMIN_EXTENSIONS_KEY: InjectionKey<ExtensionsMap> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_EXTENSIONS',
);
/** Vue inject key for `useSuperAdminActions()`. */
export const SUPER_ADMIN_ACTIONS_KEY: InjectionKey<ActionsMap> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_ACTIONS',
);
/**
 * Vue inject key for the manifest accessor. Only provided when
 * `manifestGuard.getManifest` was passed to `createSuperAdminApp()` — the
 * `<ProjectPageHost>` needs it to resolve project pages.
 */
export const SUPER_ADMIN_MANIFEST_KEY: InjectionKey<() => AdminManifest | null> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_MANIFEST',
);
/** Vue inject key for `useSuperAdminLoginAdapter()`. */
export const SUPER_ADMIN_LOGIN_ADAPTER_KEY: InjectionKey<SuperAdminLoginAdapter> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_LOGIN_ADAPTER',
);
/** Vue inject key for `useSuperAdminHttp()` (pre-login HttpClient). */
export const SUPER_ADMIN_HTTP_KEY: InjectionKey<HttpClient> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_HTTP',
);

/**
 * Additional Vue plugins (e.g. an app's own NotificationCenter) that a
 * bootstrap installs after the platform setup, before the mount.
 */
export type InstallPlugin = (app: App) => void;

/**
 * Internal helper, exported for isolated unit tests of the navigation
 * behavior (auth redirect, manifest fail-closed path). Consumers should call
 * `createSuperAdminApp()`, not this helper directly.
 */
export function buildNavigationGuard(
    options: SuperAdminGuardOptions,
): NavigationGuardWithThis<undefined> | null {
    const { authGuard, manifestGuard } = options;
    if (!authGuard && !manifestGuard) return null;

    return async (to: RouteLocationNormalized) => {
        if (to.meta?.public === true) return true;

        if (authGuard) {
            if (!authGuard.isAuthenticated()) return authGuard.onUnauthenticated();
            if (authGuard.isSuperAdmin && !authGuard.isSuperAdmin()) {
                return authGuard.onUnauthenticated();
            }
        }

        if (manifestGuard) {
            try {
                await manifestGuard.ensureLoaded();
            } catch (err) {
                if (manifestGuard.errorRoute && to.path !== manifestGuard.errorRoute) {
                    return manifestGuard.errorRoute;
                }
                // No errorRoute configured — defensive fallback: warn, allow
                // render. The app can detect the error via the store
                // (`error.value`) and render a banner/stub.

                console.error('[SuperAdmin] manifest load failed', err);
            }
        }

        return true;
    };
}
