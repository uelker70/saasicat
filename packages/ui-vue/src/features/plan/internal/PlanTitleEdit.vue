<template>
    <span class="pd-title-edit">
        <template v-if="editing">
            <q-input
                ref="nameInput"
                v-model="nameDraft"
                outlined
                dense
                class="pd-title-edit__input"
                :aria-label="msg.header.editNameAria"
                @keydown.enter="commit"
                @keydown.escape="cancel"
                @blur="commit"
            />
            <span class="pd-title-edit__hint">{{ msg.header.nameEditHint }}</span>
        </template>
        <template v-else>
            {{ plan.label }}
            <q-btn
                v-if="editable"
                class="pd-title-edit__btn"
                flat
                dense
                icon="edit"
                size="sm"
                :title="msg.header.editNameTitle"
                :aria-label="msg.header.editNameAria"
                @click="start"
            />
        </template>
    </span>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { PlanRow } from '@saasicat/core';
import { useSaMessages } from '../../../vue/use-super-admin-i18n.js';

// The plan name as the page heading, renameable in place.
//
// It goes into AdminHero's `title` slot rather than carrying a heading of its
// own: the plan detail used to render a second <h1> below the hero's, which
// left the page with two top-level headings and a title block that had to
// restate the hero's type scale to match it. Here the hero owns the element
// and the size; this only fills it.
const props = defineProps<{
    plan: PlanRow;
    /** Renaming a plan is only offered while an unpublished draft exists. */
    editable: boolean;
}>();

const emit = defineEmits<{
    (e: 'updatePlan', patch: { label: string }): void;
}>();

const msg = useSaMessages('planDetail');

const editing = ref(false);
const nameDraft = ref(props.plan.label);
const nameInput = ref<HTMLInputElement | null>(null);

watch(
    () => props.plan.label,
    (label) => {
        if (!editing.value) nameDraft.value = label;
    },
);

function start(): void {
    nameDraft.value = props.plan.label;
    editing.value = true;
    void nextTick(() => nameInput.value?.focus());
}

function commit(): void {
    if (!editing.value) return;
    const next = nameDraft.value.trim();
    editing.value = false;
    if (next && next !== props.plan.label) emit('updatePlan', { label: next });
}

function cancel(): void {
    nameDraft.value = props.plan.label;
    editing.value = false;
}
</script>

<style scoped>
.pd-title-edit {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-3);
}
/* `font: inherit` on purpose: the heading's type comes from the hero, so the
 * input keeps matching it when that changes. */
.pd-title-edit__input {
    font: inherit;
    color: var(--sa-color-fg-heading);
    border: 0;
    background: var(--sa-color-warning-surface);
    outline: 2px solid var(--sa-color-warning-strong);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-control);
    min-width: 220px;
}
.pd-title-edit__hint {
    font-size: var(--sa-text-xs);
    font-weight: 500;
    color: var(--sa-color-warning);
    background: var(--sa-color-warning-surface);
    border: 1px solid var(--sa-color-warning-border);
    border-radius: var(--sa-radius-control);
    padding: var(--sa-space-1) var(--sa-space-3);
}
.pd-title-edit__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--sa-radius-control);
    background: transparent;
    border: 1px solid transparent;
    color: var(--sa-color-fg-subtle);
    cursor: pointer;
    transition:
        background 0.12s,
        color 0.12s,
        border-color 0.12s;
}
.pd-title-edit__btn:hover {
    background: var(--sa-color-border-soft);
    color: var(--sa-color-accent);
    border-color: var(--sa-color-border);
}
</style>
