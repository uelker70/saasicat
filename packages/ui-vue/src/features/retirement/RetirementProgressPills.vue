<template>
    <template v-for="part in parts" :key="part.state">
        <span
            class="sa-retirement-progress"
            :class="{ 'sa-retirement-progress--attention': part.attention }"
        >
            {{ formatMessage(common.retirementProgress[part.state], { count: part.count }) }}
        </span>
        <template v-if="part.state === 'notTold'">
            <span
                v-for="why in reasons"
                :key="why.reason"
                class="sa-retirement-progress sa-retirement-progress--reason"
            >
                {{
                    formatMessage(common.retirementProgress.notToldBecause[why.reason], {
                        count: why.count,
                    })
                }}
            </span>
        </template>
    </template>
</template>

<script setup lang="ts">
// How far a retirement has come, as a plan's and an add-on's version both say
// it: one pill per state with something in it, marked where it asks for the
// operator — and beside the ones not told yet, why they wait.

import { computed } from 'vue';
import type { RetirementProgress } from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import { notToldReasonParts, retirementProgressParts } from '../../client/version-retirement.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

const props = defineProps<{ progress: RetirementProgress }>();

const common = useSaMessages('common');
const parts = computed(() => retirementProgressParts(props.progress));
const reasons = computed(() => notToldReasonParts(props.progress));
</script>

<style scoped>
/* Neutral, except where it asks for the operator. */
.sa-retirement-progress {
    display: inline-flex;
    align-items: center;
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
    font: 600 var(--sa-text-xs) var(--sa-font-mono);
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-fg-secondary);
    border: 1px solid var(--sa-color-border);
    white-space: nowrap;
}
/* What a pill beside it says of it: quieter than the count it explains. */
.sa-retirement-progress--reason {
    font-weight: 400;
}
.sa-retirement-progress--attention {
    background: var(--sa-color-negative-surface);
    color: var(--sa-color-negative-fg);
    border-color: var(--sa-color-negative-border);
}
</style>
