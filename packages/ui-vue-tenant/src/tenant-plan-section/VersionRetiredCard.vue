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
    </section>
</template>

<script setup lang="ts">
// The version the tenant is on is being retired: when the subscription moves
// to the replacement, what changes, and until when it may be cancelled without
// notice. What it says is what the subscriber was told, read off the notice.

import { computed, useId } from 'vue';
import type { VersionRetiredNotice } from '@saasicat/core';

import { useTenantI18n } from '../tenant-i18n.js';
import VersionComparison from './VersionComparison.vue';
import { dayAsInstant } from './version-retirement-day.js';

const props = defineProps<{
    retirement: VersionRetiredNotice;
    /** The display name of the plan the subscription continues on. */
    planName: string;
    formatCurrency: (n: number) => string;
    formatDate: (iso: string | Date) => string;
    quotaLabel: (key: string) => string;
    featureLabel: (key: string) => string;
    formatQuotaValue: (key: string, value: number) => string;
}>();

const i18n = useTenantI18n();
const headingId = useId();

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
.sp-version-retired__note {
    margin: 0;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
</style>
