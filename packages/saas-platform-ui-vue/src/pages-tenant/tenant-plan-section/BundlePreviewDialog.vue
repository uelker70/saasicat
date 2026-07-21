<template>
    <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
        <q-card class="sp-bundle-preview">
            <q-card-section class="sp-bundle-preview__head">
                <div class="sp-bundle-preview__title">
                    {{ isCancel ? i18n.bundlePreviewCancelTitle : i18n.bundlePreviewAddTitle }}
                </div>
                <div v-if="preview" class="sp-bundle-preview__bundle">
                    {{ preview.bundle.label }}
                </div>
            </q-card-section>

            <q-separator />

            <q-card-section v-if="loading" class="sp-bundle-preview__loading">
                <q-spinner size="24px" />
                <span>{{ i18n.bundlePreviewLoading }}</span>
            </q-card-section>

            <q-card-section v-else-if="error" class="sp-bundle-preview__error">
                {{ error }}
            </q-card-section>

            <template v-else-if="preview">
                <!-- Blocker: booking/cancellation not possible -->
                <q-card-section v-if="preview.blockers.length > 0" class="sp-bundle-preview__blockers">
                    <div class="sp-bundle-preview__block-title">
                        {{ i18n.bundlePreviewBlockersTitle }}
                    </div>
                    <ul>
                        <li v-for="blocker in preview.blockers" :key="blocker.code">
                            {{ blocker.message }}
                        </li>
                    </ul>
                    <!-- requires blocker with resolved feature labels (#35) -->
                    <div
                        v-if="addPreview && addPreview.missingRequires.length > 0"
                        class="sp-bundle-preview__requires"
                    >
                        <span class="sp-bundle-preview__block-subtitle">
                            {{ i18n.bundlePreviewMissingRequiresTitle }}:
                        </span>
                        {{ addPreview.missingRequires.map(featureLabel).join(', ') }}
                    </div>
                </q-card-section>

                <!-- Add preview: price + proration -->
                <q-card-section v-if="addPreview" class="sp-bundle-preview__price">
                    <div class="sp-bundle-preview__block-title">
                        {{ i18n.bundlePreviewProrationTitle }}
                    </div>
                    <div v-if="addPreview.proration" class="sp-bundle-preview__price-row">
                        <span>
                            {{ i18n.bundlePreviewProratedNow }}
                            ({{ addPreview.proration.daysRemainingInPeriod }}/{{
                                addPreview.proration.daysInPeriod
                            }}
                            {{ i18n.bundlePreviewProrationDays }})
                        </span>
                        <strong>{{ formatCurrency(addPreview.proration.prorataDeltaNet) }}</strong>
                    </div>
                    <div v-else-if="isTrial" class="sp-bundle-preview__note">
                        {{ i18n.bundlePreviewTrialNote }}
                    </div>
                    <div v-else class="sp-bundle-preview__note">
                        {{ i18n.bundlePreviewNoPrice }}
                    </div>
                    <div
                        v-if="addPreview.nextPeriodPriceNet !== null"
                        class="sp-bundle-preview__price-row"
                    >
                        <span>{{ i18n.bundlePreviewNextPeriod }}</span>
                        <strong>
                            {{ formatCurrency(addPreview.nextPeriodPriceNet) }}
                            <small>{{ cycleUnit }}</small>
                        </strong>
                    </div>
                    <div class="sp-bundle-preview__price-row">
                        <span>{{ i18n.bundlePreviewMinimumTermLabel }}</span>
                        <span v-if="addPreview.minimumTermMonths > 0 && addPreview.minimumTermEndsAt">
                            {{ addPreview.minimumTermMonths }}
                            {{ i18n.bundlePreviewMinimumTermMonths }}
                            {{ formatDate(addPreview.minimumTermEndsAt) }}
                        </span>
                        <span v-else>{{ i18n.bundlePreviewMinimumTermNone }}</span>
                    </div>
                </q-card-section>

                <!-- Add preview: redundancy hint (AK-13) -->
                <q-card-section
                    v-if="addPreview && addPreview.redundantFeatures.length > 0"
                    class="sp-bundle-preview__warnings"
                >
                    <div class="sp-bundle-preview__block-title">
                        {{ i18n.bundlePreviewRedundantTitle }}
                    </div>
                    <ul>
                        <li v-for="hint in addPreview.redundantFeatures" :key="hint.featureKey">
                            {{ featureLabel(hint.featureKey) }} —
                            {{
                                hint.coveredBy === 'PLAN'
                                    ? i18n.bundlePreviewRedundantCoveredByPlan
                                    : i18n.bundlePreviewRedundantCoveredByBundle
                            }}
                            „{{ hint.coveredByKey }}"
                        </li>
                    </ul>
                </q-card-section>

                <!-- Cancel preview: effective date + savings -->
                <q-card-section v-if="cancelPreview" class="sp-bundle-preview__price">
                    <div class="sp-bundle-preview__price-row">
                        <span>{{ i18n.bundlePreviewEffectiveAt }}</span>
                        <strong>{{ formatDate(cancelPreview.effectiveAt) }}</strong>
                    </div>
                    <div
                        v-if="cancelPreview.nextPeriodSavingsNet !== null"
                        class="sp-bundle-preview__price-row"
                    >
                        <span>{{ i18n.bundlePreviewSavings }}</span>
                        <strong>{{ formatCurrency(cancelPreview.nextPeriodSavingsNet) }}</strong>
                    </div>
                </q-card-section>

                <!-- Warnings (e.g. MINIMUM_TERM_BINDS) -->
                <q-card-section
                    v-if="otherWarnings.length > 0"
                    class="sp-bundle-preview__warnings"
                >
                    <div class="sp-bundle-preview__block-title">
                        {{ i18n.bundlePreviewWarningsTitle }}
                    </div>
                    <ul>
                        <li v-for="warning in otherWarnings" :key="warning.code">
                            {{ warning.message }}
                        </li>
                    </ul>
                </q-card-section>
            </template>

            <q-separator />

            <q-card-actions align="right">
                <q-btn flat :label="i18n.bundlePreviewClose" :disable="submitting" @click="close" />
                <q-btn
                    :color="isCancel ? 'negative' : 'primary'"
                    unelevated
                    :label="
                        submitting
                            ? i18n.bundlePreviewInProgress
                            : isCancel
                              ? i18n.bundlePreviewConfirmCancel
                              : i18n.bundlePreviewConfirmAdd
                    "
                    :loading="submitting"
                    :disable="!canConfirm"
                    @click="emit('confirm')"
                />
            </q-card-actions>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TenantPlanSectionI18n } from '../default-i18n.js';
