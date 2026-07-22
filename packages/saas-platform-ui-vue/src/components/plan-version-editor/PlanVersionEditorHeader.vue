<template>
    <header class="pve-bar">
        <div class="pve-bar-left">
            <div class="pve-titlechip">
                <span class="pve-titlechip-kicker">{{ msg.header.planKicker }}</span>
                <span class="pve-chip pve-chip--plan">{{ planKey }}</span>
            </div>
            <h2 class="pve-title">{{ title }}</h2>
            <span class="pve-chip pve-chip--draft pve-chip--dot">{{ msg.header.draftChip }}</span>
            <span class="pve-bar-note">
                {{ msg.header.supersedeNoteBefore }}
                <code class="pve-mono">{{ predecessorValidUntilHint }}</code>
                {{ msg.header.supersedeNoteAfter }}
            </span>
        </div>
        <div class="pve-bar-right">
            <button
                class="pve-btn"
                type="button"
                :disabled="!hasPredecessor"
                :title="hasPredecessor ? undefined : msg.header.noPredecessorHint"
                @click="$emit('showDiff')"
            >
                <span class="pve-ico" aria-hidden="true">
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                </span>
                <span>{{ msg.header.diffButton }}</span>
            </button>
            <button class="pve-btn" type="button" @click="$emit('cancel')">
                <span class="pve-ico" style="transform: rotate(180deg)" aria-hidden="true">
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
                <span>{{ common.back }}</span>
            </button>
            <button
                class="pve-btn pve-btn--primary"
                type="button"
                :disabled="!canSave"
                @click="$emit('save')"
            >
                <span>{{ msg.header.saveButton }}</span>
                <span class="pve-ico" aria-hidden="true">
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
            </button>
        </div>
    </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

const props = defineProps<{
    planKey: string;
    editingId: string | null;
    version: number;
    predecessorValidUntilHint: string;
    hasPredecessor: boolean;
    canSave: boolean;
}>();

defineEmits<{
    (e: 'showDiff'): void;
    (e: 'cancel'): void;
    (e: 'save'): void;
}>();

const msg = useSaMessages('planEditor');
const common = useSaMessages('common');

const title = computed(() =>
    formatMessage(props.editingId ? msg.value.header.editDraft : msg.value.header.newVersion, {
        version: props.version,
    }),
);
</script>
