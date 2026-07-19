// createSuperAdminApp — universeller Bootstrap-Helper für SuperAdmin-Vue-Apps.
// Bündelt das Quasar/Pinia/Router-Setup, das jede Konsumenten-App heute selbst
// nachbaut, und stellt die Plattform-Vertrags-Maps (`extensions:`, `actions:`)
// per `provide()` zur Verfügung.
//
// Was der Helper NICHT macht:
//   - Auth-Stores, Login-Flows, JWT-Refresh — App-spezifisch.
//   - CSS-Imports (Quasar-CSS, Material-Icons, App-Theme) — bleiben in der
//     App-eigenen `main.ts`, weil tsup keine CSS bundelt.
//
// Spec: yada-services/handoff/superadmin/SPEC.md §4.4 (createSuperAdminApp).

import { createApp, type App, type Component, type InjectionKey } from 'vue';
import { Quasar, Notify, Dialog, Loading, type QuasarPluginOptions } from 'quasar';
import { createPinia, type Pinia } from 'pinia';
import {
    createRouter,
    createWebHistory,
    type NavigationGuardWithThis,
    type RouteLocationNormalized,
    type RouteRecordRaw,
    type Router,
    type RouterHistory,
} from 'vue-router';

import type { ActionKey, AdminManifest, ComponentKey } from '@saasicat/types';
import type { ActionHandler } from './action-registry.js';
import { defaultHttpClient, type HttpClient } from './types.js';

/**
 * App-spezifische Branding-Daten, die das Plattform-`AdminLayout` und andere
 * Konsumenten via `useSuperAdminBrand()` lesen.
 */
export interface SuperAdminBrand {
    /** 2-Buchstaben-Kürzel im Logo-Badge (`'ah'`, `'vf'`, …). */
    logoText: string;
    /** Voller Anzeigename (`'AutohausPro'`, `'vereinsfux'`, …). */
    name: string;
    /** Optional: Tag rechts vom Namen, Default `'SuperAdmin'`. */
    tag?: string;
}

/**
 * Endpoint-Konfiguration. `apiBase` ist der gemeinsame Prefix unter dem
 * `/manifest`, `/boot` und Extras-Routen liegen.
 */
export interface SuperAdminEndpoints {
    /** Gemeinsamer Prefix, z. B. `'/api/admin'` oder `'/api/v1/admin'`. */
    apiBase: string;
    /** Pre-login Branding-Endpoint, Default `${apiBase}/boot`. */
    publicBootEndpoint?: string;
    /** Post-login Voll-Manifest-Endpoint, Default `${apiBase}/manifest`. */
    manifestEndpoint?: string;
}

export type ExtensionLoader = () => Promise<Component | { default: Component }>;
export type ExtensionsMap = Record<ComponentKey, ExtensionLoader>;
export type ActionsMap = Record<ActionKey, ActionHandler>;

export interface SuperAdminAuthGuardOptions {
    /** App liefert: ist der User aktuell eingeloggt? */
    isAuthenticated: () => boolean;
    /** App liefert: hat der User die SuperAdmin-Rolle? Default: nur `isAuthenticated` prüfen. */
    isSuperAdmin?: () => boolean;
    /** App liefert: Redirect-Pfad für nicht-authentifizierte Aufrufe (z. B. `'/login'`). */
    onUnauthenticated: () => string;
}

/**
 * Ergebnis eines Login-Versuchs. Apps reichen das von ihrem Auth-Store an die
 * Plattform-LoginPage zurück; die Page rendert eine passende Fehlermeldung.
 *
 * `ok: true` → Login war erfolgreich, Page redirected auf `redirectAfterLogin`.
 * `ok: false` → Page zeigt `message` oder eine vom `code` abgeleitete Übersetzung.
 *
 * Bekannte Codes:
 *   - `BAD_CREDENTIALS` — falsche E-Mail/Passwort-Kombi.
 *   - `NOT_SUPER_ADMIN` — Account hat keine SuperAdmin-Rolle.
 *   - sonst             — App-spezifisch; `message` wird direkt angezeigt.
 */
export type SuperAdminLoginResult =
    | { ok: true }
    | { ok: false; code?: 'BAD_CREDENTIALS' | 'NOT_SUPER_ADMIN' | string; message?: string };

/**
 * Login-Adapter. App reicht ihren Auth-Store-Aufruf hier durch. Die Plattform-
 * LoginPage konsumiert das via `useSuperAdminLoginAdapter()`, ohne Knowledge
 * über App-spezifische Stores (Pinia, Auth-API-Routen, MFA-Hooks).
 */
