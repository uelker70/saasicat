// Composables for the platform maps provided() via `createSuperAdminApp()`.
// Components inside the shell call these instead of direct inject() calls,
// so that type safety and default behavior stay centralized.

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
} from './super-admin-context.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

/** Returns the `extensions:` map registered in `createSuperAdminApp()`. */
export function useSuperAdminExtensions(): ExtensionsMap {
    return inject(SUPER_ADMIN_EXTENSIONS_KEY, {} as ExtensionsMap);
}

/** Returns the `actions:` map registered in `createSuperAdminApp()`. */
export function useSuperAdminActions(): ActionsMap {
    return inject(SUPER_ADMIN_ACTIONS_KEY, {} as ActionsMap);
}

/**
 * Returns the app branding. Throws when the component is rendered outside a
 * `createSuperAdminApp()` shell — that is a setup bug, not a runtime
 * problem.
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

/** Returns the app endpoints (apiBase, publicBootEndpoint, manifestEndpoint). */
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
 * Returns the manifest accessor that was provided via
 * `createSuperAdminApp({ manifestGuard: { getManifest } })`.
 * Returns `null` if the app did not pass an accessor — components
 * (e.g. `<ProjectPageHost>`) must handle the null case cleanly, because
 * the accessor is optional.
 */
export function useSuperAdminManifest(): AdminManifest | null {
    const accessor = inject(SUPER_ADMIN_MANIFEST_KEY, null);
    return accessor ? accessor() : null;
}

/**
 * Returns the login adapter the app registered via
 * `createSuperAdminApp({ loginAdapter })`. Throws when none was
 * set — the shared `<SuperAdminLoginPage>` needs it.
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
 * Returns the pre-login `HttpClient` (boot, first-run setup) the app registered
 * via `createSuperAdminApp({ http })`. Falls back to `defaultHttpClient()`
 * if none was provided (e.g. in isolated tests).
 */
export function useSuperAdminHttp(): HttpClient {
    return inject(SUPER_ADMIN_HTTP_KEY, defaultHttpClient());
}
