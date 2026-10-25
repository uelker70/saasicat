<template>
    <AdminFormDialog
        :model-value="invoice !== null"
        :title="formatMessage(texts.cancelInvoice, { number: invoice?.number ?? '' })"
        :subtitle="plan ? dialog.previewSubtitle : dialog.askSubtitle"
        :submit-label="plan ? dialog.submit : dialog.preview"
        :submit-disabled="!plan && !isAskable(draft)"
        :submit="plan ? flow.cancel : () => flow.ask(draft)"
        @update:model-value="(open: boolean) => !open && flow.close()"
    >
        <template v-if="!plan">
            <AdminField :label="dialog.reason" :hint="dialog.reasonHint" required>
                <template #default="{ describedBy }">
                    <q-input
                        v-model="draft.reason"
                        outlined
                        dense
                        autofocus
                        counter
                        :maxlength="INVOICE_CANCELLATION_REASON_MAX_LENGTH"
                        :aria-describedby="describedBy"
                    />
                </template>
            </AdminField>
            <InvoiceCancellationLines
                :invoice="flow.invoice.data.value"
                :pending="flow.invoice.pending.value"
                :error="flow.invoice.error.value"
                :retry="flow.invoice.reload"
                :lines="draft.lines"
                @choose="choose"
            />
            <AdminField :label="dialog.deliverTo" :hint="dialog.deliverToHint">
                <template #default="{ describedBy }">
                    <q-input
                        v-model="draft.deliverTo"
                        outlined
                        dense
                        type="email"
                        :maxlength="ADDRESS_MAX_LENGTH"
                        :aria-describedby="describedBy"
                    />
                </template>
            </AdminField>
            <AdminAccordion v-model:open="correcting" class="q-mt-sm">
                <template #header>{{ dialog.corrections }}</template>
                <p class="text-caption q-mb-sm">{{ dialog.correctionsCaption }}</p>
                <AdminFieldGrid :columns="2">
                    <AdminField
                        v-for="detail in INVOICE_SUBSCRIBER_DETAILS"
                        :key="detail"
                        :label="labelOf(detail)"
                        :hint="hintOf(detail)"
                    >
                        <template #default="{ describedBy }">
                            <q-input
                                :model-value="draft.corrections[detail] ?? ''"
                                outlined
                                dense
                                :maxlength="INVOICE_CORRECTION_MAX_LENGTH"
                                :aria-describedby="describedBy"
                                @update:model-value="(value) => correct(detail, value)"
                            />
                            <q-btn
                                v-if="offersRecord(detail)"
                                flat
                                dense
                                no-caps
                                size="sm"
                                :label="dialog.takeOver"
                                :aria-label="
                                    formatMessage(dialog.takeOverLabel, { detail: labelOf(detail) })
                                "
                                @click="takeOver(detail)"
                            />
                        </template>
                    </AdminField>
                </AdminFieldGrid>
            </AdminAccordion>
        </template>

        <template v-else>
            <q-btn flat dense no-caps icon="arrow_back" :label="dialog.back" @click="flow.back()" />
            <dl class="sa-invoice-cancel__figures">
                <dt>{{ dialog.cancellationInvoice }}</dt>
                <dd>{{ money(plan.cancellation.totalGross) }}</dd>
                <dt>{{ dialog.replacement }}</dt>
                <dd v-if="!plan.replacement">{{ dialog.noReplacement }}</dd>
                <dd v-else>
                    {{
                        formatMessage(dialog.amounts, {
                            net: money(plan.replacement.totalNet),
                            tax: money(plan.replacement.totalTax),
                            gross: money(plan.replacement.totalGross),
                        })
                    }}
                    <br />
                    {{
                        formatMessage(dialog.dates, {
                            issued: day(plan.replacement.issueDate),
                            due: day(plan.replacement.dueDate),
                        })
                    }}
                </dd>
                <template v-if="plan.replacement">
                    <dt>{{ dialog.tax }}</dt>
                    <dd>{{ treatment }}</dd>
                </template>
                <dt>{{ dialog.movedIn }}</dt>
                <dd>{{ money(plan.movedIn) }}</dd>
                <template v-if="plan.credited > 0">
                    <dt>{{ dialog.credited }}</dt>
                    <dd>{{ money(plan.credited) }}</dd>
                </template>
                <dt>{{ dialog.reason }}</dt>
                <dd>{{ plan.reason }}</dd>
                <dt>{{ dialog.deliveredTo }}</dt>
                <dd>{{ plan.deliverTo ?? dialog.toRecord }}</dd>
            </dl>
            <section v-if="movedLines.length > 0" class="q-mt-md" :aria-label="dialog.movedLines">
                <div class="text-subtitle2">{{ dialog.movedLines }}</div>
                <dl class="sa-invoice-cancel__figures">
                    <template v-for="line in movedLines" :key="line.position">
                        <dt>{{ line.label }}</dt>
                        <dd>
                            {{
                                formatMessage(dialog.movedLine, {
                                    from: money(line.standsAt),
                                    to: money(line.becomes),
                                })
                            }}
                        </dd>
                    </template>
                </dl>
            </section>
            <section v-if="plan.replacement" class="q-mt-md" :aria-label="dialog.replacementLines">
                <div class="text-subtitle2">{{ dialog.replacementLines }}</div>
                <dl class="sa-invoice-cancel__figures">
                    <template v-for="line in plan.replacement.lines" :key="line.position">
                        <dt>{{ line.position }}. {{ line.title }}</dt>
                        <dd>{{ replacementLineText(line) }}</dd>
                    </template>
                </dl>
            </section>
            <section v-if="plan.replacement" class="q-mt-md" :aria-label="dialog.party">
                <div class="text-subtitle2">{{ dialog.party }}</div>
                <dl class="sa-invoice-cancel__figures">
                    <template v-for="line in partyLines" :key="line.detail">
                        <dt>{{ line.label }}</dt>
                        <dd>{{ line.text }}</dd>
                    </template>
                </dl>
            </section>
        </template>
    </AdminFormDialog>
