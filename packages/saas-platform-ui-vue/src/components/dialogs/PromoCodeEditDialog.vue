<template>
    <q-dialog
        :model-value="modelValue"
        @update:model-value="emit('update:modelValue', $event)"
        persistent
    >
        <q-card class="pc-dlg">
            <q-card-section class="pc-dlg__head">
                <div>
                    <div class="pc-dlg__title">{{ msg.editDialog.title }}</div>
                    <div class="pc-dlg__sub" v-if="row">
                        {{ msg.form.codeLabel }} <strong>{{ row.code }}</strong> ·
                        {{
                            formatMessage(msg.editDialog.redemptionsSoFar, {
                                count: row.redemptionsCount,
                            })
                        }}
                    </div>
                </div>
                <q-btn
                    class="pc-dlg__close"
                    flat
                    dense
                    round
                    icon="close"
                    v-close-popup
                    :disable="loading"
                />
            </q-card-section>

            <q-card-section class="pc-dlg__body">
                <PromoCodeDialogFields
                    mode="edit"
                    :form="form"
                    :code="row?.code ?? ''"
                    v-model:advanced-open="advancedOpen"
                    :show-campaign-tag="showCampaignTag"
                    :plans="plans"
                />

                <p v-if="error" class="pc-error">{{ error }}</p>
            </q-card-section>

            <q-card-actions align="right" class="pc-dlg__foot">
                <q-btn flat :label="common.cancel" v-close-popup :disable="loading" />
                <q-btn
                    unelevated
                    color="primary"
                    :label="common.save"
                    :loading="loading"
                    :disable="!isValid || !hasChanges"
                    @click="onSubmit"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import PromoCodeDialogFields from './PromoCodeDialogFields.vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type {
    PromoCodeDurationType,
    PromoCodePlanOption,
    PromoCodeUpdatePayload,
    PromoCodeValueType,
} from './types.js';

// Platform PromoCode edit dialog. Layout identical to PromoCodeCreateDialog
// (sections, type grid, plan picker), only `code` is disabled — the code
// stays stable after creation, because already-issued codes would otherwise
// no longer be traceable. All other fields can be maintained afterwards;
// existing redemptions are frozen via `appliedValue` snapshots and remain
// untouched by changes.

export interface PromoCodeEditRow {
    id: string;
    code: string;
    status: 'ACTIVE' | 'PAUSED' | 'EXHAUSTED' | 'EXPIRED' | string;
    valueType?: PromoCodeValueType;
    value?: number;
    durationType?: PromoCodeDurationType;
    durationValue?: number | null;
    validFrom?: string | null;
    validUntil: string | null;
    maxRedemptions: number | null;
    redemptionsCount: number;
    appliesToPlans?: string[];
    appliesToBilling?: 'MONTHLY' | 'YEARLY' | null;
    firstTimeCustomersOnly?: boolean;
    minimumPlanAmountGross?: number | null;
    allowZeroInvoice?: boolean;
    campaignTag?: string | null;
    revenueDeductionAccount?: string | null;
    description?: string | null;
}

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        row: PromoCodeEditRow | null;
        showCampaignTag?: boolean;
        plans?: readonly PromoCodePlanOption[];
        submit: (id: string, payload: PromoCodeUpdatePayload) => Promise<void>;
    }>(),
    {
        showCampaignTag: true,
        plans: () => [],
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'updated'): void;
}>();

const msg = useSaMessages('promos');
const common = useSaMessages('common');

interface EditForm {
    status: 'ACTIVE' | 'PAUSED';
    valueType: PromoCodeValueType;
    value: number;
    durationType: PromoCodeDurationType;
    durationValue: number | null;
    maxRedemptions: number | null;
    validFrom: string;
    validUntil: string;
    appliesToPlans: string[];
    appliesToBilling: 'MONTHLY' | 'YEARLY' | null;
    firstTimeCustomersOnly: boolean;
    minimumPlanAmountGross: number | null;
    allowZeroInvoice: boolean;
    campaignTag: string;
    revenueDeductionAccount: string;
    description: string;
}

function emptyForm(): EditForm {
    return {
        status: 'ACTIVE',
        valueType: 'PERCENT',
        value: 0,
        durationType: 'ONCE',
        durationValue: null,
        maxRedemptions: null,
        validFrom: '',
        validUntil: '',
        appliesToPlans: [],
        appliesToBilling: null,
        firstTimeCustomersOnly: false,
        minimumPlanAmountGross: null,
        allowZeroInvoice: false,
        campaignTag: '',
        revenueDeductionAccount: '',
        description: '',
    };
}

function fromRow(row: PromoCodeEditRow): EditForm {
    return {
        status: row.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
        valueType: row.valueType ?? 'PERCENT',
        value: row.value ?? 0,
        durationType: row.durationType ?? 'ONCE',
        durationValue: row.durationValue ?? null,
        maxRedemptions: row.maxRedemptions,
        validFrom: row.validFrom ? row.validFrom.slice(0, 10) : '',
        validUntil: row.validUntil ? row.validUntil.slice(0, 10) : '',
        appliesToPlans: row.appliesToPlans ? [...row.appliesToPlans] : [],
        appliesToBilling: row.appliesToBilling ?? null,
        firstTimeCustomersOnly: row.firstTimeCustomersOnly ?? false,
        minimumPlanAmountGross: row.minimumPlanAmountGross ?? null,
        allowZeroInvoice: row.allowZeroInvoice ?? false,
        campaignTag: row.campaignTag ?? '',
        revenueDeductionAccount: row.revenueDeductionAccount ?? '',
        description: row.description ?? '',
    };
}

