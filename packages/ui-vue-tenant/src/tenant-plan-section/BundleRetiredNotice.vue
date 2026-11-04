<template>
    <section class="sp-bundle-retired" :aria-labelledby="titleId">
        <p :id="titleId" class="sp-bundle-retired__title">{{ title }}</p>
        <p class="sp-bundle-retired__text">{{ lead }}</p>

        <VersionComparison
            :bound="notice.retired"
            :other="notice.replacement"
            :caption="i18n.bundleRetiredCaption.replace('{bundle}', label)"
            :bound-heading="i18n.versionOfferColumnBound.replace('{version}', retiredVersion)"
            :other-heading="replacementHeading"
            :format-currency="formatCurrency"
            :quota-label="quotaLabel"
            :feature-label="featureLabel"
            :format-quota-value="formatQuotaValue"
        />

        <p class="sp-bundle-retired__text">{{ cancelText }}</p>
        <p class="sp-bundle-retired__note">
            {{ i18n.bundleRetiredNoAction.replace('{bundle}', label) }}
        </p>

        <div v-if="switchTerms && mayChange" class="sp-bundle-retired__actions">
            <TenantButton variant="solid" tone="accent" :loading="busy" @click="confirming = true">
                {{ i18n.versionRetiredSwitch }}
            </TenantButton>
        </div>

        <!-- What the switch costs until the date and after it, and what it gives up. -->
        <TenantDialog
            :model-value="confirming"
            :title="
                i18n.bundleRetiredSwitchTitle
                    .replace('{bundle}', label)
                    .replace('{version}', replacementVersion)
            "
            size="sm"
            @update:model-value="
                (open: boolean) => {
                    if (!open) confirming = false;
                }
            "
        >
            <p class="sp-bundle-retired__text">{{ switchText }}</p>
            <p class="sp-bundle-retired__text">{{ i18n.bundleRetiredSwitchCancelLapses }}</p>

            <template #footer>
                <TenantButton @click="confirming = false">
                    {{ i18n.bundlePreviewClose }}
                </TenantButton>
                <TenantButton variant="solid" tone="accent" @click="confirm">
                    {{ i18n.versionRetiredSwitchConfirm }}
                </TenantButton>
            </template>
        </TenantDialog>
    </section>
</template>

<script setup lang="ts">
// The version of an add-on the tenant has booked is being retired: when the
// booking continues on the replacement, what changes — at the prices for the
// plan the add-on runs beside — and until when it may be cancelled without its
// minimum term. What it says is what the subscriber was told, read off the
// notice. Where the booking may switch before the date, the notice offers it
// and says what it costs; taking it is the parent's, which owns the request.

import { computed, ref, useId } from 'vue';
import type {
    BundleRetirementSwitchTerms,
    BundleVersionRetiredNoticeWithDays,
    CalendarDay,
} from '@saasicat/core';

import { useTenantI18n } from '../tenant-i18n.js';
import { useMayChangeSubscription } from '../may-change-subscription.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantDialog from '../ui/TenantDialog.vue';
import VersionComparison from './VersionComparison.vue';
import { writeDay } from '../day-as-instant.js';

const props = defineProps<{
    notice: BundleVersionRetiredNoticeWithDays;
    /** The add-on's display name. */
    label: string;
    /** What switching now costs, where the booking may; null or absent where it may not. */
    switchTerms?: BundleRetirementSwitchTerms | null;
    /** While the switch is being written. */
    busy?: boolean;
    /** The day the booking's next period starts, which is when a price that is not held applies. */
    nextPeriodStartDay?: CalendarDay | null;
    formatCurrency: (n: number) => string;
    formatDate: (iso: string) => string;
    quotaLabel: (key: string) => string;
    featureLabel: (key: string) => string;
    formatQuotaValue: (key: string, value: number) => string;
}>();

const emit = defineEmits<{ switch: [bundleVersionId: string] }>();

const i18n = useTenantI18n();
const mayChange = useMayChangeSubscription();
const titleId = useId();
const confirming = ref(false);

const retiredVersion = computed(() => String(props.notice.retired.version));
const replacementVersion = computed(() => String(props.notice.replacement.version));
const effectiveDate = computed(() => writeDay(props.formatDate, props.notice.effectiveDays?.from));

const title = computed(() =>
    i18n.value.bundleRetiredTitle
        .replace('{version}', retiredVersion.value)
        .replace('{bundle}', props.label),
);
const lead = computed(() =>
    i18n.value.bundleRetiredLead
        .replace('{date}', effectiveDate.value)
        .replace('{bundle}', props.label)
        .replace('{version}', replacementVersion.value),
);
const replacementHeading = computed(() =>
    i18n.value.versionRetiredColumnReplacement
        .replace('{date}', effectiveDate.value)
        .replace('{version}', replacementVersion.value),
);
const cancelText = computed(() =>
    i18n.value.bundleRetiredCancel
        .replace('{date}', writeDay(props.formatDate, props.notice.lastDayToCancel))
        .replace('{bundle}', props.label),
);

const switchText = computed(() => {
    const terms = props.switchTerms;
    if (!terms) return '';
    // In the rhythm the booking is billed in now, which the terms name: the
    // notice's may have changed since it was told.
    const priced = (amount: number) =>
        `${props.formatCurrency(amount)} ${
            terms.billingCycle === 'YEARLY'
                ? i18n.value.wizardPriceUnitYearly
                : i18n.value.wizardPriceUnitMonthly
        }`;
    const named = (sentence: string) =>
        sentence.replace('{bundle}', props.label).replace('{version}', replacementVersion.value);
    if (terms.held) {
        return named(i18n.value.bundleRetiredSwitchHeld)
            .replace('{held}', priced(terms.held.priceNet))
            .replace('{day}', writeDay(props.formatDate, terms.held.lastDay))
            .replace('{date}', effectiveDate.value)
            .replace('{price}', priced(terms.priceNet));
    }
    const next = props.nextPeriodStartDay;
    return named(i18n.value.bundleRetiredSwitchNextPeriod)
        .replace('{date}', next ? writeDay(props.formatDate, next) : effectiveDate.value)
        .replace('{price}', priced(terms.priceNet));
});

function confirm(): void {
    confirming.value = false;
    emit('switch', props.notice.replacement.bundleVersionId);
}
</script>

<style scoped>
.sp-bundle-retired {
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-card);
    background: var(--sa-color-bg-surface);
    padding: var(--sa-space-4);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.sp-bundle-retired__title {
    margin: 0;
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.sp-bundle-retired__text {
    margin: 0;
    color: var(--sa-color-fg-body);
}
.sp-bundle-retired__actions {
    display: flex;
    justify-content: flex-end;
}
.sp-bundle-retired__note {
    margin: 0;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
</style>
