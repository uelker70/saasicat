// Signing out has to end the session, not just navigate.
//
// Both platform sign-out affordances are reached through components that every
// consumer mounts as bare route records: `AdminLayout` at `/admin` and
// `AdminManifestErrorPage` at `/admin-error`. A route record attaches no props
// and no listeners, so the layout's `emit('logout')` went nowhere at all and
// the error page's fallback only called `router.replace('/login')`.
//
// Both looked like they worked. `isAuthenticated()` reads a token out of
// storage in every consumer we have, so the session survived and the next
// navigation to `/admin` walked straight back in — the operator saw a login
// form and was still signed in.

import { describe, expect, test, vi, afterEach } from 'vitest';
import { createRouter, createMemoryHistory } from 'vue-router';

import AdminLayout from '../../src/layouts/AdminLayout.vue';
import AdminManifestErrorPage from '../../src/pages/AdminManifestErrorPage.vue';
import {
    SUPER_ADMIN_LOGIN_ADAPTER_KEY,
    SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY,
} from '../../src/vue/super-admin-context.js';
import { mountWithQuasar } from './support/mount-with-quasar.js';

function makeRouter() {
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', component: { template: '<div />' } },
            { path: '/login', component: { template: '<div />' } },
            { path: '/admin', component: { template: '<div />' } },
            { path: '/admin-error', component: { template: '<div />' } },
        ],
    });
}

/** What `createSuperAdminApp({ loginAdapter })` provides app-wide. */
function contextWith(logout?: () => void | Promise<void>) {
    return {
        [SUPER_ADMIN_LOGIN_ADAPTER_KEY as symbol]: {
            login: async () => undefined,
            ...(logout ? { logout } : {}),
        },
    };
}

/** Clicks sign-out — the last button in both components. */
async function clickSignOut(wrapper: {
    findAll: (s: string) => { trigger: (e: string) => Promise<void> }[];
}) {
    const buttons = wrapper.findAll('button');
    await buttons[buttons.length - 1].trigger('click');
}

describe('AdminManifestErrorPage sign-out', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('calls the login adapter’s logout before leaving for /login', async () => {
        const logout = vi.fn();
        const router = makeRouter();
        const wrapper = mountWithQuasar(AdminManifestErrorPage, {
            global: { provide: contextWith(logout), plugins: [router] },
        });

        await clickSignOut(wrapper);
        await router.isReady();

        expect(
            logout,
            'the session must be ended, not merely navigated away from',
        ).toHaveBeenCalledTimes(1);
        wrapper.unmount();
    });

    test('says so loudly when the app supplied no way to end the session', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const router = makeRouter();
        const wrapper = mountWithQuasar(AdminManifestErrorPage, {
            global: { provide: contextWith(), plugins: [router] },
        });

        await clickSignOut(wrapper);

        // Silence here is the dangerous outcome: the button appears to work
        // either way, so the console is the only place this can surface.
        expect(warn.mock.calls.some((args) => String(args[0]).includes('session was left'))).toBe(
            true,
        );
        wrapper.unmount();
    });

    test('an explicit onLogout prop still wins over the default', async () => {
        const onLogout = vi.fn();
        const adapterLogout = vi.fn();
        const router = makeRouter();
        const wrapper = mountWithQuasar(AdminManifestErrorPage, {
            props: { onLogout },
            global: { provide: contextWith(adapterLogout), plugins: [router] },
        });

        await clickSignOut(wrapper);

        expect(onLogout).toHaveBeenCalledTimes(1);
        expect(
            adapterLogout,
            'the app took over — the default must stay out',
        ).not.toHaveBeenCalled();
        wrapper.unmount();
    });
});

