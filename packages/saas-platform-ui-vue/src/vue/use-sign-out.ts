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

import { SUPER_ADMIN_LOGIN_ADAPTER_KEY } from './super-admin-context.js';

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

    return async function signOut(): Promise<void> {
        if (adapter?.logout) {
            await adapter.logout();
        } else {
            // Loud rather than silent: the button looks like it worked either
            // way, so the only place this can surface is the console.
            console.warn(
                '[SaaSiCat] Sign-out only navigated to the login page — the session was left ' +
                    'intact, so the next navigation to /admin will pass the guard again. Add ' +
                    '`logout()` to the `loginAdapter` you pass to createSuperAdminApp().',
            );
        }

        await router.replace(options.loginPath ?? DEFAULT_LOGIN_PATH);
    };
}
