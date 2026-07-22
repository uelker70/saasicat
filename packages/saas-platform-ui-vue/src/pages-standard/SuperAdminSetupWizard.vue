<template>
    <div class="sa-setup-wrap">
        <div class="sa-setup-card">
            <div class="sa-setup-head">
                <div class="sa-setup-badge">{{ iconText }}</div>
                <div>
                    <div class="sa-setup-title">{{ msg.setup.title }}</div>
                    <div class="sa-setup-sub">{{ subtitleText }}</div>
                </div>
            </div>

            <q-banner v-if="errorMessage" class="sa-setup-error" rounded>
                {{ errorMessage }}
            </q-banner>

            <!-- Step 1: create SuperAdmin -->
            <q-form v-if="step === 'form'" @submit.prevent="submitCreate" class="sa-setup-form">
                <p class="sa-setup-hint">
                    {{ msg.setup.tokenHintBefore }}
                    <code>SETUP_TOKEN</code>
                    {{ msg.setup.tokenHintAfter }}
                </p>
                <q-input
                    v-model="form.token"
                    :label="msg.setup.tokenLabel"
                    type="password"
                    outlined
                    dense
                    autofocus
                    :disable="loading"
                    class="q-mb-sm"
                    :rules="[(v: string) => v.length > 0 || msg.setup.tokenRequired]"
                />
                <q-input
                    v-model="form.email"
                    :label="msg.emailLabel"
                    type="email"
                    outlined
                    dense
                    :disable="loading"
                    class="q-mb-sm"
                    :rules="[(v: string) => /\S+@\S+\.\S+/.test(v) || msg.invalidEmail]"
                />
                <q-input
                    v-model="form.password"
                    :label="msg.setup.passwordLabel"
                    :type="showPw ? 'text' : 'password'"
                    outlined
                    dense
                    :disable="loading"
                    :hint="msg.setup.passwordHint"
                    class="q-mb-sm"
                    :rules="[
                        (v: string) =>
                            v.length === 0 || v.length >= 8 || msg.setup.passwordMinLength,
                    ]"
                >
                    <template #append>
                        <q-icon
                            :name="showPw ? 'visibility_off' : 'visibility'"
                            class="cursor-pointer"
                            @click="showPw = !showPw"
                        />
                    </template>
                </q-input>
                <q-btn
                    unelevated
                    color="primary"
                    icon="person_add"
                    :label="msg.setup.submit"
                    :loading="loading"
                    :disable="!canCreate"
                    class="full-width q-mt-sm"
                    type="submit"
                />
            </q-form>

            <!-- Step 2: set up MFA -->
            <div v-else-if="step === 'mfa' && result" class="sa-setup-mfa">
                <p class="sa-setup-hint">
                    {{ msg.setup.mfaIntroBefore }} <strong>{{ result.email }}</strong>
                    {{ msg.setup.mfaIntroAfter }}
                </p>

                <div v-if="result.generatedPassword" class="sa-setup-secret">
                    <div class="sa-setup-secret__label">
                        {{ msg.setup.generatedPasswordLabel }}
                    </div>
                    <code class="sa-setup-secret__value">{{ result.generatedPassword }}</code>
                </div>

                <div v-if="result.qrDataUrl" class="sa-setup-qr">
                    <img :src="result.qrDataUrl" :alt="msg.setup.qrAlt" width="200" height="200" />
                    <div class="sa-setup-qr__hint">{{ msg.setup.qrHint }}</div>
                </div>

                <div class="sa-setup-secret">
                    <div class="sa-setup-secret__label">{{ msg.setup.manualSecretLabel }}</div>
                    <code class="sa-setup-secret__value">{{ result.secret }}</code>
                </div>
                <details class="sa-setup-uri">
                    <summary>{{ msg.setup.otpauthSummary }}</summary>
                    <code class="sa-setup-uri__value">{{ result.otpauthUri }}</code>
                </details>

                <q-form @submit.prevent="submitConfirm" class="sa-setup-form q-mt-md">
                    <q-input
                        v-model="mfaCode"
                        :label="msg.setup.codeLabel"
                        outlined
                        dense
                        autofocus
                        inputmode="numeric"
                        maxlength="6"
                        :disable="loading"
                        :rules="[(v: string) => /^\d{6}$/.test(v) || msg.setup.codeInvalid]"
                    />
                    <q-btn
                        unelevated
                        color="primary"
                        icon="verified_user"
                        :label="msg.setup.confirmMfa"
                        :loading="loading"
                        :disable="!/^\d{6}$/.test(mfaCode) || loading"
                        class="full-width q-mt-sm"
                        type="submit"
                    />
                </q-form>
                <button class="sa-setup-skip" type="button" @click="step = 'done'">
                    {{ msg.setup.skip }}
                </button>
            </div>

            <!-- Step 3: done -->
            <div v-else-if="step === 'done'" class="sa-setup-done">
                <q-icon name="check_circle" color="positive" size="48px" />
                <p class="sa-setup-hint">{{ msg.setup.doneHint }}</p>
                <q-btn
                    unelevated
                    color="primary"
                    icon="login"
                    :label="msg.setup.toLogin"
                    class="full-width"
                    @click="emit('done')"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { SETUP_ERROR_CODES, type SetupConfirmMfaResponse, type SetupResult } from '@saasicat/types';

import {
    useSuperAdminBrand,
    useSuperAdminEndpoints,
    useSuperAdminHttp,
} from '../vue/use-super-admin-context.js';
import { HttpJsonError, postJson as httpPostJson } from '../client/http-json.js';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';

interface Props {
    /** Display name + badge abbreviation (override the app branding, e.g. from PublicBoot). */
    displayName?: string;
    icon?: string;
}
const props = defineProps<Props>();

