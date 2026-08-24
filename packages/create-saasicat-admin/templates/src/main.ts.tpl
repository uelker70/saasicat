// Bootstrap. createSuperAdminApp wires up Quasar + Pinia + Router + guards.

// Every stylesheet the admin needs, all from the one package you installed.
// The components are built (ADR 0011), so their styles arrive as `style.css`
// rather than being compiled by your build — without it the standard pages
// render unstyled.
import '@saasicat/ui-vue/quasar.css';
import '@saasicat/ui-vue/icons.css';
import '@saasicat/ui-vue/theme.css';
import '@saasicat/ui-vue/style.css';

import { createSuperAdminApp } from '@saasicat/ui-vue/quasar';
import App from './App.vue';
import { appRoutes } from './router/routes';
import { platformHttp, adminLogin, isAuthenticated } from './services/http';
import { ADMIN_ENDPOINTS } from './services/platform-loaders';
import { useManifestStore } from './stores/manifest';

const handle = createSuperAdminApp({
    rootComponent: App,
    // `color` is the ONE place your admin's brand colour is decided:
    // `--sa-color-accent` reads Quasar's `--q-primary`, which this writes, so
    // the hero, the buttons, the focus ring, the tinted surfaces, Quasar's own
    // components and the tenant-facing pages all follow. There is no second
    // switch. The default is SaaSiCat's own, so a fresh admin looks like the
    // documentation until you decide otherwise.
    //
    // One caveat if you pick a LIGHT brand: text on accent-filled controls is
    // white, and CSS cannot work out that white on a light amber is 2.15:1.
    // Override `--sa-color-fg-on-accent` in your own CSS if so — in both themes.
    brand: { logoText: '__LOGO_TEXT__', name: '__BRAND_NAME__', color: '#3f6bff' },
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
    // Starting UI language — the shell's header switcher lets the user change
    // it from there and remembers the pick. `overrides` replaces individual
    // strings (docs/guides/build-the-admin-frontend.md, "UI Language").
    i18n: { locale: 'en' },
});

handle.mount('#app');
