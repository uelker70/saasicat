<template>
    <div class="sa-manifest-error">
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
import { useRouter } from 'vue-router';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';
import { useSignOut } from '../vue/use-sign-out.js';

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
    /** Default: fresh boot into `retryPath`, which re-runs the manifest guard. */
    onRetry?: () => Promise<void> | void;
    /** Default: navigate to the login route `createAdminRoutes` registers. */
    onLogout?: () => void;
    /** Login path for the default `onLogout`. */
    loginPath?: string;
    /** Guarded route the default `onRetry` boots into. */
    retryPath?: string;
}>();

const signOut = useSignOut({ loginPath: props.loginPath });

function retry(): void {
    if (props.onRetry) {
        void props.onRetry();
        return;
    }
    // A full document load rather than a router navigation: the failure may sit
    // in a cached manifest body or a stale store, and only a fresh boot clears
    // both.
    //
    // It must target a GUARDED route. Reloading in place does nothing here:
    // `createAdminRoutes` registers `/admin-error` as `meta.public` (it has to,
    // or the guard would redirect to itself forever), and the guard returns
    // before it ever reaches `ensureLoaded()` on a public route. So a reload
    // re-renders the same error even after the backend has recovered, and the
    // operator's only way out is to edit the address bar.
    //
    // `router.resolve` rather than a bare path so an app served under a base
    // href lands inside its own app and not at the domain root.
    window.location.assign(router.resolve(props.retryPath ?? '/admin').href);
}

function logout(): void {
    if (props.onLogout) {
        props.onLogout();
        return;
    }
    void signOut();
}
</script>

<style scoped>
.sa-manifest-error {
    padding: 32px;
    display: flex;
    justify-content: center;
}
.sa-manifest-error__card {
    max-width: 640px;
    width: 100%;
}
.sa-manifest-error__head {
    display: flex;
    align-items: center;
    gap: 12px;
}
.sa-manifest-error__title {
    margin: 0;
    font-size: 22px;
}
.sa-manifest-error__lead,
.sa-manifest-error__detail {
    margin: 0 0 12px;
    color: var(--sa-muted-dark);
    line-height: 1.6;
}
.sa-manifest-error__detail {
    background: #fef2f2;
    border-left: 3px solid #dc2626;
    padding: 8px 12px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 13px;
    color: #991b1b;
}
.sa-manifest-error__actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
}
</style>
