<template>
    <section class="sp-version-offer" :aria-labelledby="headingId">
        <div class="sp-version-offer__head">
            <h2 :id="headingId" class="sp-version-offer__title">
                {{ i18n.versionOfferTitle.replace('{version}', offeredVersion) }}
            </h2>
            <span class="sp-badge" :class="`sp-badge--${tone}`">{{ kindLabel }}</span>
        </div>
        <p class="sp-version-offer__lead">{{ lead }}</p>

        <VersionComparison
            :bound="offer.bound"
            :other="offer.offered"
            :caption="i18n.versionOfferCaption"
            :bound-heading="i18n.versionOfferColumnBound.replace('{version}', boundVersion)"
            :other-heading="i18n.versionOfferColumnOffered.replace('{version}', offeredVersion)"
            :format-currency="formatCurrency"
            :quota-label="quotaLabel"
            :feature-label="featureLabel"
            :format-quota-value="formatQuotaValue"
        />

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
import VersionComparison from './VersionComparison.vue';
import { offerAsksFirst, offerTone } from './version-offer-comparison.js';

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
.sp-version-offer__effective {
    margin: 0;
    color: var(--sa-color-fg-body);
}
.sp-version-offer__note {
    margin: 0;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
.sp-version-offer__actions {
    display: flex;
    justify-content: flex-end;
}
</style>
