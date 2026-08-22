<template>
    <AdminFormDialog
        :model-value="modelValue"
        :title="msg.editDialog.title"
        :subtitle="subtitleText"
        size="lg"
        :submit-label="common.save"
        :submit-disabled="!isValid || !hasChanges"
        :submit="submitForm"
        @update:model-value="emit('update:modelValue', $event)"
        @submitted="emit('updated')"
    >
        <PromoCodeDialogFields
            v-model:advanced-open="advancedOpen"
            v-model:form="form"
            mode="edit"
            :code="row?.code ?? ''"
            :show-campaign-tag="showCampaignTag"
            :plans="plans"
        />
    </AdminFormDialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import PromoCodeDialogFields from './PromoCodeDialogFields.vue';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
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

// The head's second line: which code is being edited, and how far it has been
// used. Composed here rather than in the template because AdminDialog takes a
// subtitle as text — a head that renders markup per dialog is the thing the
// shared chrome exists to prevent.
const subtitleText = computed(() => {
    if (!props.row) return undefined;
    const used = formatMessage(msg.value.editDialog.redemptionsSoFar, {
        count: props.row.redemptionsCount,
    });
    return `${msg.value.form.codeLabel} ${props.row.code} · ${used}`;
});

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
        advancedOpen.value = false;
    },
    { immediate: true },
);

// The dialog owns pending, failure and closing; what is left here is the one
// thing it cannot know — which fields changed. Rejecting is how a failure
// reaches the operator, so nothing is caught.
async function submitForm(): Promise<void> {
    if (!props.row) return;
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
}
</script>
