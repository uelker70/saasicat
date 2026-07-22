<template>
    <q-card-section class="sp-plan-section__card-head">
        <div>
            <div class="sp-plan-section__eyebrow">
                {{ i18n.activePlan }}
            </div>
            <h2 class="sp-plan-section__plan-name">{{ currentPlanName }}</h2>
            <div class="sp-plan-section__meta">
                <q-badge :color="statusColor" :label="statusLabel" />
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
        <div class="sp-plan-section__actions">
            <q-btn
                color="primary"
                unelevated
                :label="i18n.changePlanButton"
                @click="emit('changePlan')"
            />
        </div>
    </q-card-section>
</template>

<script setup lang="ts">
import type { TenantPlanSectionI18n } from '../default-i18n.js';
import type { UsageSnapshotShape } from '../../vue/use-tenant-billing.js';

defineProps<{
    usage: UsageSnapshotShape;
    i18n: TenantPlanSectionI18n;
    currentPlanName: string;
    statusColor: string;
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
}>();
</script>
