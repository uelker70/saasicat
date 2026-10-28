<template>
    <div class="sa-kv-grid">
        <KvBlock :label="labels.plan" :value="data.subscription?.plan ?? EMPTY" />
        <KvBlock :label="labels.status" :value="data.subscription?.status ?? EMPTY" />
        <KvBlock :label="labels.pilot" :value="data.subscription?.isPilot ? yes : no" />
        <KvBlock :label="labels.trialEnd" :value="trialEnd" />
        <KvBlock :label="labels.pilotEnd" :value="pilotEnd" />
        <KvBlock v-if="data.vatId" :label="labels.vatId" :value="data.vatId" />
        <slot />
    </div>
</template>

<script setup lang="ts">
import KvBlock from '../../ui/data/KvBlock.vue';
import type { TenantDetailData, TenantMasterDataLabels } from './types.js';

// The subscription facts of a tenant. Pure presentation: the page resolves the
// labels and the days, so this block has no i18n and no data access.
defineProps<{
    data: TenantDetailData;
    labels: TenantMasterDataLabels;
    /** The trial's last day, as the page writes a day. */
    trialEnd: string;
    /** The day picked as the pilot's end, as the page writes a day. */
    pilotEnd: string;
    yes: string;
    no: string;
}>();

const EMPTY = '—';
</script>