export interface SuperAdminLoginAdapter {
    /**
     * Führt den Login durch. App-Store kapselt API-Call, Token-Storage,
     * MFA-Hops etc.
     */
    login(email: string, password: string): Promise<SuperAdminLoginResult>;
    /**
     * Ziel-Route nach erfolgreichem Login. Default: `/admin/dashboard`
     * (Plattform-Konvention für die Standard-Pages — Apps mit abweichendem
     * Default-Mount überschreiben hier).
     */
    redirectAfterLogin?: string;
    /**
     * Optional: Dev-Hint (Test-Account), wird unter dem Formular eingeblendet.
     * Bewusst nur in `environment !== 'production'` gerendert.
     */
    devHint?: { email: string; password: string };
}

export interface SuperAdminManifestGuardOptions {
    /**
     * App liefert: lädt das Manifest in den App-Store. Der Router-Guard
     * `await`et den Promise bevor die Route resolved wird.
     *
     * **Bei Loader-Fehler:** der Promise REJECTET. Der Router-Guard fängt
     * die Rejection und entscheidet abhängig von `errorRoute`:
     *   - `errorRoute` gesetzt → Redirect auf diese Route (fail-closed).
     *   - `errorRoute` nicht gesetzt → `console.error` + Render erlaubt
     *     (defensives Default-Verhalten; App muss die Manifest-Lücke
     *     selbst rendern).
     */
    ensureLoaded: () => Promise<void>;
    /**
     * Optional: Read-Accessor auf den geladenen Manifest. Wenn gesetzt, wird
     * er per `provide(SUPER_ADMIN_MANIFEST_KEY)` bereitgestellt — der
     * `<ProjectPageHost>` löst Manifest-`projectPages` darüber gegen die
     * `extensions:`-Map auf.
     */
    getManifest?: () => AdminManifest | null;
    /**
     * Optional: Pfad, auf den der Router-Guard bei Manifest-Load-Fehler
     * redirected (fail-closed-Mode). Die App muss die Route in `appRoutes`
     * registrieren und sie als `meta.public = true` markieren, sonst
     * läuft sie wieder durch den Manifest-Guard und produziert eine
     * Redirect-Schleife.
     */
    errorRoute?: string;
}

export interface CreateSuperAdminAppOptions {
    /** App-Root-Komponente (`App.vue`). */
    rootComponent: Component;
    /** App-Branding (Logo, Name). */
    brand: SuperAdminBrand;
    /** Endpoint-Konfiguration. */
    endpoints: SuperAdminEndpoints;
    /** App-eigene Routes (Login, Standard-Pages, Bundle-Pages, …). */
    appRoutes: RouteRecordRaw[];
    /**
     * Statische `extensions:`-Map. Manifest-`projectPages[].componentKey` wird
     * hierin nachgeschlagen (siehe Spec §4.4).
     */
    extensions?: ExtensionsMap;
    /**
     * Statische `actions:`-Map. Manifest-`tenants.actions[].actionKey` wird
     * hierin nachgeschlagen.
     */
    actions?: ActionsMap;
    /**
     * Optional: Auth-Guard. Wenn gesetzt, wird `router.beforeEach` automatisch
     * verdrahtet — `to.meta.public === true` umgeht den Guard.
     */
    authGuard?: SuperAdminAuthGuardOptions;
    /**
     * Optional: Manifest-Guard. Läuft nach erfolgreichem Auth-Guard, blockt
     * den Render bis das Manifest geladen ist (Verhindert Sidebar-Flicker).
     */
    manifestGuard?: SuperAdminManifestGuardOptions;
    /**
     * Optional: Login-Adapter. Wenn gesetzt, wird er via `provide()` für die
     * geteilte `<SuperAdminLoginPage>` (aus `pages-standard/`) bereitgestellt
     * — App muss keinen eigenen LoginPage-Vue-Component mehr halten.
     */
    loginAdapter?: SuperAdminLoginAdapter;
    /**
     * Optional: Router-History-Variante, Default `createWebHistory()`.
     * Apps mit subpath-Mount überschreiben das.
     */
    routerHistory?: RouterHistory;
    /**
     * Optional: Quasar-Konfiguration. Default lädt `Notify`/`Dialog`/`Loading`
     * mit der bekannten AutohausPro-/vereinsfux-Konvention (`top-right`, 3 s).
     */
    quasarOptions?: Partial<QuasarPluginOptions>;
    /**
     * Optional: zusätzliche Vue-Plugins (z. B. AutohausPro NotificationCenter), die
     * nach dem Plattform-Setup, vor dem Mount installiert werden.
     */
    installPlugins?: Array<(app: App) => void>;
    /**
     * Optional: `HttpClient` für alle Pre-Login-Calls (Boot, First-Run-Setup).
     * Default `defaultHttpClient()` (= `fetch`). Konsumenten reichen eine eigene
     * Variante durch (Auth-Header, baseURL, Retry) — gilt dann einheitlich, auch
     * für den Setup-Wizard. Wird via `useSuperAdminHttp()` konsumiert.
     */
    http?: HttpClient;
}

