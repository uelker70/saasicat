<template>
    <div class="sp-version-comparison">
        <div class="sp-version-comparison__scroll">
            <table class="sp-version-comparison__table">
                <caption class="sp-version-comparison__caption">
                    {{
                        caption
                    }}
                </caption>
                <thead>
                    <tr>
                        <th scope="col">{{ i18n.versionOfferColumnItem }}</th>
                        <th scope="col">{{ boundHeading }}</th>
                        <th scope="col">{{ otherHeading }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in prices" :key="row.rhythm">
                        <th scope="row">{{ priceLabel(row.rhythm) }}</th>
                        <td>{{ priceText(row.bound) }}</td>
                        <td>{{ priceText(row.offered) }}</td>
                    </tr>
                    <tr v-for="row in quotas" :key="row.key">
                        <th scope="row">{{ quotaLabel(row.key) }}</th>
                        <td>{{ formatQuotaValue(row.key, row.bound) }}</td>
                        <td>{{ formatQuotaValue(row.key, row.offered) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p v-if="features.added.length > 0" class="sp-version-comparison__features">
            <strong>{{ i18n.versionOfferFeaturesAdded }}:</strong>
            {{ features.added.map(featureLabel).join(', ') }}
        </p>
        <p v-if="features.removed.length > 0" class="sp-version-comparison__features">
            <strong>{{ i18n.versionOfferFeaturesRemoved }}:</strong>
            {{ features.removed.map(featureLabel).join(', ') }}
        </p>
    </div>
</template>

<script setup lang="ts">
// Two versions side by side, as a subscriber compares them: the price in each
// rhythm, each quota, and the features one has and the other does not. A plan
// version offered, a plan version's replacement and an add-on version's
// replacement are read alike.

import { computed } from 'vue';

import { useTenantI18n } from '../tenant-i18n.js';
import {
    offerFeatureChanges,
    offerPriceRows,
    offerQuotaRows,
    type ComparedVersion,
} from './version-offer-comparison.js';

const props = defineProps<{
    /** The version the subscriber has. */
    bound: ComparedVersion;
    /** The version it is compared with. */
    other: ComparedVersion;
    caption: string;
    boundHeading: string;
    otherHeading: string;
    formatCurrency: (n: number) => string;
    quotaLabel: (key: string) => string;
    featureLabel: (key: string) => string;
    formatQuotaValue: (key: string, value: number) => string;
}>();

const i18n = useTenantI18n();

const pair = computed(() => ({ bound: props.bound, offered: props.other }));
const prices = computed(() => offerPriceRows(pair.value));
const quotas = computed(() => offerQuotaRows(pair.value));
const features = computed(() => offerFeatureChanges(pair.value));

function priceLabel(rhythm: 'MONTHLY' | 'YEARLY'): string {
    return rhythm === 'MONTHLY'
        ? i18n.value.versionOfferPriceMonthly
        : i18n.value.versionOfferPriceYearly;
}

function priceText(net: number | null): string {
    return net === null ? i18n.value.versionOfferNotSold : props.formatCurrency(net);
}
</script>

<style scoped>
.sp-version-comparison {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.sp-version-comparison__features {
    margin: 0;
    color: var(--sa-color-fg-body);
}
/* Scrolls rather than being cut off where three columns do not fit. */
.sp-version-comparison__scroll {
    overflow-x: auto;
}
.sp-version-comparison__table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
}
.sp-version-comparison__caption {
    caption-side: top;
    text-align: start;
    padding-bottom: var(--sa-space-2);
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
.sp-version-comparison__table th,
.sp-version-comparison__table td {
    padding: var(--sa-space-2) var(--sa-space-4);
    border-bottom: 1px solid var(--sa-color-border-soft);
    text-align: start;
}
.sp-version-comparison__table thead th {
    font-weight: 600;
    color: var(--sa-color-fg-secondary);
}
.sp-version-comparison__table tbody th {
    font-weight: 500;
}
</style>
