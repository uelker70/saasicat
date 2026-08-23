<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="emit('update:modelValue', $event)"
    >
        <q-card class="mfa-card">
            <q-card-section class="header">
                <q-icon name="lock" size="22px" color="amber-9" />
                <div class="text-h6">{{ msg.mfa.title }}</div>
            </q-card-section>
            <q-card-section>
                <p class="text-body2 q-mb-sm">{{ resolvedDescription }}</p>
                <q-input
                    v-model="code"
                    autofocus
                    mask="######"
                    maxlength="6"
                    outlined
                    dense
                    :label="msg.mfa.codeLabel"
                    :error="!!error"
                    :error-message="error"
                />
                <slot name="hint">
                    <!-- `setupHint` is markup the hosting app authored in its
                         own source (typically a link to its MFA setup docs). It
                         never carries request data, and an app that wants full
                         control over the node uses the `hint` slot instead. -->
                    <!-- eslint-disable vue/no-v-html -->
                    <div
                        v-if="setupHint"
                        class="text-caption text-grey-7 q-mt-xs"
                        v-html="setupHint"
                    />
                    <!-- eslint-enable vue/no-v-html -->
                </slot>
            </q-card-section>
            <q-card-actions align="right">
                <q-btn v-close-popup flat :label="common.cancel" />
                <q-btn
                    unelevated
                    color="amber-9"
                    text-color="black"
                    :label="common.confirm"
                    :disable="code.length !== 6"
                    @click="onConfirm"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

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

const msg = useSaMessages('shell');
const common = useSaMessages('common');
const resolvedDescription = computed(() => props.description ?? msg.value.mfa.defaultDescription);

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
    gap: var(--sa-space-3);
    padding-bottom: 0;
}
code {
    background: var(--sa-color-bg-sunken);
    padding: var(--sa-space-0) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
    font-size: var(--sa-text-xs);
}
</style>
