<template>
    <q-dialog
        :model-value="modelValue"
        persistent
        @update:model-value="emit('update:modelValue', $event)"
    >
        <q-card class="pc-dlg">
            <q-card-section class="pc-dlg__head">
                <div>
                    <div class="pc-dlg__title">{{ msg.createDialog.title }}</div>
                    <div class="pc-dlg__sub">{{ subtitle ?? msg.createDialog.subtitle }}</div>
                </div>
                <q-btn
                    v-close-popup
                    class="pc-dlg__close"
                    flat
                    dense
                    round
                    icon="close"
                    :disable="loading"
                />
            </q-card-section>

            <q-card-section class="pc-dlg__body">
                <PromoCodeDialogFields
                    v-model:code="form.code"
                    v-model:advanced-open="advancedOpen"
                    mode="create"
                    :form="form"
                    :show-campaign-tag="showCampaignTag"
                    :plans="plans"
                />

                <p v-if="error" class="pc-error">{{ error }}</p>
            </q-card-section>

            <q-card-actions align="right" class="pc-dlg__foot">
                <q-btn v-close-popup flat :label="common.cancel" :disable="loading" />
                <q-btn
                    unelevated
                    color="primary"
                    :label="common.create"
                    :loading="loading"
                    :disable="!isValid"
                    @click="onSubmit"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
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
const loading = ref(false);
const error = ref('');
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
            error.value = '';
            advancedOpen.value = false;
        }
    },
);

async function onSubmit() {
    if (!isValid.value) return;
    loading.value = true;
    error.value = '';
    try {
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
        emit('created');
        emit('update:modelValue', false);
    } catch (err) {
        error.value =
            (err as { response?: { data?: { message?: string } } }).response?.data?.message ??
            (err as Error).message ??
            common.value.createFailed;
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
    color: var(--sa-color-fg-heading);
}

.pc-dlg__sub {
    font-size: 12.5px;
    color: var(--sa-color-fg-muted);
    margin-top: 2px;
}

.pc-dlg__body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-top: 4px;
}

.pc-dlg__foot {
    border-top: 1px solid var(--sa-color-border);
}

.pc-error {
    background: var(--sa-color-negative-surface);
    border: 1px solid var(--sa-color-negative-border);
    color: var(--sa-color-negative-fg);
    font-size: 13px;
    margin: 8px 0 0;
    padding: 8px 12px;
    border-radius: 8px;
}
</style>
