<template>
    <SuperAdminSetupWizard
        v-if="needsSetup"
        :display-name="brandName"
        :icon="iconText"
        @done="needsSetup = false"
    />
    <div v-else class="sa-page sa-login-wrap">
        <div class="sa-login-card">
            <div class="sa-login-brand">
                <div v-if="logoUrl" class="sa-login-logo sa-login-logo--img">
                    <img :src="logoUrl" :alt="brandName" />
                </div>
                <div v-else class="sa-login-logo sa-login-logo--text">
                    {{ iconText }}
                </div>
                <div class="sa-login-brand__text">
                    <div class="sa-login-brand__name">{{ brandName }}</div>
                    <div class="sa-login-brand__tag">{{ tagText }}</div>
                </div>
                <LocaleSwitcher class="sa-login-locale" />
                <ThemeSwitcher class="sa-login-theme" />
            </div>

            <h1 class="sa-login-title">{{ msg.login.signIn }}</h1>
            <p v-if="subtitle" class="sa-login-subtitle">{{ subtitle }}</p>

            <q-form class="sa-login-form" @submit.prevent="handleSubmit">
                <q-input
                    v-model="form.email"
                    :label="msg.emailLabel"
                    type="email"
                    autocomplete="username"
                    outlined
                    dense
                    autofocus
                    :disable="loading"
                    class="q-mb-sm"
                    :rules="[(v: string) => looksLikeEmail(v) || msg.invalidEmail]"
                />
                <q-input
                    v-model="form.password"
                    :label="msg.passwordLabel"
                    :type="showPw ? 'text' : 'password'"
                    autocomplete="current-password"
                    outlined
                    dense
                    :disable="loading"
                    class="q-mb-sm"
                    :rules="[(v: string) => v.length > 0 || msg.login.passwordRequired]"
                >
                    <template #append>
                        <q-icon
                            :name="showPw ? 'visibility_off' : 'visibility'"
                            class="cursor-pointer"
                            @click="showPw = !showPw"
                        />
                    </template>
                </q-input>

                <AdminBanner v-if="errorMessage" tone="negative">
                    {{ errorMessage }}
                </AdminBanner>

                <q-btn
                    unelevated
                    color="primary"
                    icon="login"
                    :label="msg.login.signIn"
                    :loading="loading"
                    :disable="!canSubmit"
                    class="full-width q-mt-sm"
                    type="submit"
                />
            </q-form>

            <div v-if="devHint" class="sa-login-hint">
                {{ msg.login.devHintLabel }} <code>{{ devHint.email }}</code> /
                <code>{{ devHint.password }}</code>
            </div>
        </div>

        <div v-if="bootEnvironment" class="sa-login-env">
            {{ brandName }} · {{ bootEnvironment }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AdminBanner from '../ui/feedback/AdminBanner.vue';
import { useRouter } from 'vue-router';
import type { SetupStatusResponse } from '@saasicat/core';

import { usePublicBoot } from '../vue/use-public-boot.js';
import {
    useSuperAdminBrand,
    useSuperAdminEndpoints,
    useSuperAdminHttp,
    useSuperAdminLoginAdapter,
} from '../vue/use-super-admin-context.js';
import { getJson } from '../client/http-json.js';
import { looksLikeEmail } from '../client/text-shape.js';
import { isProductionBoot, resolveLoginBranding } from '../client/login-branding.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';
import LocaleSwitcher from '../ui/page/LocaleSwitcher.vue';
import ThemeSwitcher from '../ui/page/ThemeSwitcher.vue';
import SuperAdminSetupWizard from './SuperAdminSetupWizard.vue';

interface Props {
    /**
     * Optional additional subtitle below the title (e.g. a hint about the
     * SUPER_ADMIN role). Empty by default.
     */
    subtitle?: string;
}

defineProps<Props>();

const router = useRouter();
const msg = useSaMessages('shell');
const brand = useSuperAdminBrand();
const endpoints = useSuperAdminEndpoints();
const adapter = useSuperAdminLoginAdapter();
const http = useSuperAdminHttp();
const boot = usePublicBoot({ endpoint: endpoints.publicBootEndpoint, http });

const form = reactive({ email: adapter.devHint?.email ?? '', password: '' });
const showPw = ref(false);
const loading = ref(false);
const errorMessage = ref<string | null>(null);
// First run: as long as no SUPER_ADMIN exists, this page shows the setup
// wizard instead of the login. Apps without a SetupModule return 404 → stays false.
const needsSetup = ref(false);

const branding = computed(() => resolveLoginBranding(boot.boot.value, brand));
const brandName = computed(() => branding.value.name);
const tagText = computed(() => branding.value.tag);
const iconText = computed(() => branding.value.icon);
const logoUrl = computed(() => branding.value.logoUrl);
const bootEnvironment = computed(() => branding.value.environment);

const devHint = computed(() => {
    if (!adapter.devHint) return null;
    if (isProductionBoot(boot.boot.value)) return null;
    return adapter.devHint;
});

const canSubmit = computed(
    () => looksLikeEmail(form.email) && form.password.length >= 1 && !loading.value,
);

onMounted(() => {
    void boot.load();
    void checkSetup();
});

async function checkSetup(): Promise<void> {
    try {
        const status = await getJson<SetupStatusResponse>(
            http,
            `${endpoints.apiBase}/setup/status`,
        );
        needsSetup.value = status.needsSetup === true;
    } catch {
        // Setup endpoint not present (app without a SetupModule) → normal login.
    }
}

function describeError(
    result: Extract<Awaited<ReturnType<typeof adapter.login>>, { ok: false }>,
): string {
    if (result.message) return result.message;
    if (result.code === 'BAD_CREDENTIALS') return msg.value.login.errorBadCredentials;
    if (result.code === 'NOT_SUPER_ADMIN') return msg.value.login.errorNotSuperAdmin;
    return msg.value.login.errorFailed;
}

async function handleSubmit(): Promise<void> {
    if (!canSubmit.value) return;
    loading.value = true;
    errorMessage.value = null;
    try {
        const result = await adapter.login(form.email, form.password);
        if (result.ok) {
            await router.push(adapter.redirectAfterLogin ?? '/admin/dashboard');
            return;
        }
        errorMessage.value = describeError(result);
    } catch (err) {
        const e = err as { response?: { data?: { message?: string; code?: string } } };
        errorMessage.value =
            e.response?.data?.message ?? e.response?.data?.code ?? msg.value.login.errorFailed;
    } finally {
        loading.value = false;
    }
}
</script>

<style scoped>
.sa-login-locale,
.sa-login-theme {
    /* In the card's flow rather than floating over it: a fixed overlay lands
       on top of the centered card on short viewports. */
    align-self: flex-start;
    color: var(--sa-login-tag-color, var(--sa-color-fg-secondary));
}
/* One `auto` on the first of the pair moves both — a second would put the gap
   between them at the mercy of the card width instead of the row's own. */
.sa-login-locale {
    margin-left: auto;
}
.sa-login-wrap {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--sa-space-7);
    background: linear-gradient(
        180deg,
        var(--sa-color-inverse-bg) 0%,
        var(--sa-color-inverse-surface) 100%
    );
}
.sa-login-card {
    width: 420px;
    max-width: 92vw;
    background: var(--sa-color-bg-surface);
    border-radius: var(--sa-radius-hero);
    padding: var(--sa-space-8);
    box-shadow: 0 24px 48px var(--sa-shadow-tint-4);
}
.sa-login-brand {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
    margin-bottom: var(--sa-space-6);
}
.sa-login-logo {
    width: 44px;
    height: 44px;
    /* The row has to give width up somewhere once the switchers joined it, and
       the mark is the wrong donor: a flex item shrinks from its own basis, so
       the logo went to 32.73px at 390 and to nothing at all at 320. Pinning it
       moves the deficit onto the brand text beside it, which has somewhere to
       put it — it wraps. `min-width: 0` on that text is the other half; without
       it the text refuses the deficit too and the row leaves the viewport. */
    flex: none;
    border-radius: var(--sa-radius-tile);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}
