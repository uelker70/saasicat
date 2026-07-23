// Bootstrap. createSuperAdminApp wires up Quasar + Pinia + Router + guards.

import 'quasar/src/css/index.sass';
import '@quasar/extras/material-icons/material-icons.css';
// Platform page styles (sa-* classes + CSS variables). Without it the
// standard pages render unstyled.
import '@saasicat/ui-vue/sa-theme.css';

import { createSuperAdminApp } from '@saasicat/ui-vue/quasar';
import type { ActionsMap } from '@saasicat/ui-vue';
import App from './App.vue';
import { appRoutes } from './router/routes';
import { platformHttp, DEMO_CREDENTIALS, adminLogin, isAuthenticated } from './services/http';
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
    loginAdapter: { login: adminLogin, devHint: DEMO_CREDENTIALS },
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
    },
    // Platform pages issue their own requests (KPI cards, tenant tables) —
    // without this they would fall back to a bare fetch() and lose the app's auth.
    http: platformHttp,
    actions: ADMIN_ACTIONS,
    extensions: {},
    // UI language: 'de' (default) or 'en'. Pass a Ref to switch at runtime,
    // `overrides` to replace individual strings (handbook §8.6).
    i18n: { locale: 'de' },
});

handle.mount('#app');
