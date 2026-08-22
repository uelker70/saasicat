<template>
    <div class="sa-row-actions">
        <q-btn
            v-for="action in visible"
            :key="action.key"
            flat
            dense
            no-caps
            size="sm"
            :icon="action.icon"
            :label="action.label"
            :disable="action.disabled"
            :class="action.tone === 'danger' ? 'sa-row-actions__danger' : undefined"
            :aria-label="action.icon && !action.label ? action.label : undefined"
            @click="emit('action', action.key)"
        />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

/** One entry in a row's action set. */
export interface AdminRowAction {
    /** Identifies the action in the `action` event. */
    key: string;
    label: string;
    icon?: string;
    /** `danger` marks the ones that destroy or revoke. */
    tone?: 'default' | 'danger';
    disabled?: boolean;
    /** Not rendered at all — for actions a row is not eligible for. */
    hidden?: boolean;
}

// The per-row controls in `AdminTable`'s `#row-actions` slot. That slot had
// three different shapes across the pages: icon-only buttons, labelled ones,
// and a dropdown — which meant the same operation looked like three operations
// depending on where you met it.
//
// `hidden` rather than filtering at the call site, because "this row cannot be
// deleted" is a property of the row that the page already knows, and computing
// a different array per row is how a table gains a `v-if` per button.
const props = defineProps<{ actions: readonly AdminRowAction[] }>();

const emit = defineEmits<{ (e: 'action', key: string): void }>();

const visible = computed(() => props.actions.filter((action) => !action.hidden));
</script>
