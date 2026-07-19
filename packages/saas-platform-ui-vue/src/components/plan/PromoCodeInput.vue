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
import type { PromoState } from '../../use-subscription-draft.js';

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
    border: 1px dashed rgba(15, 118, 110, 0.3);
    background: rgba(15, 118, 110, 0.04);
    border-radius: 10px;
    color: var(--q-primary, #0f766e);
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 0.01em;
}
.sp-promo__toggle:hover {
    background: rgba(15, 118, 110, 0.1);
}
.sp-promo {
    margin: 10px 0 6px;
    padding: 10px;
    background: rgba(15, 118, 110, 0.04);
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 10px;
}
.sp-promo--valid {
    border-color: rgba(22, 163, 74, 0.5);
    background: rgba(22, 163, 74, 0.06);
}
.sp-promo--invalid {
    border-color: rgba(220, 38, 38, 0.4);
    background: rgba(220, 38, 38, 0.04);
}
.sp-promo--restricted {
    border-color: rgba(245, 158, 11, 0.4);
    background: rgba(245, 158, 11, 0.06);
}
.sp-promo__field {
    display: flex;
    gap: 6px;
}
.sp-promo__field input {
    flex: 1;
    padding: 8px 10px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 8px;
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 12px;
    letter-spacing: 0.04em;
    background: #fff;
    outline: none;
    text-transform: uppercase;
}
.sp-promo__field input:focus {
    border-color: var(--q-primary, #0f766e);
}
.sp-promo__btn {
    padding: 8px 12px;
    background: var(--q-primary, #0f766e);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-family: inherit;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    min-width: 70px;
}
.sp-promo__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.sp-promo__btn--remove {
    background: rgba(220, 38, 38, 0.1);
    color: #b91c1c;
}
.sp-promo__msg {
    margin-top: 6px;
    font-size: 11px;
    font-weight: 600;
}
.sp-promo__msg--valid {
    color: #166534;
}
.sp-promo__msg--invalid {
    color: #b91c1c;
}
.sp-promo__msg--restricted {
    color: #92400e;
}
</style>