const form = reactive<EditForm>(emptyForm());
const initial = ref<EditForm>(emptyForm());
const loading = ref(false);
const error = ref('');
const advancedOpen = ref(false);

const isValid = computed(() => {
    if (!form.value || form.value <= 0) return false;
    if (form.valueType === 'PERCENT' && form.value > 100) return false;
    if (form.durationType !== 'ONCE' && (!form.durationValue || form.durationValue < 1))
        return false;
    return true;
});

function plansEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((k, i) => k === sortedB[i]);
}

const hasChanges = computed(() => {
    const i = initial.value;
    return (
        form.status !== i.status ||
        form.valueType !== i.valueType ||
        form.value !== i.value ||
        form.durationType !== i.durationType ||
        form.durationValue !== i.durationValue ||
        form.maxRedemptions !== i.maxRedemptions ||
        form.validFrom !== i.validFrom ||
        form.validUntil !== i.validUntil ||
        form.appliesToBilling !== i.appliesToBilling ||
        form.firstTimeCustomersOnly !== i.firstTimeCustomersOnly ||
        form.minimumPlanAmountGross !== i.minimumPlanAmountGross ||
        form.allowZeroInvoice !== i.allowZeroInvoice ||
        !plansEqual(form.appliesToPlans, i.appliesToPlans) ||
        (form.campaignTag ?? '') !== (i.campaignTag ?? '') ||
        (form.revenueDeductionAccount ?? '') !== (i.revenueDeductionAccount ?? '') ||
        (form.description ?? '') !== (i.description ?? '')
    );
});

watch(
    () => [props.modelValue, props.row] as const,
    ([open, row]) => {
        if (!open) return;
        const next = row ? fromRow(row) : emptyForm();
        Object.assign(form, next);
        initial.value = { ...next, appliesToPlans: [...next.appliesToPlans] };
        error.value = '';
        advancedOpen.value = false;
    },
    { immediate: true },
);

async function onSubmit() {
    if (!props.row || !hasChanges.value || !isValid.value) return;
    loading.value = true;
    error.value = '';
    try {
        const i = initial.value;
        const payload: PromoCodeUpdatePayload = {};
        if (form.status !== i.status) payload.status = form.status;
        if (form.valueType !== i.valueType) payload.valueType = form.valueType;
        if (form.value !== i.value) payload.value = form.value;
        if (form.durationType !== i.durationType) payload.durationType = form.durationType;
        if (form.durationValue !== i.durationValue)
            payload.durationValue = form.durationType === 'ONCE' ? null : form.durationValue;
        if (form.maxRedemptions !== i.maxRedemptions)
            payload.maxRedemptions = form.maxRedemptions ?? null;
        if (form.validFrom !== i.validFrom) payload.validFrom = form.validFrom || null;
        if (form.validUntil !== i.validUntil) payload.validUntil = form.validUntil || null;
        if (!plansEqual(form.appliesToPlans, i.appliesToPlans))
            payload.appliesToPlans = [...form.appliesToPlans];
        if (form.appliesToBilling !== i.appliesToBilling)
            payload.appliesToBilling = form.appliesToBilling;
        if (form.firstTimeCustomersOnly !== i.firstTimeCustomersOnly)
            payload.firstTimeCustomersOnly = form.firstTimeCustomersOnly;
        if (form.minimumPlanAmountGross !== i.minimumPlanAmountGross)
            payload.minimumPlanAmountGross = form.minimumPlanAmountGross ?? null;
        if (form.allowZeroInvoice !== i.allowZeroInvoice)
            payload.allowZeroInvoice = form.allowZeroInvoice;
        if ((form.campaignTag ?? '') !== (i.campaignTag ?? ''))
            payload.campaignTag = form.campaignTag || null;
        if ((form.revenueDeductionAccount ?? '') !== (i.revenueDeductionAccount ?? ''))
            payload.revenueDeductionAccount = form.revenueDeductionAccount || null;
        if ((form.description ?? '') !== (i.description ?? ''))
            payload.description = form.description || null;
        await props.submit(props.row.id, payload);
        emit('updated');
        emit('update:modelValue', false);
    } catch (err) {
        error.value =
            (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
            (err as Error).message ??
            common.value.errorSaveFailed;
    } finally {
        loading.value = false;
    }
}
</script>

<style scoped>
.pc-dlg {
    min-width: 720px;
    max-width: 96vw;
}

.pc-dlg__head {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding-bottom: 8px;
}

.pc-dlg__close {
    margin-left: auto;
}

.pc-dlg__title {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 18px;
    color: var(--sa-heading, #0f172a);
}

.pc-dlg__sub {
    font-size: 12.5px;
    color: var(--sa-muted, #64748b);
    margin-top: 2px;
}

.pc-dlg__body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-top: 4px;
}

.pc-dlg__foot {
    border-top: 1px solid var(--sa-border, #e2e8f0);
}

.pc-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #b91c1c;
    font-size: 13px;
    margin: 8px 0 0;
    padding: 8px 12px;
    border-radius: 8px;
}

/* Der Code ist nach dem Anlegen nicht mehr aenderbar. */
.pc-input:disabled {
    background: #f8fafc;
    color: #64748b;
    cursor: not-allowed;
}
</style>
