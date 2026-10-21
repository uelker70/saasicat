<template>
    <section class="q-mt-md" :aria-label="dialog.lines">
        <div class="text-subtitle2">{{ dialog.lines }}</div>
        <p class="text-caption q-mb-sm">{{ dialog.linesCaption }}</p>
        <AdminErrorBanner :error="error" :title="dialog.linesLoadFailed" :retry="retry" />
        <q-linear-progress v-if="pending" indeterminate class="q-mt-sm" />
        <ol v-if="invoice" class="sa-invoice-cancel__lines">
            <li v-for="line in invoice.lines" :key="line.position">
                <div class="sa-invoice-cancel__line">
                    <span>{{ line.position }}. {{ line.title }}</span>
                    <span>{{ money(line.standsAt) }}</span>
                </div>
                <template v-if="line.correctable">
                    <q-btn-toggle
                        :model-value="entryOf(line).choice"
                        :options="choices"
                        no-caps
                        unelevated
                        dense
                        role="group"
                        :aria-label="
                            formatMessage(dialog.lineChoice, {
                                position: line.position,
                                title: line.title,
                            })
                        "
                        @update:model-value="(choice: InvoiceLineChoice) => choose(line, choice)"
                    />
                    <AdminField
                        v-if="entryOf(line).choice === 'part'"
                        :label="dialog.lineAmount"
                        :hint="
                            formatMessage(dialog.lineAmountHint, { standsAt: money(line.standsAt) })
                        "
                        required
                    >
                        <template #default="{ describedBy }">
                            <q-input
                                :model-value="entryOf(line).amount ?? ''"
                                type="number"
                                min="0"
                                step="0.01"
                                outlined
                                dense
                                :aria-describedby="describedBy"
                                @update:model-value="(value) => enter(line, value)"
                            />
                        </template>
                    </AdminField>
                </template>
                <span v-else class="text-caption">{{ whyNot(line) }}</span>
            </li>
        </ol>
    </section>
</template>

<script setup lang="ts">
// The lines of the invoice being cancelled, each with what its charge stands
// at, and a choice at each line the server says the cancellation may correct:
// owed, not owed, or owed in part with the amount still owed (`SC-ADM-035`).
// The others say why they offer none. What is chosen is the dialog's draft;
// this emits each choice rather than writing into it.

import { computed } from 'vue';
import type { AdminInvoice, AdminInvoiceLine } from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import {
    whyNotCorrectable,
    type InvoiceLineChoice,
    type InvoiceLineEntry,
} from '../../client/invoice-cancellation.js';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminField from '../../ui/page/AdminField.vue';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

const props = defineProps<{
    /** The invoice with its lines; `null` while it is read, or where reading it failed. */
    invoice: AdminInvoice | null;
    pending: boolean;
    error: unknown | null;
    retry: () => void | Promise<void>;
    /** What the operator chose so far, by position; a line absent is owed. */
    lines: Partial<Record<number, InvoiceLineEntry>>;
}>();

const emit = defineEmits<{
    /** What the operator now says of the line at `position`. */
    choose: [position: number, entry: InvoiceLineEntry];
}>();

const msg = useSaMessages('tenants');
const { locale } = useSuperAdminI18n();
const dialog = computed(() => msg.value.payments.cancelDialog);

const choices = computed(() => [
    { value: 'owed', label: dialog.value.lineOwed },
    { value: 'not-owed', label: dialog.value.lineNotOwed },
    { value: 'part', label: dialog.value.linePart },
]);

const money = (amount: number) => formatCurrency(amount, locale.value, props.invoice?.currency);

function entryOf(line: AdminInvoiceLine): InvoiceLineEntry {
    return props.lines[line.position] ?? { choice: 'owed', amount: null };
}

function choose(line: AdminInvoiceLine, choice: InvoiceLineChoice): void {
    emit('choose', line.position, { choice, amount: entryOf(line).amount });
}

/** An amount typed as nothing is none entered yet. */
function enter(line: AdminInvoiceLine, value: string | number | null): void {
    const amount = value === null || value === '' ? null : Number(value);
    emit('choose', line.position, {
        choice: 'part',
        amount: amount !== null && Number.isFinite(amount) ? amount : null,
    });
}

function whyNot(line: AdminInvoiceLine): string {
    const why = whyNotCorrectable(line);
    if (why === 'discount') return dialog.value.lineFollows;
    if (why === 'correction') {
        return formatMessage(dialog.value.lineCorrection, {
            position: line.correctsPosition ?? '',
        });
    }
    return dialog.value.lineNothing;
}
</script>

<style scoped>
.sa-invoice-cancel__lines {
    list-style: none;
    margin: var(--sa-space-2) 0 0;
    padding: 0;
    display: grid;
    gap: var(--sa-space-2);
}

.sa-invoice-cancel__line {
    display: flex;
    justify-content: space-between;
    gap: var(--sa-space-3);
}
</style>
