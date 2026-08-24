<template>
    <AdminFormDialog
        :model-value="modelValue"
        :title="msg.createDialog.title"
        :subtitle="subtitle ?? msg.createDialog.subtitle"
        size="lg"
        :submit-label="common.create"
        :submit-disabled="!isValid"
        :submit="submitForm"
        @update:model-value="emit('update:modelValue', $event)"
        @submitted="emit('created')"
    >
        <PromoCodeDialogFields
            v-model:code="form.code"
            v-model:advanced-open="advancedOpen"
            v-model:form="form"
            mode="create"
            :show-campaign-tag="showCampaignTag"
            :plans="plans"
        />
    </AdminFormDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import AdminFormDialog from '../../ui/overlay/AdminFormDialog.vue';
import PromoCodeDialogFields from './PromoCodeDialogFields.vue';
import type {
    PromoCodeCreatePayload,
    PromoCodeDurationType,
    PromoCodePlanOption,
    PromoCodeValueType,
} from './types.js';

// Platform promo-code create dialog. The form body — sections, type grid, plan
// picker, live preview — is shared with the edit dialog through
// PromoCodeDialogFields; what stays here is the create-specific state and the
// payload the app's submit handler receives.

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        subtitle?: string;
        showCampaignTag?: boolean;
        plans?: readonly PromoCodePlanOption[];
        submit: (payload: PromoCodeCreatePayload) => Promise<void>;
    }>(),
    {
        showCampaignTag: true,
        plans: () => [],
    },
);

const emit = defineEmits<{
    (e: 'update:modelValue', v: boolean): void;
    (e: 'created'): void;
}>();

const msg = useSaMessages('promos');
const common = useSaMessages('common');

function emptyForm() {
    return {
        code: '',
        valueType: 'PERCENT' as PromoCodeValueType,
        value: 25 as number,
        durationType: 'BILLING_CYCLES' as PromoCodeDurationType,
        durationValue: 1 as number | null,
        maxRedemptions: null as number | null,
        validFrom: '' as string,
        validUntil: '' as string,
        appliesToPlans: [] as string[],
        appliesToBilling: undefined as 'MONTHLY' | 'YEARLY' | undefined,
        firstTimeCustomersOnly: false,
        minimumPlanAmountGross: null as number | null,
        allowZeroInvoice: false,
        revenueDeductionAccount: '',
        campaignTag: '',
        description: '',
    };
}

const form = ref(emptyForm());
const advancedOpen = ref(false);

const isValid = computed(() => {
    if (!/^[A-Z0-9_-]{3,32}$/.test(form.value.code)) return false;
    if (!form.value.value || form.value.value <= 0) return false;
    if (form.value.valueType === 'PERCENT' && form.value.value > 100) return false;
    if (
        form.value.durationType !== 'ONCE' &&
        (!form.value.durationValue || form.value.durationValue < 1)
    )
        return false;
    return true;
});

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            form.value = emptyForm();
            advancedOpen.value = false;
        }
    },
);

// The dialog owns pending, failure and closing; what is left here is the one
// thing it cannot know — how this form becomes a payload. Rejecting is how a
// failure reaches the operator, so nothing is caught.
async function submitForm(): Promise<void> {
    await props.submit({
        code: form.value.code,
        valueType: form.value.valueType,
        value: form.value.value,
        durationType: form.value.durationType,
        durationValue: form.value.durationType === 'ONCE' ? null : form.value.durationValue,
        maxRedemptions: form.value.maxRedemptions ?? null,
        validFrom: form.value.validFrom || null,
        validUntil: form.value.validUntil || null,
        appliesToPlans:
            form.value.appliesToPlans.length > 0 ? [...form.value.appliesToPlans] : undefined,
        appliesToBilling: form.value.appliesToBilling,
        firstTimeCustomersOnly: form.value.firstTimeCustomersOnly || undefined,
        minimumPlanAmountGross: form.value.minimumPlanAmountGross ?? undefined,
        allowZeroInvoice: form.value.allowZeroInvoice || undefined,
        revenueDeductionAccount: form.value.revenueDeductionAccount || undefined,
        campaignTag: form.value.campaignTag || undefined,
        description: form.value.description || undefined,
    });
}
</script>
