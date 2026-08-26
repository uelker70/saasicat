<template>
    <TenantDialog
        :model-value="modelValue"
        :title="isCancel ? i18n.bundlePreviewCancelTitle : i18n.bundlePreviewAddTitle"
        :subtitle="preview?.bundle.label"
        size="md"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <div v-if="loading" class="sp-bundle-preview__loading">
            <span class="sp-spinner" aria-hidden="true"></span>
            <span>{{ i18n.bundlePreviewLoading }}</span>
        </div>

        <div v-else-if="error" class="sp-bundle-preview__error">
            {{ error }}
        </div>

        <template v-else-if="preview">
            <!-- Blocker: booking/cancellation not possible -->
            <section v-if="preview.blockers.length > 0" class="sp-bundle-preview__blockers">
                <h3 class="sp-bundle-preview__block-title">
                    {{ i18n.bundlePreviewBlockersTitle }}
                </h3>
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
            </section>

            <!-- Add preview: price + proration -->
            <section v-if="addPreview" class="sp-bundle-preview__price">
                <h3 class="sp-bundle-preview__block-title">
                    {{ i18n.bundlePreviewProrationTitle }}
                </h3>
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
                <div v-if="addPreview.firstPeriodEnd" class="sp-bundle-preview__price-row">
                    <span>{{ i18n.bundlePreviewFirstPeriodLabel }}</span>
                    <strong>{{ formatDate(addPreview.firstPeriodEnd) }}</strong>
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
                <div v-if="addPreview.endsWithPlanAt" class="sp-bundle-preview__price-row">
                    <span>{{ i18n.bundlePreviewEndsWithPlanLabel }}</span>
                    <strong>{{ formatDate(addPreview.endsWithPlanAt) }}</strong>
                </div>
                <!--
                    A term of the booking rather than a warning: it holds for
                    every bundle, and a warning that always fires teaches people
                    to skip warnings.
                -->
                <p class="sp-bundle-preview__note">
                    {{ i18n.bundlePreviewEndsWithPlanNote }}
                </p>
            </section>

            <!-- Add preview: redundancy hint (AK-13) -->
            <section
                v-if="addPreview && addPreview.redundantFeatures.length > 0"
                class="sp-bundle-preview__warnings"
            >
                <h3 class="sp-bundle-preview__block-title">
                    {{ i18n.bundlePreviewRedundantTitle }}
                </h3>
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
            </section>

            <!-- Cancel preview: effective date + savings -->
            <section v-if="cancelPreview" class="sp-bundle-preview__price">
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
            </section>

            <!-- Warnings (e.g. MINIMUM_TERM_BINDS) -->
            <section v-if="otherWarnings.length > 0" class="sp-bundle-preview__warnings">
                <h3 class="sp-bundle-preview__block-title">
                    {{ i18n.bundlePreviewWarningsTitle }}
                </h3>
                <ul>
                    <li v-for="warning in otherWarnings" :key="warning.code">
                        {{ warning.message }}
                    </li>
                </ul>
            </section>
        </template>

        <template #footer>
            <TenantButton :disabled="submitting" @click="close">
                {{ i18n.bundlePreviewClose }}
            </TenantButton>
            <TenantButton
                variant="solid"
                :tone="isCancel ? 'danger' : 'accent'"
                :loading="submitting"
                :disabled="!canConfirm"
                @click="emit('confirm')"
            >
                {{
                    submitting
                        ? i18n.bundlePreviewInProgress
                        : isCancel
                          ? i18n.bundlePreviewConfirmCancel
                          : i18n.bundlePreviewConfirmAdd
                }}
            </TenantButton>
        </template>
    </TenantDialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantDialog from '../ui/TenantDialog.vue';
import '../ui/tenant-ui.css';
import type {
    BundleAddPreviewShape,
    BundleCancelPreviewShape,
    BundlePreviewShape,
} from '@saasicat/ui-vue';

// BundlePreviewDialog (#37/#61) — preview BEFORE bundle add/cancel in the
// tenant self-service: proration until period end, next-period price,
// redundancy hint (AK-13), requires blocker and minimum-term warning.
// Booking is only possible when the `blockers` list is empty.

const REDUNDANT_WARNING_CODE = 'REDUNDANT_FEATURES';

const i18n = useTenantI18n();

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
        ? i18n.value.wizardConfirmPerCycleYearly
        : i18n.value.wizardConfirmPerCycleMonthly,
);

function close() {
    emit('update:modelValue', false);
}
</script>

<style scoped>
/* The head, the width and the footer belong to `TenantDialog` now; what is left
 * here is the body's own blocks. Each section that carries a tone paints and
 * pads itself, because the body around them has one padding for everything. */
.sp-bundle-preview__loading {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
    --sp-spinner-size: 24px;
    color: var(--sa-color-fg-secondary);
}
.sp-bundle-preview__error {
    color: var(--sa-color-negative);
}
.sp-bundle-preview__blockers,
.sp-bundle-preview__warnings,
.sp-bundle-preview__price {
    padding: var(--sa-space-4);
    border-radius: var(--sa-radius-badge);
}
.sp-bundle-preview__blockers + section,
.sp-bundle-preview__warnings + section,
.sp-bundle-preview__price + section {
    margin-top: var(--sa-space-4);
}
.sp-bundle-preview__blockers {
    background: var(--sa-color-negative-surface);
    color: var(--sa-color-negative-fg);
}
.sp-bundle-preview__warnings {
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
}
.sp-bundle-preview__block-title {
    margin: 0 0 var(--sa-space-2);
    font-weight: 600;
    font-size: var(--sa-text-md);
}
.sp-bundle-preview__block-subtitle {
    font-weight: 500;
}
.sp-bundle-preview__blockers ul,
.sp-bundle-preview__warnings ul {
    margin: 0;
    padding-left: var(--sa-space-5);
    font-size: var(--sa-text-md);
}
.sp-bundle-preview__requires {
    margin-top: var(--sa-space-2);
    font-size: var(--sa-text-md);
}
.sp-bundle-preview__price-row {
    display: flex;
    justify-content: space-between;
    gap: var(--sa-space-5);
    padding: var(--sa-space-2) 0;
    font-size: var(--sa-text-lg);
}
.sp-bundle-preview__price-row small {
    font-weight: 400;
    color: var(--sa-color-fg-muted);
}
.sp-bundle-preview__note {
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-muted);
    padding: var(--sa-space-2) 0;
}
</style>
