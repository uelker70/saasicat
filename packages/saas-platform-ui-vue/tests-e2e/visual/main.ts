import 'quasar/src/css/index.sass';
import '../../src/ui/theme/index.css';

import {
    createApp,
    defineComponent,
    h,
    nextTick,
    ref,
    shallowRef,
    watch,
    type Component,
} from 'vue';
import { Quasar, Notify, Dialog, Loading, type QuasarPluginOptions } from 'quasar';
import { createPinia } from 'pinia';
import { SA_PORTAL_CLASS } from '../../src/quasar/create-super-admin-app.js';
import { createRouter, createWebHistory } from 'vue-router';

import {
    SUPER_ADMIN_ACTIONS_KEY,
    SUPER_ADMIN_BRAND_KEY,
    SUPER_ADMIN_ENDPOINTS_KEY,
    SUPER_ADMIN_EXTENSIONS_KEY,
    SUPER_ADMIN_HTTP_KEY,
    SUPER_ADMIN_LOGIN_ADAPTER_KEY,
    SUPER_ADMIN_MANIFEST_KEY,
} from '../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_NOTIFY_KEY } from '../../src/vue/ui-notify.js';
import { SUPER_ADMIN_I18N_KEY, createSuperAdminI18n } from '../../src/vue/use-super-admin-i18n.js';
import { SA_THEME_KEY, createSaTheme, type SaColorScheme } from '../../src/vue/use-sa-theme.js';
import { bindSaThemeToDocument } from '../../src/quasar/dark-bridge.js';
import { FIXTURE_MANIFEST, respondTo, unmatchedRequests } from './fixture-data.js';
import { VISUAL_CASES } from './pages.js';

// Fixture bootstrap for the visual baselines.
//
// Everything that could vary between two runs is pinned here: no network, no
// clock, no locale negotiation, no persisted storage. A baseline that moves for
// any of those reasons is not a baseline, it is noise that trains people to
// re-record without looking.

// 1. No clock. Several pages format "created at" and compute validity windows.
const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z').valueOf();

Date.now = () => FIXED_NOW;
const RealDate = Date;
class FixedDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
        // @ts-expect-error — variadic passthrough is the point
        super(...(args.length === 0 ? [FIXED_NOW] : args));
    }
    static now() {
        return FIXED_NOW;
    }
}
globalThis.Date = FixedDate as DateConstructor;

// 2. No storage. The paginator and the manifest loader both persist choices,
//    and a leftover value from a previous run would change the render.
localStorage.clear();
sessionStorage.clear();

// 3. No network. One deterministic responder for every request the pages make.
const http = async (url: string, init?: { method?: string }) => {
    const body = respondTo(url, init?.method ?? 'GET');
    return {
        status: body === null ? 404 : 200,
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
};

const ADMIN_BASE = '/api/admin';

const caseId = new URL(window.location.href).searchParams.get('page') ?? VISUAL_CASES[0].id;
const visualCase = VISUAL_CASES.find((c) => c.id === caseId);

/**
 * Tells Playwright the page is on screen.
 *
 * Called only once the dynamic import has resolved and the page has rendered.
 * Marking readiness unconditionally after two frames was a lie the harness
 * happened to survive: a cold Vite run can take longer than that, and a marker
 * meaning "the app booted" rather than "the page is on screen" would let a
 * `--update` record the loading placeholder.
 */
function markReady(): void {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.body.setAttribute('data-visual-ready', 'true');
        });
    });
}

