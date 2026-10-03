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
    </section>
</template>

<script setup lang="ts">
// The version of an add-on the tenant has booked is being retired: when the
// booking continues on the replacement, what changes — at the prices for the
// plan the add-on runs beside — and until when it may be cancelled without its
// minimum term. What it says is what the subscriber was told, read off the
// notice.

import { computed, useId } from 'vue';
import type { BundleVersionRetiredNotice } from '@saasicat/core';

import { useTenantI18n } from '../tenant-i18n.js';
import VersionComparison from './VersionComparison.vue';
import { dayAsInstant } from './version-retirement-day.js';

const props = defineProps<{
    notice: BundleVersionRetiredNotice;
    /** The add-on's display name. */
    label: string;
    formatCurrency: (n: number) => string;
    formatDate: (iso: string) => string;
    quotaLabel: (key: string) => string;
    featureLabel: (key: string) => string;
    formatQuotaValue: (key: string, value: number) => string;
}>();

const i18n = useTenantI18n();
const titleId = useId();

const retiredVersion = computed(() => String(props.notice.retired.version));
const replacementVersion = computed(() => String(props.notice.replacement.version));
const effectiveDate = computed(() => props.formatDate(props.notice.effectiveAt));

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
        .replace('{date}', props.formatDate(dayAsInstant(props.notice.lastDayToCancel)))
        .replace('{bundle}', props.label),
);
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
.sp-bundle-retired__note {
    margin: 0;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
</style>