describe('AdminLayout sign-out', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('ends the session when no @logout listener is attached', async () => {
        const logout = vi.fn();
        const router = makeRouter();
        const wrapper = mountWithQuasar(AdminLayout, {
            global: { provide: contextWith(logout), plugins: [router] },
        });

        await clickSignOut(wrapper);

        expect(logout, 'mounted as a route record, the emit reaches nobody').toHaveBeenCalledTimes(
            1,
        );
        wrapper.unmount();
    });

    test('defers to the app when one is', async () => {
        const onLogout = vi.fn();
        const adapterLogout = vi.fn();
        const router = makeRouter();
        const wrapper = mountWithQuasar(AdminLayout, {
            props: { onLogout },
            global: { provide: contextWith(adapterLogout), plugins: [router] },
        });

        await clickSignOut(wrapper);

        expect(onLogout).toHaveBeenCalledTimes(1);
        expect(adapterLogout).not.toHaveBeenCalled();
        wrapper.unmount();
    });

    test('also defers when the listener was attached with @logout.once', async () => {
        // Vue stores that one as `onLogoutOnce`. Checking only `onLogout` runs
        // the platform default and never emits — the consumer's handler, which
        // they did attach, is simply ignored.
        const onLogoutOnce = vi.fn();
        const adapterLogout = vi.fn();
        const wrapper = mountWithQuasar(AdminLayout, {
            props: { onLogoutOnce },
            global: { provide: contextWith(adapterLogout), plugins: [makeRouter()] },
        });

        await clickSignOut(wrapper);

        expect(onLogoutOnce).toHaveBeenCalledTimes(1);
        expect(adapterLogout).not.toHaveBeenCalled();
        wrapper.unmount();
    });
});

describe('sign-out and the cached manifest', () => {
    /**
     * The manifest store stays `loaded` across a sign-out, so its next
     * `ensureLoaded()` returns instantly. Without discarding it, the operator
     * who logs in next in the same tab gets the previous session's manifest —
     * their navigation, their capabilities, their project — until something
     * forces a full page reload, which signing out does not.
     */
    test('discards the manifest, and does so even when logout rejects', async () => {
        const clearCache = vi.fn();
        const failingLogout = vi.fn(() => Promise.reject(new Error('revocation failed')));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const wrapper = mountWithQuasar(AdminManifestErrorPage, {
            global: {
                provide: {
                    ...contextWith(failingLogout),
                    [SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY as symbol]: clearCache,
                },
                plugins: [makeRouter()],
            },
        });

        await clickSignOut(wrapper);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(failingLogout).toHaveBeenCalledTimes(1);
        expect(
            clearCache,
            'a failed revocation must not leave the next operator with this manifest',
        ).toHaveBeenCalledTimes(1);

        wrapper.unmount();
    });
});

describe('handlers hand their promise back to Vue', () => {
    /**
     * A handler that drops its promise turns a consumer's failure into an
     * unhandled rejection instead of routing it to the app's error handler.
     * This page renders when things are already going wrong, so an `onRetry`
     * that keeps failing would vanish exactly where it matters most.
     *
     * Behavioural, not source-scanning. The first version of this test looked
     * for a literal `void` and passed while `logout` still dropped its promise
     * via `props.onLogout(); return;` — it was checking a spelling, not an
     * outcome.
     */
    test.each([
        ['retry', 0, 'onRetry'],
        ['sign-out', 1, 'onLogout'],
    ])('a rejecting %s prop reaches Vue’s error handler', async (_label, buttonIndex, propName) => {
        const boom = new Error('the retry failed too');
        const errorHandler = vi.fn();

        const wrapper = mountWithQuasar(AdminManifestErrorPage, {
            props: { [propName]: () => Promise.reject(boom) },
            global: { provide: contextWith(), plugins: [makeRouter()] },
        });
        wrapper.vm.$.appContext.config.errorHandler = errorHandler;

        await wrapper.findAll('button')[buttonIndex].trigger('click');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(errorHandler.mock.calls.map((args) => args[0])).toContain(boom);
        wrapper.unmount();
    });
});
