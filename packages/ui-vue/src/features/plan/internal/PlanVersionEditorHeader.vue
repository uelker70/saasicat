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
            <q-btn
                flat
                no-caps
                icon="visibility"
                :label="msg.header.diffButton"
                :disable="!hasPredecessor"
                :title="hasPredecessor ? undefined : msg.header.noPredecessorHint"
                @click="$emit('showDiff')"
            />
            <q-btn flat no-caps icon="arrow_back" :label="common.back" @click="$emit('cancel')" />
            <q-btn
                unelevated
                no-caps
                color="primary"
                icon="arrow_forward"
                :label="msg.header.saveButton"
                :disable="!canSave"
                @click="$emit('save')"
            />
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
