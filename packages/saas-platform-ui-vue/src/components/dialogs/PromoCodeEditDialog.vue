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
                <!-- Section: Code & discount -->
                <div class="pc-section">
                    <div class="pc-section__title">{{ msg.form.sectionCodeDiscount }}</div>
                    <div class="pc-grid pc-grid--2">
                        <div class="pc-field">
                            <div class="pc-field__label">{{ msg.form.codeLabel }}</div>
                            <input
                                :value="row?.code ?? ''"
                                class="pc-input pc-input--code"
                                disabled
                            />
                            <div class="pc-field__hint">{{ msg.form.codeStableHint }}</div>
                        </div>

                        <div class="pc-field">
                            <div class="pc-field__label">{{ msg.form.valueTypeLabel }}</div>
                            <div class="pc-type-grid">
                                <button
                                    v-for="o in typeOptions"
                                    :key="o.k"
                                    type="button"
                                    class="pc-type-opt"
                                    :class="{ 'pc-type-opt--active': form.valueType === o.k }"
                                    @click="form.valueType = o.k"
                                >
                                    <div class="pc-type-opt__label">{{ o.label }}</div>
                                    <div class="pc-type-opt__sub">{{ o.sub }}</div>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="pc-field" style="max-width: 280px">
                        <div class="pc-field__label">
                            {{
                                form.valueType === 'PERCENT'
                                    ? msg.form.valuePercentLabel
                                    : msg.form.valueAbsoluteLabel
                            }}
                        </div>
                        <input
                            v-model.number="form.value"
                            class="pc-input"
                            type="number"
                            min="1"
                            :max="form.valueType === 'PERCENT' ? 100 : undefined"
                        />
                    </div>
                </div>

                <!-- Section: Validity & duration -->
                <div class="pc-section">
                    <div class="pc-section__title">{{ msg.form.sectionValidity }}</div>

                    <div v-if="plans.length > 0" class="pc-field">
                        <div class="pc-field__label">{{ msg.form.plansLabel }}</div>
                        <div class="pc-plan-pick">
                            <button
                                v-for="p in plans"
                                :key="p.key"
                                type="button"
                                class="pc-plan-opt"
                                :class="{ 'pc-plan-opt--on': isPlanSelected(p.key) }"
                                :style="planChipStyle(p)"
                                @click="togglePlan(p.key)"
                            >
                                <span
                                    class="pc-plan-opt__mark"
                                    :style="{ background: p.color ?? '#64748b' }"
                                />
                                {{ p.label }}
                            </button>
                        </div>
                        <div class="pc-field__hint">
                            {{
                                formatMessage(msg.form.plansHint, {
                                    count: form.appliesToPlans.length,
                                })
                            }}
                        </div>
                    </div>

                    <div class="pc-grid pc-grid--2">
                        <div class="pc-field">
                            <div class="pc-field__label">{{ msg.form.durationLabel }}</div>
                            <div class="pc-dur">
                                <button
                                    v-for="o in durationOptions"
                                    :key="o.k"
                                    type="button"
                                    class="pc-dur-opt"
                                    :class="{ 'pc-dur-opt--active': form.durationType === o.k }"
                                    @click="form.durationType = o.k"
                                >
                                    {{ o.label }}
                                </button>
                            </div>
                            <input
                                v-if="form.durationType !== 'ONCE'"
                                v-model.number="form.durationValue"
                                class="pc-input"
                                type="number"
                                min="1"
                                style="margin-top: 8px; max-width: 120px"
                                :placeholder="
                                    form.durationType === 'MONTHS'
                                        ? msg.form.durationMonthsPlaceholder
                                        : msg.form.durationCyclesPlaceholder
                                "
                            />
                        </div>

                        <div class="pc-field">
                            <div class="pc-field__label">{{ msg.form.maxRedemptionsLabel }}</div>
                            <input
                                v-model.number="form.maxRedemptions"
                                class="pc-input"
                                type="number"
                                min="1"
                                :placeholder="msg.form.maxRedemptionsPlaceholder"
                            />
                            <div class="pc-field__hint">
                                {{ msg.form.maxRedemptionsHintEdit }}
                            </div>
                        </div>
                    </div>

                    <div class="pc-grid pc-grid--2">
                        <div class="pc-field">
                            <div class="pc-field__label">{{ msg.form.validFromLabel }}</div>
                            <input v-model="form.validFrom" class="pc-input" type="date" />
                        </div>
                        <div class="pc-field">
                            <div class="pc-field__label">{{ msg.form.validUntilLabel }}</div>
                            <input v-model="form.validUntil" class="pc-input" type="date" />
                        </div>
                    </div>

                    <div class="pc-grid pc-grid--2">
                        <div class="pc-field">
                            <div class="pc-field__label">{{ common.status }}</div>
                            <div class="pc-status">
                                <button
                                    v-for="o in statusOptions"
                                    :key="o.k"
                                    type="button"
                                    class="pc-status-opt"
                                    :class="{
                                        'pc-status-opt--active': form.status === o.k,
                                    }"
                                    @click="form.status = o.k"
                                >
                                    <q-icon :name="o.icon" size="14px" />
                                    {{ o.label }}
                                </button>
                            </div>
                            <div class="pc-field__hint">{{ msg.form.statusHint }}</div>
                        </div>
                    </div>
                </div>

                <!-- Section: Campaign & note -->
                <div class="pc-section">
                    <div class="pc-section__title">{{ msg.form.sectionCampaign }}</div>
                    <div v-if="showCampaignTag" class="pc-field">
                        <div class="pc-field__label">{{ msg.form.campaignLabel }}</div>
                        <input
                            v-model="form.campaignTag"
                            class="pc-input"
                            :placeholder="msg.form.campaignPlaceholder"
                        />
                        <div class="pc-field__hint">{{ msg.form.campaignHint }}</div>
                    </div>
                    <div class="pc-field">
                        <div class="pc-field__label">{{ msg.form.noteLabel }}</div>
                        <textarea
                            v-model="form.description"
                            class="pc-input"
                            rows="2"
                            :placeholder="msg.form.notePlaceholder"
                        />
                    </div>
                </div>

                <!-- Section: Advanced -->
                <div class="pc-section">
                    <button
                        type="button"
                        class="pc-section__toggle"
                        @click="advancedOpen = !advancedOpen"
                    >
                        <q-icon
                            :name="advancedOpen ? 'expand_more' : 'chevron_right'"
                            size="16px"
                        />
                        {{ msg.form.advancedToggle }}
                    </button>
                    <div v-if="advancedOpen" class="pc-advanced">
                        <div class="pc-grid pc-grid--2">
                            <div class="pc-field">
                                <div class="pc-field__label">{{ msg.form.billingCycleLabel }}</div>
                                <select v-model="form.appliesToBilling" class="pc-input">
                                    <option :value="null">{{ common.both }}</option>
                                    <option value="MONTHLY">{{ common.monthly }}</option>
                                    <option value="YEARLY">{{ common.yearly }}</option>
                                </select>
                            </div>
                            <div class="pc-field">
                                <div class="pc-field__label">{{ msg.form.minAmountLabel }}</div>
                                <input
                                    v-model.number="form.minimumPlanAmountGross"
                                    class="pc-input"
                                    type="number"
                                    min="0"
                                    :placeholder="msg.form.minAmountPlaceholder"
                                />
                            </div>
                        </div>
                        <div class="pc-grid pc-grid--2">
                            <label class="pc-check">
                                <input v-model="form.firstTimeCustomersOnly" type="checkbox" />
                                <span>{{ msg.form.firstTimeOnly }}</span>
                            </label>
                            <label class="pc-check">
                                <input v-model="form.allowZeroInvoice" type="checkbox" />
                                <span>{{ msg.form.allowZeroInvoice }}</span>
                            </label>
                        </div>
                        <div class="pc-field">
                            <div class="pc-field__label">{{ msg.form.revenueAccountLabel }}</div>
                            <input
                                v-model="form.revenueDeductionAccount"
                                class="pc-input"
                                :placeholder="msg.form.revenueAccountPlaceholder"
                            />
                        </div>
                    </div>
                </div>

                <!-- Live preview -->
                <div class="pc-preview">
                    <div class="pc-preview__eyebrow">{{ msg.form.previewEyebrow }}</div>
                    <div class="pc-preview__body">
                        <code class="pc-preview__code">{{ row?.code || 'CODE' }}</code>
                        <span class="pc-preview__disc">{{ previewValue }}</span>
                        <span class="pc-preview__meta">{{ previewMeta }}</span>
                    </div>
                </div>

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

