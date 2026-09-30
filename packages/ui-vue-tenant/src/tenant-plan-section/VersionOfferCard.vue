<template>
    <section class="sp-version-offer" :aria-labelledby="headingId">
        <div class="sp-version-offer__head">
            <h2 :id="headingId" class="sp-version-offer__title">
                {{ i18n.versionOfferTitle.replace('{version}', offeredVersion) }}
            </h2>
            <span class="sp-badge" :class="`sp-badge--${tone}`">{{ kindLabel }}</span>
        </div>
        <p class="sp-version-offer__lead">{{ lead }}</p>

        <div class="sp-version-offer__scroll">
            <table class="sp-version-offer__table">
                <caption class="sp-version-offer__caption">
                    {{
                        i18n.versionOfferCaption
                    }}
                </caption>
                <thead>
                    <tr>
                        <th scope="col">{{ i18n.versionOfferColumnItem }}</th>
                        <th scope="col">
                            {{ i18n.versionOfferColumnBound.replace('{version}', boundVersion) }}
                        </th>
                        <th scope="col">
                            {{
                                i18n.versionOfferColumnOffered.replace('{version}', offeredVersion)
                            }}
                        </th>
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

        <p v-if="features.added.length > 0" class="sp-version-offer__features">
            <strong>{{ i18n.versionOfferFeaturesAdded }}:</strong>
            {{ features.added.map(featureLabel).join(', ') }}
        </p>
        <p v-if="features.removed.length > 0" class="sp-version-offer__features">
            <strong>{{ i18n.versionOfferFeaturesRemoved }}:</strong>
            {{ features.removed.map(featureLabel).join(', ') }}
        </p>

        <p class="sp-version-offer__effective">{{ effectiveText }}</p>
        <p class="sp-version-offer__note">{{ i18n.versionOfferNoAction }}</p>

        <div class="sp-version-offer__actions">
            <TenantButton variant="solid" tone="accent" :loading="busy" @click="onTake">
                {{ takeLabel }}
            </TenantButton>
        </div>

        <!--
            Asked only where the switch costs more or takes something away; an
            improvement is taken by one click. The question states what the
            switch does, in the words of the kind of offer it is.
        -->
        <TenantDialog
            :model-value="confirming"
            :title="i18n.versionOfferConfirmTitle.replace('{version}', offeredVersion)"
            size="sm"
            @update:model-value="
                (open: boolean) => {
                    if (!open) confirming = false;
                }
            "
        >
            {{ confirmBody }}

            <template #footer>
                <TenantButton @click="confirming = false">
                    {{ i18n.bundlePreviewClose }}
                </TenantButton>
                <TenantButton variant="solid" tone="accent" @click="confirm">
                    {{ i18n.versionOfferConfirmAction }}
                </TenantButton>
            </template>
        </TenantDialog>
    </section>
</template>

<script setup lang="ts">
// A newer version of the tenant's plan, offered beside it: both versions side
// by side, the kind of offer, when a switch would take effect, and the switch.
// What the card compares is read off the offer by `version-offer-comparison`;
// taking it is the section's, which owns the request and says how it went.

import { computed, ref, useId } from 'vue';
import type { VersionOfferView } from '@saasicat/core';

import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantDialog from '../ui/TenantDialog.vue';
import {
    offerAsksFirst,
    offerFeatureChanges,
    offerPriceRows,
    offerQuotaRows,
    offerTone,
} from './version-offer-comparison.js';

const props = defineProps<{
    offer: VersionOfferView;
    /** While the switch is being written. */
    busy: boolean;
    formatCurrency: (n: number) => string;
    formatDate: (iso: string | Date) => string;
    quotaLabel: (key: string) => string;
    featureLabel: (key: string) => string;
    formatQuotaValue: (key: string, value: number) => string;
}>();

const emit = defineEmits<{ (e: 'take', planVersionId: string): void }>();

const i18n = useTenantI18n();
const headingId = useId();
const confirming = ref(false);

const offeredVersion = computed(() => String(props.offer.offered.version));
const boundVersion = computed(() => String(props.offer.bound.version));
const prices = computed(() => offerPriceRows(props.offer));
const quotas = computed(() => offerQuotaRows(props.offer));
const features = computed(() => offerFeatureChanges(props.offer));
const tone = computed(() => offerTone(props.offer.class));

const kindLabel = computed(() => {
    if (props.offer.class === 'improvement') return i18n.value.versionOfferKindImprovement;
    if (props.offer.class === 'more-for-more') return i18n.value.versionOfferKindMoreForMore;
    return i18n.value.versionOfferKindTakesAway;
});

const lead = computed(() => {
    if (props.offer.class === 'improvement') return i18n.value.versionOfferLeadImprovement;
    if (props.offer.class === 'more-for-more') return i18n.value.versionOfferLeadMoreForMore;
    return i18n.value.versionOfferLeadTakesAway;
});

const takesEffectDate = computed(() => props.formatDate(props.offer.takesEffectAt));

const effectiveText = computed(() =>
    props.offer.class === 'takes-something-away'
        ? i18n.value.versionOfferEffectiveAt.replace('{date}', takesEffectDate.value)
        : i18n.value.versionOfferEffectiveNow,
);

const confirmBody = computed(() =>
    props.offer.class === 'takes-something-away'
        ? i18n.value.versionOfferConfirmTakesAway.replace('{date}', takesEffectDate.value)
        : i18n.value.versionOfferConfirmMoreForMore,
);

const takeLabel = computed(() =>
    i18n.value.versionOfferTakeAction.replace('{version}', offeredVersion.value),
);

function priceLabel(rhythm: 'MONTHLY' | 'YEARLY'): string {
    return rhythm === 'MONTHLY'
        ? i18n.value.versionOfferPriceMonthly
        : i18n.value.versionOfferPriceYearly;
}

function priceText(net: number | null): string {
    return net === null ? i18n.value.versionOfferNotSold : props.formatCurrency(net);
}

function onTake(): void {
    if (offerAsksFirst(props.offer.class)) {
        confirming.value = true;
        return;
    }
    emit('take', props.offer.offered.planVersionId);
}

function confirm(): void {
    confirming.value = false;
    emit('take', props.offer.offered.planVersionId);
}
</script>

<style scoped>
.sp-version-offer {
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-card);
    background: var(--sa-color-bg-surface);
    padding: var(--sa-space-5);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.sp-version-offer__head {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    flex-wrap: wrap;
}
.sp-version-offer__title {
    margin: 0;
    font-size: var(--sa-text-lg);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.sp-version-offer__lead,
.sp-version-offer__features,
.sp-version-offer__effective {
    margin: 0;
    color: var(--sa-color-fg-body);
}
.sp-version-offer__note {
    margin: 0;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
/* Scrolls rather than being cut off where three columns do not fit. */
.sp-version-offer__scroll {
    overflow-x: auto;
}
.sp-version-offer__table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
}
.sp-version-offer__caption {
    caption-side: top;
    text-align: start;
    padding-bottom: var(--sa-space-2);
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
.sp-version-offer__table th,
.sp-version-offer__table td {
    padding: var(--sa-space-2) var(--sa-space-4);
    border-bottom: 1px solid var(--sa-color-border-soft);
    text-align: start;
}
.sp-version-offer__table thead th {
    font-weight: 600;
    color: var(--sa-color-fg-secondary);
}
.sp-version-offer__table tbody th {
    font-weight: 500;
}
.sp-version-offer__actions {
    display: flex;
    justify-content: flex-end;
}
</style>
