<template>
    <div class="sa-page sa-manifest-error">
        <q-card class="sa-manifest-error__card">
            <q-card-section class="sa-manifest-error__head">
                <q-icon name="cloud_off" size="32px" color="negative" />
                <h1 class="sa-manifest-error__title">{{ msg.manifestError.title }}</h1>
            </q-card-section>
            <q-card-section>
                <p class="sa-manifest-error__lead">{{ msg.manifestError.lead }}</p>
                <p v-if="errorMessage" class="sa-manifest-error__detail">
                    <strong>{{ msg.manifestError.detailLabel }}</strong> {{ errorMessage }}
                </p>
                <div class="sa-manifest-error__actions">
                    <q-btn unelevated color="primary" :label="common.reload" @click="retry" />
                    <q-btn flat :label="msg.header.logout" @click="logout" />
                </div>
            </q-card-section>
        </q-card>
    </div>
</template>

<script setup lang="ts">
import { inject } from 'vue';
import { useRouter } from 'vue-router';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';
import { useSignOut } from '../vue/use-sign-out.js';
import { SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY } from '../vue/super-admin-context.js';

// Platform standard error page for `manifestGuard.errorRoute`.
//
// This page is mounted BY THE ROUTER (`createAdminRoutes({ adminErrorPage })`),
// and a route record passes no props. Every prop here must therefore be
// optional with a default that works standalone — a required prop would be
// unsatisfiable by construction, and its two buttons would call `undefined`
// at the exact moment the app is already in trouble.
//
// Apps that want app-specific behaviour (clear the manifest cache, call
// authStore.logout, route somewhere else) mount the page themselves with
// `props:` on the route record and override the callbacks.

const msg = useSaMessages('shell');
const common = useSaMessages('common');
const router = useRouter();

const props = defineProps<{
    errorMessage?: string | null;
    /**
     * Default: fresh boot into `retryPath`, which re-runs the manifest guard.
     *
     * @pageContractException this page renders when the MANIFEST failed to
     * load, so the shell the resource registry lives in did not come up.
     * Telling it to ask the registry would be telling it to use the thing whose
     * absence put it on screen. The default works on its own, and both
     * consumers override it with their own store's `clearCache()`.
     */
    onRetry?: () => Promise<void> | void;
    /**
     * Default: navigate to the login route `createAdminRoutes` registers.
     *
     * @pageContractException same reason as `onRetry` above — there is no
     * registry to reach on this page. Both consumers override it with their own
     * store's `logout()`, which the platform cannot express; removing the prop
     * would not move that logic into the platform, it would delete it.
     */
    onLogout?: () => void | Promise<void>;
    /** Login path for the default `onLogout`. */
    loginPath?: string;
    /** Guarded route the default `onRetry` boots into. */
    retryPath?: string;
}>();

const signOut = useSignOut({ loginPath: props.loginPath });

// Provided by the shell when the app passes `manifestGuard.clearCache`. The
// page is route-mounted, so injection is the only route in.
const clearManifestCache = inject(SUPER_ADMIN_MANIFEST_CLEAR_CACHE_KEY, undefined);

// Both handlers RETURN their promise rather than discarding it with `void`.
// Vue's event invoker forwards a returned rejection to the app's error handler;
// a dropped one becomes an unhandled rejection instead — and this is the page
// that renders when things are already going wrong, so a consumer's failing
// `onRetry` would vanish exactly where it matters most.
function retry(): void | Promise<void> {
    if (props.onRetry) return props.onRetry();
    return bootIntoGuardedRoute();
}

/**
 * Discards the cached manifest, then boots into a route the guard protects.
 *
 * Two things have to happen, and each covers a failure the other does not:
 *
 * The target must be GUARDED. `createAdminRoutes` registers `/admin-error` as
 * `meta.public` — it has to be, or the guard would redirect to itself forever
 * — and the guard returns before it ever reaches `ensureLoaded()` on a public
 * route. Reloading in place therefore re-renders the same error even after the
 * backend has recovered.
 *
 * And the cache must go first. The loader keeps an ETag in storage, which a
 * full document load does not touch, so a plain retry revalidates: a 304 hands
 * back the manifest the app already had, and an operator retrying after a
 * deployment would keep being shown the old one. Clearing first is what makes
 * the retry ask an open question.
 *
 * `router.resolve` rather than a bare path so an app served under a base href
 * lands inside its own app and not at the domain root.
 */
async function bootIntoGuardedRoute(): Promise<void> {
    if (clearManifestCache) {
        try {
            await clearManifestCache();
        } catch (err) {
            // Retrying with a stale cache is still better than not retrying.
            console.warn('[SaaSiCat] Clearing the manifest cache failed before retry:', err);
        }
    }
    window.location.assign(router.resolve(props.retryPath ?? '/admin').href);
}

function logout(): void | Promise<void> {
    if (props.onLogout) return props.onLogout();
    return signOut();
}
</script>

<style scoped>
.sa-manifest-error {
    padding: var(--sa-space-8);
    display: flex;
    justify-content: center;
    /* The page frame is a full viewport tall, and a stretched flex item would
     * make this card as tall as the screen for four lines of text. */
    align-items: flex-start;
}
.sa-manifest-error__card {
    max-width: 640px;
    width: 100%;
}
.sa-manifest-error__head {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
}
.sa-manifest-error__title {
    margin: 0;
    font-size: var(--sa-text-2xl);
}
.sa-manifest-error__lead,
.sa-manifest-error__detail {
    margin: 0 0 var(--sa-space-4);
    color: var(--sa-color-fg-secondary);
    line-height: 1.6;
}
.sa-manifest-error__detail {
    background: var(--sa-color-negative-surface);
    border-left: 3px solid var(--sa-color-negative);
    padding: var(--sa-space-3) var(--sa-space-4);
    border-radius: var(--sa-radius-badge);
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: var(--sa-text-md);
    color: var(--sa-color-negative-fg);
}
.sa-manifest-error__actions {
    display: flex;
    gap: var(--sa-space-3);
    margin-top: var(--sa-space-5);
}
</style>
