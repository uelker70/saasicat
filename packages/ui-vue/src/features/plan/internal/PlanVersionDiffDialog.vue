<template>
    <AdminDialog
        :model-value="modelValue"
        :title="titleText"
        :subtitle="msg.diffDialog.subtitle"
        size="lg"
        @update:model-value="$emit('update:modelValue', $event)"
    >
        <div>
            <div
                v-for="d in diffRows"
                :key="d.id"
                class="pve-diff-row"
                :style="{ background: d.bg, borderColor: d.border }"
            >
                <span class="pve-diff-sign" :style="{ background: d.color }">{{ d.sign }}</span>
                <div class="pve-diff-main">
                    <div class="pve-diff-headline">
                        <span class="pve-diff-section" :style="{ color: d.color }">{{
                            d.section
                        }}</span>
                        <span class="pve-diff-label">{{ d.label }}</span>
                        <code v-if="d.sub" class="pve-mono pve-mono--xs">{{ d.sub }}</code>
                    </div>
                    <div v-if="d.from !== undefined" class="pve-diff-change">
                        <span class="pve-diff-from">{{ d.from }}</span>
                        <span class="pve-diff-arrow" :style="{ color: d.color }">→</span>
                        <span class="pve-diff-to">{{ d.to }}</span>
                    </div>
                </div>
                <span
                    class="pve-chip pve-diff-tag"
                    :style="{ color: d.color, borderColor: d.border }"
                    >{{ d.tag }}</span
                >
            </div>
            <AdminEmptyState v-if="diffRows.length === 0" :title="msg.diffDialog.empty" />
        </div>
    </AdminDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSaMessages } from '../../../vue/use-super-admin-i18n.js';
import AdminDialog from '../../../ui/overlay/AdminDialog.vue';
import AdminEmptyState from '../../../ui/feedback/AdminEmptyState.vue';
import type { EditorDiffRow, PredecessorVersion } from './plan-version-editor.types.js';

const props = defineProps<{
    modelValue: boolean;
    predecessorVersion: PredecessorVersion | null;
    version: number;
    diffRows: EditorDiffRow[];
}>();

defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
}>();

const msg = useSaMessages('planEditor');

// Which two versions are being compared, as one line — AdminDialog takes a
// title as text, and the head is no longer this component's to draw.
const titleText = computed(() =>
    props.predecessorVersion
        ? `${msg.value.diffDialog.title} v${props.predecessorVersion.version} → v${props.version}`
        : msg.value.diffDialog.title,
);
</script>
