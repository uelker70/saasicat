<template>
    <SuperAdminSetupWizard
        v-if="needsSetup"
        :display-name="brandName"
        :icon="iconText"
        @done="needsSetup = false"
    />
    <div v-else class="sa-login-wrap">
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
                    :rules="[(v: string) => /\S+@\S+\.\S+/.test(v) || msg.invalidEmail]"
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

                <q-banner v-if="errorMessage" class="sa-login-error" rounded>
                    {{ errorMessage }}
                </q-banner>

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
import { useRouter } from 'vue-router';
import type { SetupStatusResponse } from '@saasicat/types';

import { usePublicBoot } from '../vue/use-public-boot.js';
import {
    useSuperAdminBrand,
    useSuperAdminEndpoints,
    useSuperAdminHttp,
    useSuperAdminLoginAdapter,
} from '../vue/use-super-admin-context.js';
import { getJson } from '../client/http-json.js';
import { isProductionBoot, resolveLoginBranding } from '../client/login-branding.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';
import LocaleSwitcher from '../components/LocaleSwitcher.vue';
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
    () => /\S+@\S+\.\S+/.test(form.email) && form.password.length >= 1 && !loading.value,
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
.sa-login-locale {
    /* In the card's flow rather than floating over it: a fixed overlay lands
       on top of the centered card on short viewports. */
    margin-left: auto;
    align-self: flex-start;
    color: var(--sa-login-tag-color, var(--sa-color-fg-secondary));
}
.sa-login-wrap {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
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
    border-radius: 18px;
    padding: 32px;
    box-shadow: 0 24px 48px var(--sa-shadow-tint-4);
}
.sa-login-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 22px;
}
.sa-login-logo {
    width: 44px;
    height: 44px;
    border-radius: 10px;
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
    color: var(--sa-login-logo-color, var(--sa-color-fg-on-accent));
    font-weight: 800;
    font-size: 18px;
    text-transform: uppercase;
}
.sa-login-logo--img img {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.sa-login-brand__name {
    font-weight: 800;
    font-size: 16px;
    color: var(--sa-color-fg-heading);
    line-height: 1.1;
}
.sa-login-brand__tag {
    font-size: 12px;
    color: var(--sa-login-tag-color, var(--sa-color-fg-secondary));
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.sa-login-title {
    font-size: 22px;
    font-weight: 800;
    color: var(--sa-color-fg-heading);
    margin: 0 0 6px;
}
.sa-login-subtitle {
    font-size: 13px;
    color: var(--sa-color-fg-secondary);
    margin: 0 0 20px;
    line-height: 1.5;
}

.sa-login-form {
    display: flex;
    flex-direction: column;
}
.full-width {
    width: 100%;
}
.sa-login-error {
    background: var(--sa-color-negative-surface);
    border: 1px solid var(--sa-color-negative-border);
    color: var(--sa-color-negative-fg);
    font-size: 13px;
    margin-top: 4px;
    padding: 8px 12px;
    border-radius: 8px;
}
.sa-login-hint {
    margin-top: 18px;
    padding: 10px 12px;
    background: var(--sa-color-border-soft);
    border-radius: 8px;
    font-size: 12px;
    color: var(--sa-color-fg-secondary);
}
.sa-login-hint code {
    background: var(--sa-color-border);
    padding: 1px 5px;
    border-radius: 4px;
}
.sa-login-env {
    margin-top: 18px;
    color: var(--sa-color-inverse-fg-muted);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
</style>
