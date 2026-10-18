<template>
    <AdminFormDialog
        :model-value="modelValue"
        :title="msg.dialog.title"
        :submit-label="msg.dialog.submit"
        :submit-disabled="!complete"
        :submit="onSubmit"
        :success-message="msg.dialog.done"
        @update:model-value="(open: boolean) => emit('update:modelValue', open)"
    >
        <p class="text-body2">{{ intro }}</p>
        <AdminField :label="msg.dialog.note" :hint="msg.dialog.noteHint" required>
            <q-input
                v-model="note"
                outlined
                dense
                type="textarea"
                autogrow
                counter
                :maxlength="RECONCILIATION_NOTE_MAX_LENGTH"
            />
        </AdminField>
    </AdminFormDialog>
</template>

<script setup lang="ts">
// Closing a case to reconcile: why it is settled, in a note the audit log
// keeps — such as the transfer that evened it out. A note of blanks does not
// count as one.

import { computed, ref, watch } from 'vue';
import { RECONCILIATION_NOTE_MAX_LENGTH, type AdminReconciliationCase } from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import AdminField from '../../ui/page/AdminField.vue';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

const props = defineProps<{
    modelValue: boolean;
    /** The case to close. */
    row: AdminReconciliationCase | null;
    close: (row: AdminReconciliationCase, note: string) => Promise<AdminReconciliationCase | null>;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const msg = useSaMessages('reconciliation');
const { locale } = useSuperAdminI18n();
const note = ref('');

// Reopening starts empty, not from the last attempt.
watch(
    () => props.modelValue,
    (open) => {
        if (open) note.value = '';
    },
    { immediate: true },
);

const intro = computed(() =>
    props.row
        ? formatMessage(msg.value.dialog.intro, {
              kind: msg.value.kinds[props.row.kind],
              amount: formatCurrency(props.row.amount, locale.value, props.row.currency),
              reference: props.row.reference,
          })
        : '',
);

const complete = computed(() => props.row !== null && note.value.trim() !== '');

async function onSubmit(): Promise<AdminReconciliationCase | null> {
    // `complete` has held the row before the button could be pressed.
    if (!props.row) return null;
    return props.close(props.row, note.value.trim());
}
</script>