const statusOptions = computed<
    ReadonlyArray<{ k: 'ACTIVE' | 'PAUSED'; label: string; icon: string }>
>(() => [
    { k: 'ACTIVE', label: common.value.active, icon: 'play_arrow' },
    { k: 'PAUSED', label: msg.value.form.statusPaused, icon: 'pause' },
]);

const typeOptions = computed<ReadonlyArray<{ k: PromoCodeValueType; label: string; sub: string }>>(
    () => [
        {
            k: 'PERCENT',
            label: msg.value.form.valueTypePercent,
            sub: msg.value.form.valueTypePercentSub,
        },
        {
            k: 'ABSOLUTE',
            label: msg.value.form.valueTypeAbsolute,
            sub: msg.value.form.valueTypeAbsoluteSub,
        },
    ],
);

const durationOptions = computed<ReadonlyArray<{ k: PromoCodeDurationType; label: string }>>(() => [
    { k: 'ONCE', label: msg.value.form.durationOnce },
    { k: 'MONTHS', label: msg.value.form.durationMonths },
    { k: 'BILLING_CYCLES', label: msg.value.form.durationBillingCycles },
]);

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

function isPlanSelected(key: string): boolean {
    return form.appliesToPlans.includes(key);
}
function togglePlan(key: string): void {
    if (form.appliesToPlans.includes(key)) {
        form.appliesToPlans = form.appliesToPlans.filter((k) => k !== key);
    } else {
        form.appliesToPlans = [...form.appliesToPlans, key];
    }
}
function planChipStyle(p: PromoCodePlanOption): Record<string, string> {
    if (!isPlanSelected(p.key) || !p.color) return {};
    return {
        borderColor: p.color,
        background: `${p.color}12`,
        color: p.color,
    };
}