const Host = defineComponent({
    setup() {
        const page = shallowRef<Component | null>(null);
        const failure = ref<string | null>(null);

        if (!visualCase) {
            failure.value = `Unknown page id "${caseId}"`;
        } else {
            visualCase
                .load()
                .then((mod) => {
                    page.value = mod.default;
                })
                .catch((err) => {
                    failure.value = String(err?.message ?? err);
                });
        }

        // Either outcome is a finished render; the error page is a legitimate
        // thing for the spec to look at and reject.
        watch([page, failure], () => void nextTick(markReady), { flush: 'post' });

        return () => {
            if (failure.value) {
                return h('div', { id: 'visual-error' }, failure.value);
            }
            if (!page.value) {
                return h('div', { id: 'visual-loading' }, 'loading');
            }
            const props = visualCase?.props?.({ http, adminBase: ADMIN_BASE }) ?? {};
            // Wrapped in the layout class a real app renders, so the page sits
            // on the theme's app canvas rather than on the browser's white
            // default. Without it nothing here reacts to `data-sa-theme`, and
            // the theme check would be asking about the fixture's own body.
            return h('div', { class: 'sa-admin-layout sa-admin-content' }, [
                h('div', { id: 'visual-root' }, [h(page.value, props)]),
            ]);
        };
    },
});

const app = createApp(Host);
app.use(Quasar, {
    plugins: { Notify, Dialog, Loading },
    config: {
        notify: { position: 'top-right', timeout: 3000 },
        // The same marking `createSuperAdminApp` applies. Without it every
        // teleported node in this fixture renders unthemed, and the baselines
        // record Quasar's own dialog — white on a dark page — as the truth.
        globalNodes: { class: SA_PORTAL_CLASS },
    },
    // Same cast, same reason as in `createSuperAdminApp`: `globalNodes` is a
    // documented Quasar option its own types do not declare.
} as QuasarPluginOptions);
app.use(createPinia());
app.use(
    createRouter({
        history: createWebHistory(),
        routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
    }),
);

app.provide(SUPER_ADMIN_BRAND_KEY, { tag: 'SuperAdmin', name: 'Fixture', logoText: 'FX' });
app.provide(SUPER_ADMIN_I18N_KEY, createSuperAdminI18n({ locale: 'en', persist: false }));
app.provide(SUPER_ADMIN_ENDPOINTS_KEY, {
    apiBase: ADMIN_BASE,
    publicBootEndpoint: `${ADMIN_BASE}/boot`,
    manifestEndpoint: `${ADMIN_BASE}/manifest`,
});
app.provide(SUPER_ADMIN_EXTENSIONS_KEY, {});
app.provide(SUPER_ADMIN_ACTIONS_KEY, {});
app.provide(SUPER_ADMIN_NOTIFY_KEY, () => {});
app.provide(SUPER_ADMIN_HTTP_KEY, http);
app.provide(SUPER_ADMIN_MANIFEST_KEY, () => FIXTURE_MANIFEST);
app.provide(SUPER_ADMIN_LOGIN_ADAPTER_KEY, { login: async () => ({ ok: true as const }) });

// The theme, wired exactly as `createSuperAdminApp()` wires it — through the
// shipped bridge rather than through an imitation of it. The first version of
// the theme test set `data-sa-theme` by hand and reported nineteen pages of
// unreadable text, because that attribute alone does not put QUASAR into dark
// mode: its tables and cards keep their white surfaces while the platform's
// text flips to light. Which is precisely the bug the bridge exists to prevent,
// and precisely why the test has to go through it.
const theme = createSaTheme({ persist: false });
bindSaThemeToDocument(theme);
app.provide(SA_THEME_KEY, theme);

app.mount('#app');
// Endpoints the fixture was asked for and does not have. The spec reads this
// and fails the case: an unanswered request renders an empty card that looks
// exactly like a deliberate empty state, and that is how two baselines came to
// record nothing at all.
declare global {
    interface Window {
        __saasicatUnmatchedRequests?: string[];
        /** Flips the shell's colour scheme; resolves once the DOM has caught up. */
        __saasicatSetTheme?: (scheme: SaColorScheme) => Promise<void>;
    }
}
window.__saasicatUnmatchedRequests = unmatchedRequests;
window.__saasicatSetTheme = async (scheme) => {
    theme.scheme.value = scheme;
    await nextTick();
};
