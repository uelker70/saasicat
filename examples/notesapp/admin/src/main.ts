// Bootstrap. createSuperAdminApp wires up Quasar + Pinia + Router + guards.

import 'quasar/src/css/index.sass';
import '@quasar/extras/material-icons/material-icons.css';
// Platform page styles (sa-* classes + CSS variables). Without it the
// standard pages render unstyled.
import '@saasicat/ui-vue/theme.css';

import { createSuperAdminApp } from '@saasicat/ui-vue/quasar';
import type { ActionsMap } from '@saasicat/ui-vue';
import App from './App.vue';
import { appRoutes } from './router/routes';
import {
    platformHttp,
    DEMO_CREDENTIALS,
    adminLogin,
    adminLogout,
    isAuthenticated,
} from './services/http';
import { reactivateTenant, suspendTenant } from './services/app-loaders';
import { ADMIN_ENDPOINTS } from './services/platform-loaders';
import { useManifestStore } from './stores/manifest';

// Tenant-action handlers. The map key matches `manifest.tenants.actions[].actionKey`
// (the platform-core spine declares tenants.suspend/reactivate). The Confirm→MFA
// flow inside the page collects `reason`/`mfaCode` and hands them here; this
// demo has no real MFA, so the code is accepted and ignored server-side.
interface TenantActionInput {
    row: { slug: string };
    mfaCode: string | null;
    reason: string | null;
}
const ADMIN_ACTIONS: ActionsMap = {
    'tenants.suspend': (input) => {
        const { row, reason } = input as TenantActionInput;
        return suspendTenant(row.slug, reason ?? '');
    },
    'tenants.reactivate': (input) => {
        const { row } = input as TenantActionInput;
        return reactivateTenant(row.slug);
    },
};

const handle = createSuperAdminApp({
    rootComponent: App,
    brand: { logoText: 'NA', name: 'NotesApp' },
    endpoints: ADMIN_ENDPOINTS,
    appRoutes,
    // `logout` is not optional in practice: the platform's sign-out only
    // navigates without it, and `isAuthenticated` below would wave the
    // operator straight back in.
    loginAdapter: { login: adminLogin, logout: adminLogout, devHint: DEMO_CREDENTIALS },
    authGuard: {
        isAuthenticated,
        onUnauthenticated: () => '/login',
    },
    manifestGuard: {
        // Lazy store access: the Pinia instance exists once
        // createSuperAdminApp() has run; the guard only fires afterwards.
        ensureLoaded: () => useManifestStore().ensureLoaded(),
        getManifest: () => useManifestStore().manifest,
        errorRoute: '/admin-error',
        // Without this the error page's retry cannot recover from a stale
        // ETag: the loader would revalidate against the same cached entry
        // and land straight back on the error page.
        clearCache: () => useManifestStore().clearCache(),
    },
    // Platform pages issue their own requests (KPI cards, tenant tables) —
    // without this they would fall back to a bare fetch() and lose the app's auth.
    http: platformHttp,
    actions: ADMIN_ACTIONS,
    // ── Overriding ONE operation, keeping the other eight ────────────────────
    //
    // This is the property a prop-based page cannot offer: its twenty-four
    // props are all or nothing. Here the app wraps `bundleVersions.publish` to
    // record who published what, and every other operation — list, create,
    // update, softDelete, the four other version calls — still comes from the
    // platform, unchanged and unmentioned.
    //
    // `next` IS the platform's implementation, so the wrapper decides what to
    // do around it rather than replacing it. Returning `next(...)` without
    // awaiting would lose the failure this log line exists to record.
    resourceOverrides: {
        bundleVersions: {
            ops: {
                publish: async (next, versionId, options) => {
                    const result = await next(versionId, options);
                    console.info('[notesapp] bundle version published:', versionId);
                    return result;
                },
            },
        },
    },
    extensions: {},
    // Starting UI language — the shell's header switcher lets the user change
    // it from there and remembers the pick. `overrides` replaces individual
    // strings (docs/guides/build-the-admin-frontend.md, "UI Language").
    i18n: { locale: 'de' },
});

handle.mount('#app');
