<template>
    <div class="sa-manifest-error">
        <q-card class="sa-manifest-error__card">
            <q-card-section class="sa-manifest-error__head">
                <q-icon name="cloud_off" size="32px" color="negative" />
                <h1 class="sa-manifest-error__title">Admin-Manifest nicht erreichbar</h1>
            </q-card-section>
            <q-card-section>
                <p class="sa-manifest-error__lead">
                    Das Plattform-Manifest konnte nicht geladen werden. Ohne Manifest sind Sidebar,
                    Capabilities und Action-Buttons nicht zuverlässig — die UI würde sonst falsche
                    oder unerreichbare Buttons rendern. Der Router hat dich deshalb hierher
                    geschickt (fail-closed).
                </p>
                <p v-if="errorMessage" class="sa-manifest-error__detail">
                    <strong>Detail:</strong> {{ errorMessage }}
                </p>
                <div class="sa-manifest-error__actions">
                    <q-btn unelevated color="primary" label="Erneut laden" @click="onRetry" />
                    <q-btn flat label="Logout" @click="onLogout" />
                </div>
            </q-card-section>
        </q-card>
    </div>
</template>

<script setup lang="ts">
// Platform standard error page for `manifestGuard.errorRoute`.
// Consumers pass `onRetry`/`onLogout` in as callbacks and decide
// themselves what happens (e.g. manifestStore.clearCache() + ensureLoaded,
// authStore.logout, router.replace).

defineProps<{
    errorMessage?: string | null;
    onRetry: () => Promise<void> | void;
    onLogout: () => void;
}>();
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
    color: #475569;
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
