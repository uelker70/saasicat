// Bootstrap: plain Vue 3 + Quasar + Pinia + vue-router (the tenant frontend,
// NOT the SuperAdmin shell). Quasar CSS + Material Icons are imported here
// because tsup does not bundle CSS.

import 'quasar/src/css/index.sass';
import '@quasar/extras/material-icons/material-icons.css';

import { createApp } from 'vue';
import { Dialog, Loading, Notify, Quasar } from 'quasar';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import { SUPER_ADMIN_I18N_KEY, createSuperAdminI18n, provideEntitlement } from '@saasicat/ui-vue';

import App from './App.vue';
import { routes } from './router/routes';
import { isAuthenticated } from './services/http';
import { entitlement } from './services/entitlement';

const app = createApp(App);

app.use(Quasar, {
    plugins: { Notify, Dialog, Loading },
    config: { notify: { position: 'top-right', timeout: 3000 } },
});

app.use(createPinia());

const router = createRouter({ history: createWebHistory(), routes });
router.beforeEach((to) => {
    const authed = isAuthenticated();
    if (to.meta.public) {
        return authed && to.path === '/login' ? '/notes' : true;
    }
    return authed ? true : { path: '/login' };
});
app.use(router);

// The shared tenant plan pages (TenantPlanSection) read their UI locale from
// this context; without a provider they default to German. Pin it to English.
app.provide(SUPER_ADMIN_I18N_KEY, createSuperAdminI18n({ locale: 'en' }));

// One entitlement snapshot for the whole app so <FeatureGate> and the plan page
// stay in sync.
provideEntitlement(app, entitlement);

// Load once at bootstrap only when a session already exists (hard reload); the
// login flow triggers its own load. On /login there is no tenant → no request.
if (isAuthenticated()) void entitlement.load();

app.mount('#app');