const previewValue = computed(() => {
    if (form.valueType === 'PERCENT') return `−${form.value || 0}%`;
    return `−${form.value || 0} €`;
});

const previewMeta = computed(() => {
    const parts: string[] = [];
    const count = form.durationValue || 0;
    if (form.durationType === 'ONCE') parts.push(msg.value.form.previewOnce);
    else if (form.durationType === 'MONTHS')
        parts.push(formatMessage(msg.value.form.previewMonths, { count }));
    else parts.push(formatMessage(msg.value.form.previewCycles, { count }));
    parts.push(
        form.appliesToPlans.length > 0
            ? form.appliesToPlans.join(', ')
            : props.plans.length > 0
              ? msg.value.form.previewAllPlans
              : msg.value.form.previewNoPlanFilter,
    );
    if (form.maxRedemptions)
        parts.push(formatMessage(msg.value.form.previewMax, { count: form.maxRedemptions }));
    return parts.join(' · ');
});

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

.pc-section {
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 10px;
    padding: 14px 16px;
    background: #fafbfc;
}
.pc-section__title {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 13px;
    color: var(--sa-heading, #0f172a);
    margin-bottom: 12px;
    letter-spacing: -0.005em;
}
.pc-section__toggle {
    border: 0;
    background: transparent;
    cursor: pointer;
    font: 600 12.5px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-muted-dark, #475569);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
}
.pc-advanced {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 12px;
}

.pc-grid {
    display: grid;
    gap: 12px;
    margin-bottom: 12px;
}
.pc-grid--2 {
    grid-template-columns: 1fr 1fr;
}
@media (max-width: 600px) {
    .pc-grid--2 {
        grid-template-columns: 1fr;
    }
}
.pc-grid:last-child {
    margin-bottom: 0;
}

.pc-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.pc-field__label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.pc-field__hint {
    font-size: 11.5px;
    color: #94a3b8;
}

.pc-input {
    width: 100%;
    border: 1px solid var(--sa-border, #e2e8f0);
    background: #fff;
    border-radius: 7px;
    padding: 8px 10px;
    font: 13.5px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-body, #1e293b);
    outline: 0;
}
.pc-input:disabled {
    background: #f1f5f9;
    color: var(--sa-muted, #64748b);
    cursor: not-allowed;
}
.pc-input:focus {
    border-color: var(--sa-primary, #3f6bff);
    box-shadow: 0 0 0 3px rgba(63, 107, 255, 0.12);
}
.pc-input--code {
    font: 600 14px var(--sa-font-mono, ui-monospace, monospace);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
textarea.pc-input {
    font: 13.5px var(--sa-font-body, system-ui, sans-serif);
    resize: vertical;
}

.pc-status {
    display: flex;
    gap: 6px;
}
.pc-status-opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--sa-border, #e2e8f0);
    background: #fff;
    border-radius: 7px;
    padding: 6px 12px;
    font: 500 12.5px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-muted-dark, #475569);
    cursor: pointer;
}
.pc-status-opt--active {
    border-color: var(--sa-primary, #3f6bff);
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    color: var(--sa-primary, #3f6bff);
}

.pc-type-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
}
.pc-type-opt {
    border: 1px solid var(--sa-border, #e2e8f0);
    background: #fff;
    border-radius: 8px;
    padding: 8px 10px;
    text-align: left;
    cursor: pointer;
    transition:
        border-color 0.1s,
        background 0.1s;
}
.pc-type-opt:hover {
    border-color: #cbd5e1;
}
.pc-type-opt--active {
    border-color: var(--sa-primary, #3f6bff);
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
}
.pc-type-opt__label {
    font: 600 12.5px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-heading, #0f172a);
}
.pc-type-opt__sub {
    font: 11.5px var(--sa-font-mono, ui-monospace, monospace);
    color: var(--sa-muted, #64748b);
    margin-top: 1px;
}

.pc-plan-pick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.pc-plan-opt {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 999px;
    padding: 5px 12px 5px 8px;
    font: 600 12px var(--sa-font-body, system-ui, sans-serif);
    cursor: pointer;
    color: var(--sa-muted-dark, #475569);
    transition:
        border-color 0.1s,
        background 0.1s;
}
.pc-plan-opt:hover {
    border-color: #cbd5e1;
}
.pc-plan-opt--on {
    border-color: var(--sa-primary, #3f6bff);
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    color: var(--sa-primary, #3f6bff);
}
.pc-plan-opt__mark {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}

.pc-dur {
    display: flex;
    gap: 4px;
}
.pc-dur-opt {
    flex: 1;
    border: 1px solid var(--sa-border, #e2e8f0);
    background: #fff;
    border-radius: 7px;
    padding: 6px 10px;
    font: 500 12px var(--sa-font-body, system-ui, sans-serif);
    cursor: pointer;
    color: var(--sa-muted-dark, #475569);
}
.pc-dur-opt--active {
    border-color: var(--sa-primary, #3f6bff);
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    color: var(--sa-primary, #3f6bff);
}

.pc-check {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 13px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-body, #1e293b);
    cursor: pointer;
}

.pc-preview {
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.06));
    border: 1px solid var(--sa-primary-border, rgba(63, 107, 255, 0.18));
    border-radius: 10px;
    padding: 12px 14px;
}
.pc-preview__eyebrow {
    font-size: 11px;
    font-weight: 700;
    color: var(--sa-primary, #3f6bff);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 6px;
}
.pc-preview__body {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}
.pc-preview__code {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 6px;
    padding: 3px 8px;
    font: 600 13px var(--sa-font-mono, ui-monospace, monospace);
    letter-spacing: 0.04em;
    color: var(--sa-heading, #0f172a);
}
.pc-preview__disc {
    font: 700 13px var(--sa-font-body, system-ui, sans-serif);
    color: var(--sa-positive, #047857);
}
.pc-preview__meta {
    font-size: 12px;
    color: var(--sa-muted, #64748b);
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
</style>