</template>

<script setup lang="ts">
// Cancelling an invoice in two steps: what the operator gives — the reason,
// what of each line is still owed, an address to deliver to and the details
// the replacement is to name corrected — and what the server says the
// cancellation will write, its lines among it, which is what the second
// factor confirms. The flow is the page's composable; this
// draws it and holds what is typed until the dialog opens on another invoice.

import { computed, reactive, ref, watch } from 'vue';
import {
    INVOICE_CANCELLATION_REASON_MAX_LENGTH,
    INVOICE_CORRECTION_MAX_LENGTH,
    INVOICE_SUBSCRIBER_DETAILS,
    type AdminReplacementLine,
    type AdminSubscriberDetails,
    type InvoiceSubscriberDetail,
} from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatDay, formatMessage } from '../../client/i18n/format.js';
import {
    emptyCancellationDraft,
    isAskable,
    type InvoiceLineEntry,
} from '../../client/invoice-cancellation.js';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import AdminAccordion from '../../ui/page/AdminAccordion.vue';
import AdminField from '../../ui/page/AdminField.vue';
import AdminFieldGrid from '../../ui/page/AdminFieldGrid.vue';
import type { InvoiceCancellationFlow } from '../../vue/use-invoice-cancellation.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import InvoiceCancellationLines from './InvoiceCancellationLines.vue';

/** RFC 5321 caps an address at 254 characters, as the route does. */
const ADDRESS_MAX_LENGTH = 254;

const props = defineProps<{
    flow: InvoiceCancellationFlow;
    /** The subscriber's record, whose values the corrections offer; `null` where it is not served. */
    record: AdminSubscriberDetails | null;
}>();

const msg = useSaMessages('subscribers');
const { locale, intlLocale } = useSuperAdminI18n();

const texts = computed(() => msg.value.payments);
const dialog = computed(() => msg.value.payments.cancelDialog);
const invoice = computed(() => props.flow.target.value);
const plan = computed(() => props.flow.preview.value);

