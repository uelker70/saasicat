<template>
    <AdminFormDialog
        :model-value="modelValue"
        :title="msg.credits.dialog.title"
        :subtitle="msg.credits.dialog.subtitle"
        :submit-label="msg.credits.dialog.submit"
        :submit-disabled="!payout"
        :submit="onSubmit"
        @update:model-value="(open: boolean) => emit('update:modelValue', open)"
    >
        <AdminField :label="msg.credits.dialog.amount" :hint="openLine" required>
            <q-input
                v-model.number="draft.amount"
                outlined
                dense
                type="number"
                min="0.01"
                step="0.01"
                :max="credit?.open"
            />
        </AdminField>
        <AdminField
            :label="msg.credits.dialog.reference"
            :hint="msg.credits.dialog.referenceHint"
            required
        >
            <q-input
                v-model="draft.reference"
                outlined
                dense
                counter
                :maxlength="PAYOUT_REFERENCE_MAX_LENGTH"
            />
        </AdminField>
        <AdminField :label="msg.credits.dialog.paidOn" required>
            <q-input v-model="draft.paidOn" outlined dense type="date" :max="today" />
        </AdminField>
        <AdminField :label="msg.credits.dialog.note">
            <q-input
                v-model="draft.note"
                outlined
                dense
                type="textarea"
                autogrow
                counter
                :maxlength="PAYOUT_NOTE_MAX_LENGTH"
            />
        </AdminField>
    </AdminFormDialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type { AdminSubscriberCredit, AdminSubscriberPayout, CalendarDay } from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import AdminField from '../../ui/page/AdminField.vue';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import {
    PAYOUT_NOTE_MAX_LENGTH,
    PAYOUT_REFERENCE_MAX_LENGTH,
    payoutOf,
    type PayoutForm,
} from './subscriber-payout.js';

// A payout the operator made outside the gateway against one credit: the
// amount, at most what is open, the transfer's reference and the day it left.
// It opens with what is open and today, the case of paying a credit out whole.

const props = defineProps<{
    modelValue: boolean;
    credit: AdminSubscriberCredit | null;
    /** The day the dialog opens on, which no payout can lie after. */
    today: CalendarDay;
    /** The write, as the credits composable runs it behind the second factor. */
    submit: (payout: AdminSubscriberPayout) => Promise<unknown>;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', open: boolean): void }>();

const msg = useSaMessages('tenants');
const { locale } = useSuperAdminI18n();

const draft = reactive<PayoutForm>({ amount: null, reference: '', paidOn: '', note: '' });

watch(
    () => props.modelValue,
    (open) => {
        if (!open) return;
        draft.amount = props.credit?.open ?? null;
        draft.reference = '';
        draft.paidOn = props.today;
        draft.note = '';
    },
    { immediate: true },
);

const openLine = computed(() =>
    props.credit
        ? formatMessage(msg.value.credits.dialog.amountHint, {
              amount: formatCurrency(props.credit.open, locale.value, props.credit.currency),
          })
        : '',
);

const payout = computed(() => (props.credit ? payoutOf(draft, props.credit.open) : null));

function onSubmit(): Promise<unknown> {
    return payout.value ? props.submit(payout.value) : Promise.resolve(null);
}
</script>
