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
            </div>

            <h1 class="sa-login-title">Anmelden</h1>
            <p v-if="subtitle" class="sa-login-subtitle">{{ subtitle }}</p>

            <q-form @submit.prevent="handleSubmit" class="sa-login-form">
                <q-input
                    v-model="form.email"
                    label="E-Mail"
                    type="email"
                    outlined
                    dense
                    autofocus
                    :disable="loading"
                    class="q-mb-sm"
                    :rules="[(v: string) => /\S+@\S+\.\S+/.test(v) || 'Bitte gültige E-Mail']"
                />
                <q-input
                    v-model="form.password"
                    label="Passwort"
                    :type="showPw ? 'text' : 'password'"
                    outlined
                    dense
                    :disable="loading"
                    class="q-mb-sm"
                    :rules="[(v: string) => v.length > 0 || 'Passwort ist Pflicht']"
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
                    label="Anmelden"
                    :loading="loading"
                    :disable="!canSubmit"
                    class="full-width q-mt-sm"
                    type="submit"
                />
            </q-form>

            <div v-if="devHint" class="sa-login-hint">
                Test-Account: <code>{{ devHint.email }}</code> / <code>{{ devHint.password }}</code>
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

import { usePublicBoot } from '../use-public-boot.js';
import {
    useSuperAdminBrand,
    useSuperAdminEndpoints,
    useSuperAdminHttp,
    useSuperAdminLoginAdapter,
} from '../use-super-admin-context.js';
import { getJson } from '../http-json.js';
import SuperAdminSetupWizard from './SuperAdminSetupWizard.vue';

interface Props {
    /**
     * Optional additional subtitle below the title (e.g. a hint about the
     * SUPER_ADMIN role). Empty by default.
     */
    subtitle?: string;
}

const props = defineProps<Props>();

const router = useRouter();
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

const brandName = computed(() => boot.boot.value?.project.displayName ?? brand.name);
const tagText = computed(() => boot.boot.value?.project.label ?? brand.tag ?? 'SuperAdmin');
const iconText = computed(() => boot.boot.value?.project.icon ?? brand.logoText);
const logoUrl = computed(() => boot.boot.value?.project.logoUrl ?? null);
const bootEnvironment = computed(() => {
    const env = boot.boot.value?.project.environment;
    return env && env !== 'production' ? env : null;
});

const devHint = computed(() => {
    if (!adapter.devHint) return null;
    if (boot.boot.value?.project.environment === 'production') return null;
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
    if (result.code === 'BAD_CREDENTIALS') return 'E-Mail oder Passwort falsch.';
    if (result.code === 'NOT_SUPER_ADMIN') {
        return 'Dieser Account hat keine SUPER_ADMIN-Rolle. Bitte Tenant-Frontend nutzen.';
    }
    return 'Anmeldung fehlgeschlagen.';
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
            e.response?.data?.message ?? e.response?.data?.code ?? 'Anmeldung fehlgeschlagen.';
    } finally {
        loading.value = false;
    }
}
</script>

<style scoped>
.sa-login-wrap {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
}
.sa-login-card {
    width: 420px;
    max-width: 92vw;
    background: #fff;
    border-radius: 18px;
    padding: 32px;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.25);
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
    background: var(--sa-login-logo-bg, linear-gradient(135deg, #475569, #1e293b));
    color: var(--sa-login-logo-color, #fff);
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
    color: #0f172a;
    line-height: 1.1;
}
.sa-login-brand__tag {
    font-size: 12px;
    color: var(--sa-login-tag-color, #475569);
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.sa-login-title {
    font-size: 22px;
    font-weight: 800;
    color: #0f172a;
    margin: 0 0 6px;
}
.sa-login-subtitle {
    font-size: 13px;
    color: #475569;
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
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    font-size: 13px;
    margin-top: 4px;
    padding: 8px 12px;
    border-radius: 8px;
}
.sa-login-hint {
    margin-top: 18px;
    padding: 10px 12px;
    background: #f1f5f9;
    border-radius: 8px;
    font-size: 12px;
    color: #475569;
}
.sa-login-hint code {
    background: #e2e8f0;
    padding: 1px 5px;
    border-radius: 4px;
}
.sa-login-env {
    margin-top: 18px;
    color: #cbd5e1;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
</style>
