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
import { computed, reactive, ref, watch } from 'vue';
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

const form = reactive(emptyForm());
const advancedOpen = ref(false);

const isValid = computed(() => {
    if (!/^[A-Z0-9_-]{3,32}$/.test(form.code)) return false;
    if (!form.value || form.value <= 0) return false;
    if (form.valueType === 'PERCENT' && form.value > 100) return false;
    if (form.durationType !== 'ONCE' && (!form.durationValue || form.durationValue < 1))
        return false;
    return true;
});

watch(
    () => props.modelValue,
    (open) => {
        if (open) {
            Object.assign(form, emptyForm());
            advancedOpen.value = false;
        }
    },
);

// The dialog owns pending, failure and closing; what is left here is the one
// thing it cannot know — how this form becomes a payload. Rejecting is how a
// failure reaches the operator, so nothing is caught.
async function submitForm(): Promise<void> {
    await props.submit({
        code: form.code,
        valueType: form.valueType,
        value: form.value,
        durationType: form.durationType,
        durationValue: form.durationType === 'ONCE' ? null : form.durationValue,
        maxRedemptions: form.maxRedemptions ?? null,
        validFrom: form.validFrom || null,
        validUntil: form.validUntil || null,
        appliesToPlans: form.appliesToPlans.length > 0 ? [...form.appliesToPlans] : undefined,
        appliesToBilling: form.appliesToBilling,
        firstTimeCustomersOnly: form.firstTimeCustomersOnly || undefined,
        minimumPlanAmountGross: form.minimumPlanAmountGross ?? undefined,
        allowZeroInvoice: form.allowZeroInvoice || undefined,
        revenueDeductionAccount: form.revenueDeductionAccount || undefined,
        campaignTag: form.campaignTag || undefined,
        description: form.description || undefined,
    });
}
</script>
