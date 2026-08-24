<template>
    <q-btn
        flat
        dense
        class="sa-btn--icon"
        :loading="loading"
        :aria-label="label ?? common.reload"
        @click="emit('refresh')"
    >
        <q-icon name="refresh" size="16px" />
        <template #loading>
            <q-spinner size="16px" />
        </template>
    </q-btn>
</template>

<script setup lang="ts">
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// The reload control in a hero or a section head. Icon only, always the last
// action in its row.
//
// Seven pages wrote it by hand and no two agreed: three showed no progress at
// all, one disabled itself without a spinner so the page looked stuck, one had
// no accessible name whatsoever — an icon-only button that a screen reader
// announced as nothing — and the label came from three different message keys
// for the same word.
//
// `loading` drives both the spinner and the disabled state, so a page cannot
// have one without the other.
defineProps<{
    loading?: boolean;
    /** Accessible name. Defaults to the shared "reload" string. */
    label?: string;
}>();

const emit = defineEmits<{
    (e: 'refresh'): void;
}>();

const common = useSaMessages('common');
</script>