// `done` signals the parent screen (LoginPage) that the form should be
// shown again — the freshly created SuperAdmin then signs in.
const emit = defineEmits<{ done: [] }>();

const msg = useSaMessages('shell');
const brand = useSuperAdminBrand();
const endpoints = useSuperAdminEndpoints();
const http = useSuperAdminHttp();

const brandName = computed(() => props.displayName ?? brand.name);
const iconText = computed(() => props.icon ?? brand.logoText);
const subtitleText = computed(() =>
    formatMessage(msg.value.setup.subtitle, { brand: brandName.value }),
);

const step = ref<'form' | 'mfa' | 'done'>('form');
const form = reactive({ token: '', email: '', password: '' });
const showPw = ref(false);
const mfaCode = ref('');
const result = ref<SetupResult | null>(null);
const loading = ref(false);
const errorMessage = ref<string | null>(null);

const canCreate = computed(
    () =>
        form.token.length > 0 &&
        /\S+@\S+\.\S+/.test(form.email) &&
        (form.password.length === 0 || form.password.length >= 8) &&
        !loading.value,
);

const errorByCode = computed<Record<string, string>>(() => ({
    [SETUP_ERROR_CODES.SETUP_DISABLED]: msg.value.setup.errorSetupDisabled,
    [SETUP_ERROR_CODES.INVALID_SETUP_TOKEN]: msg.value.setup.errorInvalidToken,
    [SETUP_ERROR_CODES.SETUP_ALREADY_DONE]: msg.value.setup.errorAlreadyDone,
    [SETUP_ERROR_CODES.INVALID_EMAIL]: msg.value.setup.errorInvalidEmail,
    [SETUP_ERROR_CODES.EMAIL_EXISTS]: msg.value.setup.errorEmailExists,
}));

// Goes through the injected HttpClient (consumer's auth/baseURL apply);
// maps the error code from the body to a readable message.
async function postJson<T>(path: string, body: unknown): Promise<T> {
    try {
        return await httpPostJson<T>(http, `${endpoints.apiBase}${path}`, body);
    } catch (err) {
        if (err instanceof HttpJsonError) {
            throw new Error(
                (err.code && errorByCode.value[err.code]) ||
                    formatMessage(msg.value.setup.errorHttp, { status: err.status }),
            );
        }
        throw err;
    }
}

async function submitCreate(): Promise<void> {
    if (!canCreate.value) return;
    loading.value = true;
    errorMessage.value = null;
    try {
        result.value = await postJson<SetupResult>('/setup', {
            token: form.token,
            email: form.email.toLowerCase(),
            ...(form.password ? { password: form.password } : {}),
        });
        step.value = 'mfa';
    } catch (err) {
        errorMessage.value = err instanceof Error ? err.message : msg.value.setup.errorFailed;
    } finally {
        loading.value = false;
    }
}

async function submitConfirm(): Promise<void> {
    if (!result.value || !/^\d{6}$/.test(mfaCode.value)) return;
    loading.value = true;
    errorMessage.value = null;
    try {
        const res = await postJson<SetupConfirmMfaResponse>('/setup/confirm-mfa', {
            token: form.token,
            userId: result.value.userId,
            code: mfaCode.value,
        });
        if (res.ok) {
            step.value = 'done';
        } else {
            errorMessage.value = msg.value.setup.errorCodeInvalid;
        }
    } catch (err) {
        errorMessage.value =
            err instanceof Error ? err.message : msg.value.setup.errorConfirmFailed;
    } finally {
        loading.value = false;
    }
}
</script>

<style scoped>
.sa-setup-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
}
.sa-setup-card {
    width: 460px;
    max-width: 92vw;
    background: #fff;
    border-radius: 18px;
    padding: 32px;
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.25);
}
.sa-setup-head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
}
.sa-setup-badge {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #475569, #1e293b);
    color: #fff;
    font-weight: 800;
    font-size: 18px;
    text-transform: uppercase;
}
.sa-setup-title {
    font-weight: 800;
    font-size: 18px;
    color: #0f172a;
    line-height: 1.1;
}
.sa-setup-sub {
    font-size: 12px;
    color: #475569;
}
.sa-setup-hint {
    font-size: 13px;
    color: #475569;
    line-height: 1.5;
    margin: 0 0 16px;
}
.sa-setup-hint code {
    background: #e2e8f0;
    padding: 1px 5px;
    border-radius: 4px;
}
.sa-setup-form {
    display: flex;
    flex-direction: column;
}
.full-width {
    width: 100%;
}
.sa-setup-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    font-size: 13px;
    margin-bottom: 16px;
    padding: 8px 12px;
    border-radius: 8px;
}
.sa-setup-qr {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    margin-bottom: 12px;
}
.sa-setup-qr img {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px;
    background: #fff;
}
.sa-setup-qr__hint {
    font-size: 12px;
    color: #64748b;
}
.sa-setup-secret {
    background: #f1f5f9;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 10px;
}
.sa-setup-secret__label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
    margin-bottom: 4px;
}
.sa-setup-secret__value {
    font-size: 15px;
    font-weight: 700;
    color: #0f172a;
    word-break: break-all;
    letter-spacing: 0.04em;
}
.sa-setup-uri {
    margin: 4px 0 4px;
    font-size: 12px;
    color: #475569;
}
.sa-setup-uri__value {
    display: block;
    margin-top: 6px;
    word-break: break-all;
    color: #334155;
    background: #f8fafc;
    padding: 6px 8px;
    border-radius: 6px;
}
.sa-setup-skip {
    margin-top: 14px;
    width: 100%;
    background: none;
    border: none;
    color: #64748b;
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
}
.sa-setup-done {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 10px;
}
</style>
