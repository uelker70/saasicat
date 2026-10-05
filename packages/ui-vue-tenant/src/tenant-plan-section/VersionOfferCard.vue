<template>
    <section class="sp-version-offer" :aria-labelledby="headingId">
        <div class="sp-version-offer__head">
            <!-- Beside the plan it heads a section; beside a booked add-on it is
                 part of that booking, as the add-on's retirement notice is. -->
            <component :is="addOn ? 'p' : 'h2'" :id="headingId" class="sp-version-offer__title">
                {{ title }}
            </component>
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
// A newer version offered beside what the tenant has — of the plan, or of an
// add-on booked: both versions side by side, the kind of offer, when a switch
// would take effect, and the switch. What the card compares is read off the
// offer by `version-offer-comparison`; taking it is the parent's, which owns
// the request and says how it went.

import { computed, ref, useId } from 'vue';
import type { BundleVersionOfferView, VersionOfferView } from '@saasicat/core';

import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantDialog from '../ui/TenantDialog.vue';
import VersionComparison from './VersionComparison.vue';
import { offerAsksFirst, offerTone } from './version-offer-comparison.js';

const props = defineProps<{
    /** A newer version of the plan, or — with `bundleLabel` — of a booked add-on. */
    offer: VersionOfferView | BundleVersionOfferView;
    /** The add-on's display name, where the offer is one of an add-on booked. */
    bundleLabel?: string;
    /** While the switch is being written. */
    busy: boolean;
    formatCurrency: (n: number) => string;
    formatDate: (iso: string) => string;
    quotaLabel: (key: string) => string;
    featureLabel: (key: string) => string;
    formatQuotaValue: (key: string, value: number) => string;
}>();

/** The version offered, by its id: a plan version's, or an add-on version's. */
const emit = defineEmits<{ (e: 'take', versionId: string): void }>();

const i18n = useTenantI18n();
const headingId = useId();
const confirming = ref(false);

const offeredVersion = computed(() => String(props.offer.offered.version));
const boundVersion = computed(() => String(props.offer.bound.version));
const tone = computed(() => offerTone(props.offer.class));
const addOn = computed(() => props.bundleLabel !== undefined);
/** A sentence of the add-on's wording with its name in, or of the plan's. */
const worded = (bundle: string, plan: string): string =>
    addOn.value ? bundle.replace('{bundle}', props.bundleLabel ?? '') : plan;

const title = computed(() =>
    worded(i18n.value.bundleOfferTitle, i18n.value.versionOfferTitle).replace(
        '{version}',
        offeredVersion.value,
    ),
);

const kindLabel = computed(() => {
    if (props.offer.class === 'improvement') return i18n.value.versionOfferKindImprovement;
    if (props.offer.class === 'more-for-more') return i18n.value.versionOfferKindMoreForMore;
    return i18n.value.versionOfferKindTakesAway;
});

const lead = computed(() => {
    const words = i18n.value;
    if (props.offer.class === 'improvement') {
        return worded(words.bundleOfferLeadImprovement, words.versionOfferLeadImprovement);
    }
    if (props.offer.class === 'more-for-more') {
        return worded(words.bundleOfferLeadMoreForMore, words.versionOfferLeadMoreForMore);
    }
    return worded(words.bundleOfferLeadTakesAway, words.versionOfferLeadTakesAway);
});

const takesEffectDate = computed(() => props.formatDate(props.offer.takesEffectAt));

const effectiveText = computed(() =>
    props.offer.class === 'takes-something-away'
        ? i18n.value.versionOfferEffectiveAt.replace('{date}', takesEffectDate.value)
        : i18n.value.versionOfferEffectiveNow,
);

const confirmBody = computed(() =>
    props.offer.class === 'takes-something-away'
        ? worded(
              i18n.value.bundleOfferConfirmTakesAway,
              i18n.value.versionOfferConfirmTakesAway,
          ).replace('{date}', takesEffectDate.value)
        : worded(
              i18n.value.bundleOfferConfirmMoreForMore,
              i18n.value.versionOfferConfirmMoreForMore,
          ),
);

const offeredId = computed(() =>
    'planVersionId' in props.offer.offered
        ? props.offer.offered.planVersionId
        : props.offer.offered.bundleVersionId,
);

const takeLabel = computed(() =>
    i18n.value.versionOfferTakeAction.replace('{version}', offeredVersion.value),
);

function onTake(): void {
    if (offerAsksFirst(props.offer.class)) {
        confirming.value = true;
        return;
    }
    emit('take', offeredId.value);
}

function confirm(): void {
    confirming.value = false;
    emit('take', offeredId.value);
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
