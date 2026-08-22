// Signing out, in one place.
//
// Both platform affordances that offer it — the layout header button and the
// fail-closed error page — are mounted as bare route components in every
// consumer we know of, which means neither an `onLogout` prop nor a `@logout`
// listener reaches them. Their fallback therefore has to be the real thing.
//
// Navigating to `/login` on its own is not it. An app's `isAuthenticated()`
// typically reads a token out of storage, so a session left behind means the
// next navigation to `/admin` passes the guard again: the operator clicked
// "sign out", saw the login form, and is still signed in.
//
// The adapter that knows how to start a session is the only thing that knows
// how to end it, hence `loginAdapter.logout`.

import { inject } from 'vue';
import { useRouter } from 'vue-router';

import {
    SUPER_ADMIN_LOGIN_ADAPTER_KEY,
    SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY,
} from './super-admin-context.js';

/** Where `createAdminRoutes()` registers the login page. */
export const DEFAULT_LOGIN_PATH = '/login';

export interface UseSignOutOptions {
    /** Route to land on afterwards. Default `/login`. */
    loginPath?: string;
}

/**
 * Returns the platform's default sign-out: end the session, then go to login.
 *
 * Must be called during component setup — it injects the login adapter and
 * uses the router.
 */
export function useSignOut(options: UseSignOutOptions = {}): () => Promise<void> {
    const router = useRouter();
    const adapter = inject(SUPER_ADMIN_LOGIN_ADAPTER_KEY, undefined);
    const clearManifestCache = inject(SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY, undefined);

    return async function signOut(): Promise<void> {
        if (adapter?.logout) {
            try {
                await adapter.logout();
            } catch (err) {
                // Navigate anyway. A rejected `logout()` — a server-side
                // revocation that failed, say — must not strand the operator on
                // the protected page they just asked to leave, and both callers
                // discard this promise, so an escaping rejection would be
                // invisible. Leaving is also the safer half: the adapter may
                // well have cleared the local token before the request failed.
                console.error(
                    '[SaaSiCat] Sign-out failed while ending the session — navigating to the login page anyway. ' +
                        'The session may still be valid on the server.',
                    err,
                );
            }
        } else {
            // Loud rather than silent: the button looks like it worked either
            // way, so the only place this can surface is the console.
            console.warn(
                '[SaaSiCat] Sign-out only navigated to the login page — the session was left ' +
                    'intact, so the next navigation to /admin will pass the guard again. Add ' +
                    '`logout()` to the `loginAdapter` you pass to createSuperAdminApp().',
            );
        }

        // Unconditionally, and after the adapter either way: the manifest store
        // stays `loaded` across a sign-out, so without this the next
        // `ensureLoaded()` returns instantly and hands the *next* operator the
        // previous session's manifest — their navigation, their capabilities,
        // their project. Only a full page reload would have cleared it, and
        // signing out does not force one.
        if (clearManifestCache) {
            try {
                await clearManifestCache();
            } catch (err) {
                console.error(
                    '[SaaSiCat] Sign-out could not discard the cached manifest. The next login in ' +
                        'this tab may see the previous session’s navigation until the page reloads.',
                    err,
                );
            }
        }

        await router.replace(options.loginPath ?? DEFAULT_LOGIN_PATH);
    };
}
