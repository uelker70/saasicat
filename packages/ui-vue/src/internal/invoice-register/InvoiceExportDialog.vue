<template>
    <AdminFormDialog
        :model-value="modelValue"
        :title="msg.exportTitle"
        :subtitle="formatMessage(msg.exportSubtitle, { from, until })"
        :submit-label="msg.exportSubmit"
        :submit-disabled="!valid"
        :submit="() => flow.download(draft)"
        :success-message="msg.exported"
        @update:model-value="(open: boolean) => emit('update:modelValue', open)"
    >
        <AdminField
            :label="msg.exportAsOf"
            :hint="msg.exportAsOfHint"
            :error="valid ? null : msg.exportAsOfInvalid"
        >
            <q-input v-model="draft.asOf" outlined dense type="datetime-local" step="1" />
        </AdminField>
        <AdminField :label="msg.exportLocale">
            <q-btn-toggle
                v-model="draft.locale"
                :options="locales"
                no-caps
                unelevated
                dense
                role="group"
                :aria-label="msg.exportLocale"
            />
        </AdminField>
    </AdminFormDialog>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { INVOICE_EXPORT_LOCALES, type InvoiceExportLocale } from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import AdminField from '../../ui/page/AdminField.vue';
import type { InvoiceExport } from '../../vue/use-invoice-export.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// The export of the months the register shows, as of a moment the operator may
// name on the installation's clock, in the language the tables are written in.
// What a moment is and what is asked for is `useInvoiceExport`'s; this asks.

const props = defineProps<{
    modelValue: boolean;
    flow: InvoiceExport;
    /** The months the register shows, as the export reads them. */
    from: string;
    until: string;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const msg = useSaMessages('invoices');
const draft = reactive(props.flow.draft());
const valid = computed(() => props.flow.isValid(draft));
const locales = computed(() => {
    const labels: Record<InvoiceExportLocale, string> = {
        de: msg.value.exportLocaleDe,
        en: msg.value.exportLocaleEn,
    };
    return INVOICE_EXPORT_LOCALES.map((value) => ({ value, label: labels[value] }));
});

// Each opening starts from five minutes ago, not from the last export's moment.
watch(
    () => props.modelValue,
    (open) => {
        if (open) Object.assign(draft, props.flow.draft());
    },
);
</script>
