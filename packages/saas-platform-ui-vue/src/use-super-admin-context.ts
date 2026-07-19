// Composables für die per `createSuperAdminApp()` provided() Plattform-Maps.
// Komponenten innerhalb der Shell rufen diese statt direkter inject()-Aufrufe
// auf, damit Type-Sicherheit und Default-Verhalten zentral bleiben.

import { inject } from 'vue';
import type { AdminManifest } from '@saasicat/types';
import {
    SUPER_ADMIN_ACTIONS_KEY,
    SUPER_ADMIN_BRAND_KEY,
    SUPER_ADMIN_ENDPOINTS_KEY,
    SUPER_ADMIN_EXTENSIONS_KEY,
    SUPER_ADMIN_HTTP_KEY,
    SUPER_ADMIN_LOGIN_ADAPTER_KEY,
    SUPER_ADMIN_MANIFEST_KEY,
    type ActionsMap,
    type ExtensionsMap,
    type SuperAdminBrand,
    type SuperAdminEndpoints,
    type SuperAdminLoginAdapter,
} from './create-super-admin-app.js';
import { defaultHttpClient, type HttpClient } from './types.js';

/** Liefert die in `createSuperAdminApp()` registrierte `extensions:`-Map. */
export function useSuperAdminExtensions(): ExtensionsMap {
    return inject(SUPER_ADMIN_EXTENSIONS_KEY, {} as ExtensionsMap);
}

/** Liefert die in `createSuperAdminApp()` registrierte `actions:`-Map. */
export function useSuperAdminActions(): ActionsMap {
    return inject(SUPER_ADMIN_ACTIONS_KEY, {} as ActionsMap);
}

/**
 * Liefert das App-Branding. Wirft, wenn die Komponente außerhalb einer
 * `createSuperAdminApp()`-Shell gerendert wird — das ist ein Setup-Bug, kein
 * Lauf-Problem.
 */
export function useSuperAdminBrand(): SuperAdminBrand {
    const brand = inject(SUPER_ADMIN_BRAND_KEY);
    if (!brand) {
        throw new Error(
            'useSuperAdminBrand(): kein SuperAdmin-Branding im Inject-Scope. Wurde die Komponente innerhalb createSuperAdminApp() gemounted?',
        );
    }
    return brand;
}

/** Liefert die App-Endpoints (apiBase, publicBootEndpoint, manifestEndpoint). */
export function useSuperAdminEndpoints(): Required<SuperAdminEndpoints> {
    const endpoints = inject(SUPER_ADMIN_ENDPOINTS_KEY);
    if (!endpoints) {
        throw new Error(
            'useSuperAdminEndpoints(): keine Endpoints im Inject-Scope. Wurde die Komponente innerhalb createSuperAdminApp() gemounted?',
        );
    }
    return endpoints;
}

/**
 * Liefert den Manifest-Accessor, der via
 * `createSuperAdminApp({ manifestGuard: { getManifest } })` provided wurde.
 * Liefert `null`, wenn die App keinen Accessor übergeben hat — Komponenten
 * (z. B. `<ProjectPageHost>`) müssen den Null-Fall sauber behandeln, weil
 * der Accessor optional ist.
 */
export function useSuperAdminManifest(): AdminManifest | null {
    const accessor = inject(SUPER_ADMIN_MANIFEST_KEY, null);
    return accessor ? accessor() : null;
}

/**
 * Liefert den Login-Adapter, den die App via
 * `createSuperAdminApp({ loginAdapter })` registriert hat. Wirft, wenn keiner
 * gesetzt wurde — die geteilte `<SuperAdminLoginPage>` braucht ihn.
 */
export function useSuperAdminLoginAdapter(): SuperAdminLoginAdapter {
    const adapter = inject(SUPER_ADMIN_LOGIN_ADAPTER_KEY);
    if (!adapter) {
        throw new Error(
            'useSuperAdminLoginAdapter(): kein Login-Adapter registriert. Reiche ihn via createSuperAdminApp({ loginAdapter }) ein.',
        );
    }
    return adapter;
}

/**
 * Liefert den Pre-Login-`HttpClient` (Boot, First-Run-Setup), den die App via
 * `createSuperAdminApp({ http })` registriert hat. Fällt auf `defaultHttpClient()`
 * zurück, falls keiner provided wurde (z. B. in isolierten Tests).
 */
export function useSuperAdminHttp(): HttpClient {
    return inject(SUPER_ADMIN_HTTP_KEY, defaultHttpClient());
}
