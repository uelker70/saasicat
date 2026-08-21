<template>
    <button
        v-if="!open && state.status === 'idle'"
        type="button"
        class="sp-promo__toggle"
        @click="open = true"
    >
        🎟 {{ i18n.openLabel }}
    </button>
    <div v-else class="sp-promo" :class="`sp-promo--${state.status}`">
        <div class="sp-promo__field">
            <input
                v-model="localCode"
                :placeholder="i18n.placeholder"
                :disabled="state.status === 'checking'"
                :aria-label="i18n.placeholder"
                @input="onInput"
                @keydown.enter.prevent="apply"
            />
            <button
                v-if="state.status === 'valid'"
                type="button"
                class="sp-promo__btn sp-promo__btn--remove"
                @click="remove"
            >
                {{ i18n.remove }}
            </button>
            <button
                v-else
                type="button"
                class="sp-promo__btn"
                :disabled="!localCode || state.status === 'checking'"
                @click="apply"
            >
                {{ state.status === 'checking' ? '…' : i18n.apply }}
            </button>
        </div>
        <div v-if="state.message" :class="['sp-promo__msg', `sp-promo__msg--${state.status}`]">
            <template v-if="state.status === 'valid'">✓ </template>
            <template v-else-if="state.status === 'invalid'">⚠ </template>
            <template v-else-if="state.status === 'restricted'">ℹ </template>
            {{ state.message }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { PromoState } from '../../vue/use-subscription-draft.js';

interface I18n {
    openLabel: string;
    placeholder: string;
    apply: string;
    remove: string;
}

const props = defineProps<{
    modelValue: string;
    state: PromoState;
    i18n: I18n;
}>();

const emit = defineEmits<{
    'update:modelValue': [string];
    apply: [];
    remove: [];
}>();

const open = ref(props.state.status !== 'idle');
const localCode = ref(props.modelValue);

watch(
    () => props.modelValue,
    (v) => {
        if (v !== localCode.value) localCode.value = v;
    },
);
watch(
    () => props.state.status,
    (s) => {
        if (s !== 'idle') open.value = true;
    },
);

function onInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value.toUpperCase();
    localCode.value = v;
    emit('update:modelValue', v);
}

function apply(): void {
    if (!localCode.value) return;
    emit('apply');
}

function remove(): void {
    emit('remove');
}
</script>

<style scoped>
.sp-promo__toggle {
    width: 100%;
    padding: 10px 12px;
    margin: 10px 0 6px;
    border: 1px dashed var(--sa-color-accent-border);
    background: var(--sa-color-accent-surface-soft);
    border-radius: 10px;
    color: var(--sa-color-accent-strong);
    font-weight: 700;
    font-size: var(--sa-text-sm);
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 0.01em;
}
.sp-promo__toggle:hover {
    background: var(--sa-color-accent-surface);
}
.sp-promo {
    margin: 10px 0 6px;
    padding: 10px;
    background: var(--sa-color-accent-surface-soft);
    border: 1px solid var(--sa-color-border);
    border-radius: 10px;
}
.sp-promo--valid {
    border-color: var(--sa-color-positive-border);
    background: var(--sa-color-positive-surface);
}
.sp-promo--invalid {
    border-color: var(--sa-color-negative-border);
    background: var(--sa-color-negative-surface);
}
.sp-promo--restricted {
    border-color: var(--sa-color-warning-border);
    background: var(--sa-color-warning-surface);
}
.sp-promo__field {
    display: flex;
    gap: 6px;
}
.sp-promo__field input {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid var(--sa-color-border);
    border-radius: 8px;
    font-family: 'SF Mono', Consolas, monospace;
    font-size: var(--sa-text-sm);
    letter-spacing: 0.04em;
    background: var(--sa-color-bg-surface);
    outline: none;
    text-transform: uppercase;
}
.sp-promo__field input:focus {
    border-color: var(--sa-color-accent);
}
.sp-promo__btn {
    padding: 8px 12px;
    background: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
    border: none;
    border-radius: 8px;
    font-family: inherit;
    font-size: var(--sa-text-xs);
    font-weight: 700;
    cursor: pointer;
    min-width: 70px;
}
.sp-promo__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.sp-promo__btn--remove {
    background: var(--sa-color-negative-surface);
    color: var(--sa-color-negative-fg);
}
.sp-promo__msg {
    margin-top: 6px;
    font-size: var(--sa-text-xs);
    font-weight: 600;
}
.sp-promo__msg--valid {
    color: var(--sa-color-positive-fg);
}
.sp-promo__msg--invalid {
    color: var(--sa-color-negative-fg);
}
.sp-promo__msg--restricted {
    color: var(--sa-color-warning-fg);
}
</style>
