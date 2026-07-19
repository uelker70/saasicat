// Bootstrap. createSuperAdminApp erledigt Quasar+Pinia+Router+Guards.

import 'quasar/src/css/index.sass';
import '@quasar/extras/material-icons/material-icons.css';

import { createSuperAdminApp } from '@saasicat/ui-vue';
import App from './App.vue';
import { appRoutes } from './router/routes';
import { adminLogin, isAuthenticated } from './services/http';

const handle = createSuperAdminApp({
    rootComponent: App,
    brand: { logoText: '__LOGO_TEXT__', name: '__BRAND_NAME__' },
    endpoints: { apiBase: '__API_BASE__' },
    appRoutes,
    loginAdapter: { login: adminLogin },
    authGuard: {
        isAuthenticated,
        onUnauthenticated: () => '/login',
    },
    manifestGuard: {
        errorRoute: '/admin-error',
    },
    actions: {},
    extensions: {},
});

handle.mount('#app');
