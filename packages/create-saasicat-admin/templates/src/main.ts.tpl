// Bootstrap. createSuperAdminApp wires up Quasar + Pinia + Router + guards.

import 'quasar/src/css/index.sass';
import '@quasar/extras/material-icons/material-icons.css';
// Platform page styles (sa-* classes + CSS variables). Without it the
// standard pages render unstyled.
import '@saasicat/ui-vue/sa-theme.css';

import { createSuperAdminApp } from '@saasicat/ui-vue/quasar';
import App from './App.vue';
import { appRoutes } from './router/routes';
import { platformHttp, adminLogin, isAuthenticated } from './services/http';
import { ADMIN_ENDPOINTS } from './services/platform-loaders';
import { useManifestStore } from './stores/manifest';

const handle = createSuperAdminApp({
    rootComponent: App,
    brand: { logoText: '__LOGO_TEXT__', name: '__BRAND_NAME__' },
    endpoints: ADMIN_ENDPOINTS,
    appRoutes,
    loginAdapter: { login: adminLogin },
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
    actions: {},
    extensions: {},
    // UI language: 'de' (default) or 'en'. Pass a Ref to switch at runtime,
    // `overrides` to replace individual strings (handbook §8.6).
    i18n: { locale: 'de' },
});

handle.mount('#app');