export interface SuperAdminAppHandle {
    app: App;
    router: Router;
    pinia: Pinia;
    /** Mountet die App auf einen Selektor. Liefert die Root-Component-Instance. */
    mount: (selector: string | Element) => ReturnType<App['mount']>;
}

// Vue-Inject-Keys sind über `Symbol.for(...)` global registriert. Grund:
// Apps importieren `createSuperAdminApp` (und damit `app.provide(KEY, ...)`)
// aus dem gebauten `dist/index.js`-Bundle, geteilte `.vue`-Pages im
// `pages-standard/`-Verzeichnis aber direkt aus `src/`. Beide Pfade
// produzieren zwei unabhängige Module-Instanzen — mit lokalen `Symbol(...)`
// wäre die Identity verschieden, und `inject()` würde immer „not found"
// werfen. `Symbol.for(...)` löst beide Imports auf dasselbe Symbol auf.

/** Vue-Inject-Key für `useSuperAdminBrand()`. */
export const SUPER_ADMIN_BRAND_KEY: InjectionKey<SuperAdminBrand> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_BRAND',
);
/** Vue-Inject-Key für `useSuperAdminEndpoints()`. */
export const SUPER_ADMIN_ENDPOINTS_KEY: InjectionKey<Required<SuperAdminEndpoints>> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_ENDPOINTS',
);
/** Vue-Inject-Key für `useSuperAdminExtensions()`. */
export const SUPER_ADMIN_EXTENSIONS_KEY: InjectionKey<ExtensionsMap> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_EXTENSIONS',
);
/** Vue-Inject-Key für `useSuperAdminActions()`. */
export const SUPER_ADMIN_ACTIONS_KEY: InjectionKey<ActionsMap> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_ACTIONS',
);
/**
 * Vue-Inject-Key für den Manifest-Accessor. Wird nur dann provided, wenn
 * `manifestGuard.getManifest` an `createSuperAdminApp()` übergeben wurde —
 * der `<ProjectPageHost>` braucht ihn zur Auflösung von Project-Pages.
 */
export const SUPER_ADMIN_MANIFEST_KEY: InjectionKey<() => AdminManifest | null> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_MANIFEST',
);
/** Vue-Inject-Key für `useSuperAdminLoginAdapter()`. */
export const SUPER_ADMIN_LOGIN_ADAPTER_KEY: InjectionKey<SuperAdminLoginAdapter> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_LOGIN_ADAPTER',
);
/** Vue-Inject-Key für `useSuperAdminHttp()` (Pre-Login-HttpClient). */
export const SUPER_ADMIN_HTTP_KEY: InjectionKey<HttpClient> = Symbol.for(
    '@saasicat/ui-vue/SUPER_ADMIN_HTTP',
);

const DEFAULT_QUASAR_OPTIONS: QuasarPluginOptions = {
    plugins: { Notify, Dialog, Loading },
    config: { notify: { position: 'top-right', timeout: 3000 } },
};

/**
 * Universelle Bootstrap-Funktion für SuperAdmin-Apps. Ersetzt die heute pro
 * App duplizierte `main.ts`-Boilerplate (Quasar + Pinia + Router + Manifest-
 * Guard) und stellt die Plattform-Maps via `provide()` für nachgelagerte
 * Komponenten bereit.
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

/**
 * Internes Helper, exportiert für isolierte Unit-Tests des Navigation-
 * Verhaltens (Auth-Redirect, Manifest-Fail-Closed-Pfad). Konsumenten sollen
 * `createSuperAdminApp()` aufrufen, nicht diesen Helper direkt.
 */
export function buildNavigationGuard(
    options: Pick<CreateSuperAdminAppOptions, 'authGuard' | 'manifestGuard'>,
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
                // Kein errorRoute konfiguriert — defensiver Fallback: warnen,
                // Render zulassen. Die App kann den Fehler über den Store
                // (`error.value`) erkennen und ein Banner/Stub rendern.

                console.error('[SuperAdmin] manifest load failed', err);
            }
        }

        return true;
    };
}