.sa-login-logo--text {
    background: var(
        --sa-login-logo-bg,
        linear-gradient(
            135deg,
            var(--sa-color-inverse-surface-soft),
            var(--sa-color-inverse-surface)
        )
    );
    /* The fallback has to match the fallback background above, which is the
     * invariant dark gradient — not the accent. An app that sets its own
     * `--sa-login-logo-bg` sets `--sa-login-logo-color` with it. */
    color: var(--sa-login-logo-color, var(--sa-color-inverse-fg));
    font-weight: 800;
    font-size: var(--sa-text-xl);
    text-transform: uppercase;
}
.sa-login-logo--img img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
/* `min-width: auto` is a flex item's default and it refuses to shrink below the
   longest word — which is why the row's deficit landed on the mark instead, and
   why pinning the mark on its own is not the whole fix. Zero lets this block
   take the deficit and wrap. */
.sa-login-brand__text {
    min-width: 0;
}
.sa-login-brand__name {
    font-weight: 800;
    font-size: var(--sa-text-lg);
    color: var(--sa-color-fg-heading);
    line-height: 1.1;
}
.sa-login-brand__tag {
    font-size: var(--sa-text-sm);
    color: var(--sa-login-tag-color, var(--sa-color-fg-secondary));
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
}

.sa-login-title {
    font-size: var(--sa-text-2xl);
    font-weight: 800;
    color: var(--sa-color-fg-heading);
    margin: 0 0 var(--sa-space-2);
}
.sa-login-subtitle {
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
    margin: 0 0 var(--sa-space-6);
    line-height: 1.5;
}

/* The heading block is one unit, and the form sits the same distance below it
 * whether or not the optional subtitle is there. Without this the gap was the
 * title's 6px on a login that passes no subtitle — which nobody saw, because
 * Quasar's element-level `h1` line-height was padding it out to 96px. */
.sa-login-form {
    margin-top: var(--sa-space-6);
    display: flex;
    flex-direction: column;
}
.full-width {
    width: 100%;
}
.sa-login-hint {
    margin-top: var(--sa-space-5);
    padding: var(--sa-space-3) var(--sa-space-4);
    background: var(--sa-color-border-soft);
    border-radius: var(--sa-radius-field);
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
}
.sa-login-hint code {
    background: var(--sa-color-border);
    padding: var(--sa-space-0) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
}
.sa-login-env {
    margin-top: var(--sa-space-5);
    color: var(--sa-color-inverse-fg-muted);
    font-size: var(--sa-text-sm);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
}
</style>
