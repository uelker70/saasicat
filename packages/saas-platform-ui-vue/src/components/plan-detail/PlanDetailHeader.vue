<template>
    <div class="pd-header">
        <div class="pd-header-left">
            <span class="pd-tier-chip">{{ plan.planKey }}</span>
            <div class="pd-header-titles">
                <div class="pd-title-wrap">
                    <template v-if="editingName">
                        <input
                            ref="nameInput"
                            v-model="nameDraft"
                            class="pd-title-input"
                            @keydown.enter="commitName"
                            @keydown.escape="cancelName"
                            @blur="commitName"
                        />
                        <span class="pd-title-hint">Draft · Enter speichert · Esc bricht ab</span>
                    </template>
                    <template v-else>
                        <h1 class="pd-title">{{ plan.label }}</h1>
                        <button
                            v-if="draftVersion"
                            class="pd-title-edit-btn"
                            type="button"
                            title="Plan-Name im Draft bearbeiten"
                            aria-label="Plan-Name bearbeiten"
                            @click="startEditName"
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                            >
                                <path
                                    d="M12 20h9M16.5 3.5a2.12 2.12 0 113 3L7 19l-4 1 1-4 12.5-12.5z"
                                />
                            </svg>
                        </button>
                    </template>
                </div>
                <div class="pd-desc">{{ plan.description || 'Keine Beschreibung.' }}</div>
            </div>
        </div>
        <div class="pd-actions">
            <button class="btn" type="button" @click="$emit('back')">
                <span class="pd-back-arrow" aria-hidden="true">
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                </span>
                <span>Zurück</span>
            </button>
            <button
                v-if="tenantTotal === 0 && !draftVersion && publishedCount === 0"
                class="btn danger"
                type="button"
                title="Plan löschen (nur ohne Mandanten und ohne published Versionen)"
                @click="$emit('deletePlan')"
            >
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path
                        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                    />
                </svg>
                <span>Plan löschen</span>
            </button>
            <button class="btn" type="button" @click="$emit('clonePlan')">
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <rect x="9" y="9" width="11" height="11" rx="2" />
                    <path d="M5 15V5a2 2 0 012-2h10" />
                </svg>
                <span>Plan klonen</span>
            </button>
            <button
                v-if="!draftVersion"
                class="btn primary"
                type="button"
                @click="$emit('createDraft')"
            >
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                >
                    <path d="M12 5v14M5 12h14" />
                </svg>
                <span>Neue Draft-Version</span>
            </button>
            <button
                v-else
                class="btn primary"
                type="button"
                @click="$emit('publish', draftVersion)"
            >
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                <span>Draft v{{ draftVersion.version }} veröffentlichen</span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { PlanRow, PlanVersionRow } from '@saasicat/types';

const props = defineProps<{
    plan: PlanRow;
    draftVersion: PlanVersionRow | null;
    tenantTotal: number;
    publishedCount: number;
}>();

const emit = defineEmits<{
    (e: 'back'): void;
    (e: 'createDraft'): void;
    (e: 'publish', version: PlanVersionRow): void;
    (e: 'clonePlan'): void;
    (e: 'deletePlan'): void;
    (e: 'updatePlan', patch: { label: string }): void;
}>();

const editingName = ref(false);
const nameDraft = ref(props.plan.label);
const nameInput = ref<HTMLInputElement | null>(null);

watch(
    () => props.plan.label,
    (label) => {
        if (!editingName.value) nameDraft.value = label;
    },
);

function startEditName(): void {
    nameDraft.value = props.plan.label;
    editingName.value = true;
    void nextTick(() => nameInput.value?.focus());
}

function commitName(): void {
    if (!editingName.value) return;
    const next = nameDraft.value.trim();
    editingName.value = false;
    if (next && next !== props.plan.label) emit('updatePlan', { label: next });
}

function cancelName(): void {
    nameDraft.value = props.plan.label;
    editingName.value = false;
}
</script>
