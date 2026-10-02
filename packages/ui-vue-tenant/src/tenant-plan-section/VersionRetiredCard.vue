<template>
    <section class="sp-version-retired" :aria-labelledby="headingId">
        <h2 :id="headingId" class="sp-version-retired__title">
            {{ i18n.versionRetiredTitle.replace('{version}', retiredVersion) }}
        </h2>
        <p class="sp-version-retired__text">{{ lead }}</p>

        <VersionComparison
            :bound="retirement.retired"
            :other="retirement.replacement"
            :caption="i18n.versionRetiredCaption"
            :bound-heading="i18n.versionOfferColumnBound.replace('{version}', retiredVersion)"
            :other-heading="replacementHeading"
            :format-currency="formatCurrency"
            :quota-label="quotaLabel"
            :feature-label="featureLabel"
            :format-quota-value="formatQuotaValue"
        />

        <p class="sp-version-retired__text">
            {{ i18n.versionRetiredCancel.replace('{date}', lastDayToCancel) }}
        </p>
        <p class="sp-version-retired__note">{{ i18n.versionRetiredNoAction }}</p>

        <div v-if="switchTerms" class="sp-version-retired__actions">
            <TenantButton variant="solid" tone="accent" :loading="busy" @click="confirming = true">
                {{ i18n.versionRetiredSwitch }}
            </TenantButton>
        </div>

        <!-- What the switch costs until the date and after it, and what it gives up. -->
        <TenantDialog
            :model-value="confirming"
            :title="i18n.versionRetiredSwitchTitle.replace('{version}', replacementVersion)"
            size="sm"
            @update:model-value="
                (open: boolean) => {
                    if (!open) confirming = false;
                }
            "
        >
            <p class="sp-version-retired__text">{{ switchText }}</p>
            <p class="sp-version-retired__text">{{ i18n.versionRetiredSwitchCancelLapses }}</p>

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
// The version the tenant is on is being retired: when the subscription moves
// to the replacement, what changes, and until when it may be cancelled without
// notice. What it says is what the subscriber was told, read off the notice.
// Where the subscription may switch before the date, the card offers it and
// says what it costs; taking it is the section's, which owns the request.

import { computed, ref, useId } from 'vue';
import type { RetirementSwitchTerms, VersionRetiredNotice } from '@saasicat/core';

import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantDialog from '../ui/TenantDialog.vue';
import VersionComparison from './VersionComparison.vue';
import { dayAsInstant } from './version-retirement-day.js';

const props = defineProps<{
    retirement: VersionRetiredNotice;
    /** The display name of the plan the subscription continues on. */
    planName: string;
    /** What switching now costs, where the subscription may; null where it may not. */
    switchTerms?: RetirementSwitchTerms | null;
    /** While the switch is being written. */
    busy?: boolean;
    /** The rhythm the prices are paid in. */
    billingCycle?: string;
    /** When the next period starts, which is when a price that is not held applies. */
    nextPeriodStart?: string | null;
    formatCurrency: (n: number) => string;
    formatDate: (iso: string | Date) => string;
    quotaLabel: (key: string) => string;
    featureLabel: (key: string) => string;
    formatQuotaValue: (key: string, value: number) => string;
}>();

const emit = defineEmits<{ switch: [planVersionId: string] }>();

const i18n = useTenantI18n();
const headingId = useId();
const confirming = ref(false);

const retiredVersion = computed(() => String(props.retirement.retired.version));
const replacementVersion = computed(() => String(props.retirement.replacement.version));
const effectiveDate = computed(() => props.formatDate(props.retirement.effectiveAt));
const lastDayToCancel = computed(() =>
    props.formatDate(dayAsInstant(props.retirement.lastDayToCancel)),
);

const lead = computed(() =>
    i18n.value.versionRetiredLead
        .replace('{date}', effectiveDate.value)
        .replace('{plan}', props.planName)
        .replace('{version}', replacementVersion.value),
);

const replacementHeading = computed(() =>
    i18n.value.versionRetiredColumnReplacement
        .replace('{date}', effectiveDate.value)
        .replace('{version}', replacementVersion.value),
);

const unit = computed(() =>
    props.billingCycle === 'YEARLY'
        ? i18n.value.wizardPriceUnitYearly
        : i18n.value.wizardPriceUnitMonthly,
);
const priced = (amount: number) => `${props.formatCurrency(amount)} ${unit.value}`;

const switchText = computed(() => {
    const terms = props.switchTerms;
    if (!terms) return '';
    const named = (sentence: string) =>
        sentence.replace('{plan}', props.planName).replace('{version}', replacementVersion.value);
    if (terms.held) {
        return named(i18n.value.versionRetiredSwitchHeld)
            .replace('{held}', priced(terms.held.priceNet))
            .replace('{day}', props.formatDate(dayAsInstant(terms.held.lastDay)))
            .replace('{date}', effectiveDate.value)
            .replace('{price}', priced(terms.priceNet));
    }
    return named(i18n.value.versionRetiredSwitchNextPeriod)
        .replace(
            '{date}',
            props.nextPeriodStart ? props.formatDate(props.nextPeriodStart) : effectiveDate.value,
        )
        .replace('{price}', priced(terms.priceNet));
});

function confirm(): void {
    confirming.value = false;
    emit('switch', props.retirement.replacement.planVersionId);
}
</script>

<style scoped>
.sp-version-retired {
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-card);
    background: var(--sa-color-bg-surface);
    padding: var(--sa-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.sp-version-retired__title {
    margin: 0;
    font-size: var(--sa-text-lg);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.sp-version-retired__text {
    margin: 0;
    color: var(--sa-color-fg-body);
}
.sp-version-retired__actions {
    display: flex;
    justify-content: flex-end;
}
.sp-version-retired__note {
    margin: 0;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
</style>
