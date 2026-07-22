<template>
    <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)">
        <div class="pve-diff-modal" role="dialog" aria-labelledby="pve-diff-title">
            <div class="pve-diff-head">
                <div>
                    <div id="pve-diff-title" class="pve-diff-title">
                        {{ msg.diffDialog.title }}
                        <template v-if="predecessorVersion">
                            v{{ predecessorVersion.version }} → v{{ version }}
                        </template>
                    </div>
                    <div class="pve-diff-sub">{{ msg.diffDialog.subtitle }}</div>
                </div>
                <button
                    class="pve-diff-close"
                    type="button"
                    :aria-label="common.close"
                    @click="$emit('update:modelValue', false)"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>
            <div class="pve-diff-body">
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
                <div v-if="diffRows.length === 0" class="pve-diff-empty">
                    {{ msg.diffDialog.empty }}
                </div>
            </div>
        </div>
    </q-dialog>
</template>

<script setup lang="ts">
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { EditorDiffRow, PredecessorVersion } from './types.js';

defineProps<{
    modelValue: boolean;
    predecessorVersion: PredecessorVersion | null;
    version: number;
    diffRows: EditorDiffRow[];
}>();

defineEmits<{
    (e: 'update:modelValue', value: boolean): void;
}>();

const msg = useSaMessages('planEditor');
const common = useSaMessages('common');
</script>
