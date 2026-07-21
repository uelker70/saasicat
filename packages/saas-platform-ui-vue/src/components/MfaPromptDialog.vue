<template>
    <q-dialog
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
        persistent
    >
        <q-card class="mfa-card">
            <q-card-section class="header">
                <q-icon name="lock" size="22px" color="amber-9" />
                <div class="text-h6">Multi-Faktor-Bestätigung</div>
            </q-card-section>
            <q-card-section>
                <p class="text-body2 q-mb-sm">
                    {{
                        description ??
                        'Diese Aktion ist sicherheitskritisch. Bitte 6-stelligen TOTP-Code aus Authenticator eingeben.'
                    }}
                </p>
                <q-input
                    v-model="code"
                    autofocus
                    mask="######"
                    maxlength="6"
                    outlined
                    dense
                    label="TOTP-Code"
                    :error="!!error"
                    :error-message="error"
                />
                <slot name="hint">
                    <div
                        v-if="setupHint"
                        class="text-caption text-grey-7 q-mt-xs"
                        v-html="setupHint"
                    />
                </slot>
            </q-card-section>
            <q-card-actions align="right">
                <q-btn flat label="Abbrechen" v-close-popup />
                <q-btn
                    unelevated
                    color="amber-9"
                    text-color="black"
                    label="Bestätigen"
                    :disable="code.length !== 6"
                    @click="onConfirm"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

// Cross-cutting MFA confirmation dialog. An app-specific setup hint
// (e.g. "MFA setup via CLI: ...") is shown via the `setupHint` prop or
// the `#hint` slot — the platform stays out of app CLIs.

const props = defineProps<{
    modelValue: boolean;
    description?: string;
    error?: string;
    /** Optional HTML string with an app-specific setup hint. */
    setupHint?: string;
}>();
const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'confirm', code: string): void;
}>();

const code = ref('');

watch(
    () => props.modelValue,
    (open) => {
        if (open) code.value = '';
    },
);

function onConfirm() {
    if (code.value.length !== 6) return;
    emit('confirm', code.value);
}
</script>

<style scoped>
.mfa-card {
    width: 380px;
    max-width: 92vw;
}
.header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 0;
}
code {
    background: rgba(15, 23, 42, 0.06);
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
}
</style>