import type {
    BundleAddPreviewShape,
    BundleCancelPreviewShape,
    BundlePreviewShape,
} from '../../use-tenant-billing.js';

// BundlePreviewDialog (#37/#61) — preview BEFORE bundle add/cancel in the
// tenant self-service: proration until period end, next-period price,
// redundancy hint (AK-13), requires blocker and minimum-term warning.
// Booking is only possible when the `blockers` list is empty.

const REDUNDANT_WARNING_CODE = 'REDUNDANT_FEATURES';

const props = defineProps<{
    modelValue: boolean;
    /** null while the preview is loading. */
    preview: BundlePreviewShape | null;
    loading: boolean;
    /** Error while loading the preview (preview endpoint). */
    error: string | null;
    /** Confirm mutation in progress (add/cancel). */
    submitting: boolean;
    /** Subscription status — during TRIAL there is deliberately no proration. */
    subscriptionStatus: string;
    i18n: TenantPlanSectionI18n;
    formatCurrency: (n: number) => string;
    formatDate: (iso: string) => string;
    featureLabel: (key: string) => string;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: boolean];
    confirm: [];
}>();

const isCancel = computed(() => props.preview?.action === 'cancel');
const isTrial = computed(() => props.subscriptionStatus === 'TRIAL');

const addPreview = computed<BundleAddPreviewShape | null>(() =>
    props.preview?.action === 'add' ? props.preview : null,
);
const cancelPreview = computed<BundleCancelPreviewShape | null>(() =>
    props.preview?.action === 'cancel' ? props.preview : null,
);

// REDUNDANT_FEATURES has its own feature-resolved section — the generic
// warning for it would be a duplicate.
const otherWarnings = computed(() =>
    (props.preview?.warnings ?? []).filter((w) => w.code !== REDUNDANT_WARNING_CODE),
);

const canConfirm = computed(
    () =>
        !props.loading &&
        !props.error &&
        props.preview !== null &&
        props.preview.blockers.length === 0 &&
        !props.submitting,
);

const cycleUnit = computed(() =>
    props.preview?.billingCycle === 'YEARLY'
        ? props.i18n.wizardConfirmPerCycleYearly
        : props.i18n.wizardConfirmPerCycleMonthly,
);

function close() {
    emit('update:modelValue', false);
}
</script>

<style scoped>
.sp-bundle-preview {
    min-width: 420px;
    max-width: 560px;
}
.sp-bundle-preview__head {
    padding-bottom: 8px;
}
.sp-bundle-preview__title {
    font-size: 16px;
    font-weight: 600;
}
.sp-bundle-preview__bundle {
    margin-top: 2px;
    color: var(--sp-text-secondary, rgba(0, 0, 0, 0.6));
}
.sp-bundle-preview__loading {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--sp-text-secondary, rgba(0, 0, 0, 0.6));
}
.sp-bundle-preview__error {
    color: var(--q-negative, #c10015);
}
.sp-bundle-preview__blockers {
    background: rgba(193, 0, 21, 0.08);
    color: var(--q-negative, #c10015);
}
.sp-bundle-preview__warnings {
    background: rgba(242, 192, 55, 0.12);
}
.sp-bundle-preview__block-title {
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 6px;
}
.sp-bundle-preview__block-subtitle {
    font-weight: 500;
}
.sp-bundle-preview__blockers ul,
.sp-bundle-preview__warnings ul {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
}
.sp-bundle-preview__requires {
    margin-top: 6px;
    font-size: 13px;
}
.sp-bundle-preview__price-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 4px 0;
    font-size: 14px;
}
.sp-bundle-preview__price-row small {
    font-weight: 400;
    color: var(--sp-text-muted, rgba(0, 0, 0, 0.55));
}
.sp-bundle-preview__note {
    font-size: 13px;
    color: var(--sp-text-muted, rgba(0, 0, 0, 0.55));
    padding: 4px 0;
}
</style>
