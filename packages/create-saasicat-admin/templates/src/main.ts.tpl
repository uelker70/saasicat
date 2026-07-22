// Bootstrap. createSuperAdminApp erledigt Quasar+Pinia+Router+Guards.

import 'quasar/src/css/index.sass';
import '@quasar/extras/material-icons/material-icons.css';

import { createSuperAdminApp } from '@saasicat/ui-vue/quasar';
import App from './App.vue';
import { appRoutes } from './router/routes';
import { adminLogin, isAuthenticated } from './services/http';
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
    actions: {},
    extensions: {},
});

handle.mount('#app');