const draft = reactive(emptyCancellationDraft());
/** Whether the replacement's details are open; closed again for each invoice. */
const correcting = ref(false);
watch(
    () => props.flow.target.value?.id,
    () => {
        Object.assign(draft, emptyCancellationDraft());
        correcting.value = false;
    },
);

function labelOf(detail: InvoiceSubscriberDetail): string {
    const m = msg.value.subscriber;
    if (detail === 'legalName') return m.legalName;
    if (detail === 'vatId') return m.vatId;
    if (detail === 'taxNumber') return m.taxNumber;
    return m.field[detail];
}

/** What the record holds for `detail`; `undefined` where no record is served. */
function recordOf(detail: InvoiceSubscriberDetail): string | null | undefined {
    return props.record ? props.record[detail] : undefined;
}

function hintOf(detail: InvoiceSubscriberDetail): string | undefined {
    if (draft.corrections[detail] === null) return dialog.value.cleared;
    const held = recordOf(detail);
    if (held === undefined) return undefined;
    return held === null
        ? dialog.value.onRecordEmpty
        : formatMessage(dialog.value.onRecord, { value: held });
}

function offersRecord(detail: InvoiceSubscriberDetail): boolean {
    const held = recordOf(detail);
    return held !== undefined && draft.corrections[detail] !== held;
}

function takeOver(detail: InvoiceSubscriberDetail): void {
    const held = recordOf(detail);
    if (held !== undefined) draft.corrections[detail] = held;
}

function choose(position: number, entry: InvoiceLineEntry): void {
    draft.lines[position] = entry;
}

/** A detail typed as nothing stays as the invoice names it. */
function correct(detail: InvoiceSubscriberDetail, value: string | number | null): void {
    const text = value === null ? '' : String(value);
    if (text === '') delete draft.corrections[detail];
    else draft.corrections[detail] = text;
}

const money = (amount: number) =>
    formatCurrency(amount, locale.value, plan.value?.cancelled.currency);
const day = (iso: string) => formatDay(iso, intlLocale.value);

/** Each line of the cancelled invoice that moves, named as the invoice read names it. */
const movedLines = computed(() =>
    (plan.value?.lines ?? [])
        .filter((line) => line.becomes !== line.standsAt)
        .map((line) => {
            const title = props.flow.invoice.data.value?.lines.find(
                (each) => each.position === line.position,
            )?.title;
            return { ...line, label: title ? `${line.position}. ${title}` : `${line.position}.` };
        }),
);

/** A line of the replacement: its amount, and the line it corrects where it is a correction's. */
function replacementLineText(line: AdminReplacementLine): string {
    const amount = money(line.amountNet);
    if (line.correctsPosition === null) return amount;
    const corrects = formatMessage(dialog.value.lineCorrection, {
        position: line.correctsPosition,
    });
    return `${amount} · ${corrects}`;
}

const treatment = computed(() => {
    const decided = plan.value?.replacement?.taxTreatment;
    if (!decided) return '';
    return formatMessage(dialog.value.taxTreatment[decided.kind], { rate: decided.rate });
});

/** The replacement's subscriber, detail by detail, each one it names otherwise marked. */
const partyLines = computed(() => {
    const shown = plan.value;
    const replacement = shown?.replacement;
    if (!shown || !replacement) return [];
    const none = dialog.value.none;
    return INVOICE_SUBSCRIBER_DETAILS.map((detail) => {
        const value = replacement.subscriber[detail] ?? none;
        const previous = shown.cancelled.subscriber[detail] ?? none;
        return {
            detail,
            label: labelOf(detail),
            text:
                value === previous
                    ? value
                    : formatMessage(dialog.value.changed, { value, previous }),
        };
    });
});
</script>

<style scoped>
.sa-invoice-cancel__figures {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--sa-space-1) var(--sa-space-3);
    margin: var(--sa-space-2) 0 0;
}

.sa-invoice-cancel__figures dd {
    margin: 0;
}
</style>
