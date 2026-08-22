<template>
    <AdminHero :title="title">
        <template #before-title>
            <span class="pve-kicker">
                {{ msg.header.planKicker }}
                <span class="pve-chip pve-chip--plan">{{ planKey }}</span>
            </span>
        </template>
        <template #subtitle>
            <span class="pve-chip pve-chip--draft pve-chip--dot">{{ msg.header.draftChip }}</span>
            {{ msg.header.supersedeNoteBefore }}
            <code class="pve-mono">{{ predecessorValidUntilHint }}</code>
            {{ msg.header.supersedeNoteAfter }}
        </template>
        <template #actions>
            <button
                class="sa-btn"
                type="button"
                :disabled="!hasPredecessor"
                :title="hasPredecessor ? undefined : msg.header.noPredecessorHint"
                @click="$emit('showDiff')"
            >
                <q-icon name="visibility" size="16px" />
                <span>{{ msg.header.diffButton }}</span>
            </button>
            <button class="sa-btn" type="button" @click="$emit('cancel')">
                <q-icon name="arrow_back" size="16px" />
                <span>{{ common.back }}</span>
            </button>
            <button
                class="sa-btn sa-btn--primary"
                type="button"
                :disabled="!canSave"
                @click="$emit('save')"
            >
                <span>{{ msg.header.saveButton }}</span>
                <q-icon name="arrow_forward" size="16px" />
            </button>
        </template>
    </AdminHero>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatMessage } from '../../../client/i18n/format.js';
import { useSaMessages } from '../../../vue/use-super-admin-i18n.js';
// The editor takes over the page hero while it is open: its actions depend on
// the draft's validity and on the diff dialog, both of which live in this view.
import AdminHero from '../../../ui/page/AdminHero.vue';

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
