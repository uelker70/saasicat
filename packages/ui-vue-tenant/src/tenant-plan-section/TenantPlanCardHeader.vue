<template>
    <TenantCardSection class="sp-plan-section__card-head">
        <div>
            <div class="sp-plan-section__eyebrow">
                {{ i18n.activePlan }}
            </div>
            <h2 class="sp-plan-section__plan-name">{{ currentPlanName }}</h2>
            <div class="sp-plan-section__meta">
                <span class="sp-badge" :class="`sp-badge--${statusTone}`">
                    {{ statusLabel }}
                </span>
                <span class="sp-plan-section__cycle">{{ cycleLabel }}</span>
                <span v-if="currentPriceEur !== null" class="sp-plan-section__price">
                    {{ formatCurrency(currentPriceEur) }}
                    {{ currentPriceUnit }}
                </span>
            </div>
            <p v-if="nextBillingDate" class="sp-plan-section__sub">
                {{ i18n.nextBillingDate }}: {{ formatDate(nextBillingDate) }}
            </p>
            <p v-if="usage.status === 'TRIAL' && usage.trialEndsAt" class="sp-plan-section__sub">
                {{ i18n.trialEndsAt }}: {{ formatDate(usage.trialEndsAt) }}
            </p>
            <p v-if="usage.isPilot && usage.pilotEndsAt" class="sp-plan-section__sub">
                {{ i18n.pilotEndsAt }}: {{ formatDate(usage.pilotEndsAt) }}
            </p>
            <p v-if="usage.pendingPlan" class="sp-plan-section__sub">
                {{ i18n.pendingChange }}:
                {{ i18n.changeFromTo }}
                <strong>{{ usage.pendingPlan }}</strong>
                <template v-if="usage.pendingEffectiveAt">
                    — {{ i18n.changeEffectiveAt }}
                    {{ formatDate(usage.pendingEffectiveAt) }}
                </template>
            </p>
        </div>
        <!--
            A cancelled subscription is not a gone subscription. It runs, it is
            billed and it keeps every entitlement until `canceledEffectiveAt` —
            which is why this says the date rather than the word, and why the
            cancel button below disappears instead of offering the act twice.
        -->
        <p v-if="hasEnded" class="sp-plan-section__canceled">
            <strong>{{ i18n.endedHeading }}</strong>
            {{ i18n.endedOn }} {{ formatDate(landsAt!) }}.
        </p>
        <p v-else-if="landsAt" class="sp-plan-section__canceled">
            <strong>{{ i18n.canceledHeading }}</strong>
            {{ i18n.canceledUntil }} {{ formatDate(landsAt) }}.
            {{ i18n.canceledUnchanged }}
        </p>
        <div class="sp-plan-section__actions">
            <!--
                A subscription that is over has no plan to change: the route
                answers `SUBSCRIPTION_ENDED`, and offering the button anyway
                turns a state the page could have shown into an error dialog.
            -->
            <TenantButton
                v-if="!hasEnded"
                variant="solid"
                tone="accent"
                @click="emit('changePlan')"
            >
                {{ i18n.changePlanButton }}
            </TenantButton>
            <TenantButton
                v-if="!landsAt"
                variant="quiet"
                tone="neutral"
                @click="emit('cancelSubscription')"
            >
                {{ i18n.cancelSubscriptionButton }}
            </TenantButton>
        </div>
    </TenantCardSection>
</template>

<script setup lang="ts">
import type { UsageSnapshotShape } from '@saasicat/ui-vue';
import { computed } from 'vue';

import { useTenantI18n } from '../tenant-i18n.js';
import type { BadgeTone } from '../ui/badge-tone.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantCardSection from '../ui/TenantCardSection.vue';
import { cancellationLandsAt, subscriptionHasEnded } from '../subscription-ended.js';
import '../ui/tenant-ui.css';

const i18n = useTenantI18n();

const props = defineProps<{
    usage: UsageSnapshotShape;
    currentPlanName: string;
    statusTone: BadgeTone;
    statusLabel: string;
    cycleLabel: string;
    currentPriceEur: number | null;
    currentPriceUnit: string;
    nextBillingDate: string | null;
    formatCurrency: (value: number) => string;
    formatDate: (value: string | Date) => string;
}>();

const emit = defineEmits<{
    (e: 'changePlan'): void;
    (e: 'cancelSubscription'): void;
}>();

/** When the cancellation lands, or null while none was declared. */
const landsAt = computed(() => cancellationLandsAt(props.usage));

/**
 * Whether that date has passed. Not `usage.status`: nothing transitions the
 * column when a cancellation lands, so a subscription that is over still says
 * ACTIVE there.
 */
const hasEnded = computed(() => subscriptionHasEnded(props.usage));
</script>
