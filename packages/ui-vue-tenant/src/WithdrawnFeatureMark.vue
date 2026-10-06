<template>
    <span v-if="withdrawn" class="sp-withdrawn-mark">
        <span class="sp-badge sp-badge--warning">{{ badge }}</span>
        <span class="sp-withdrawn-mark__reason">{{ reason }}</span>
    </span>
</template>

<script setup lang="ts">
// Said beside a feature wherever a plan or an add-on is shown with what it
// includes, while the feature is withdrawn or about to be: from when, until
// when where that is known, and why — so whoever concludes or changes now does
// it knowing, rather than finding out afterwards.

import { computed } from 'vue';

import { messageText } from './message-parts.js';
import { useTenantI18n } from './tenant-i18n.js';
import { useWithdrawnFeatures } from './withdrawn-features.js';
import './ui/tenant-ui.css';

const props = defineProps<{ featureKey: string }>();

const i18n = useTenantI18n();
const features = useWithdrawnFeatures();

const withdrawn = computed(() => features.of(props.featureKey));
const dateOf = (iso: string): string => features.formatDate(iso);

const badge = computed(() => {
    const mark = withdrawn.value;
    if (!mark) return '';
    const ahead = new Date(mark.effectiveFrom).getTime() > Date.now();
    const from = messageText(
        ahead ? i18n.value.featureWithdrawnBadgeAhead : i18n.value.featureWithdrawnBadge,
        { date: dateOf(mark.effectiveFrom) },
    );
    return mark.liftedFrom
        ? `${from}, ${messageText(i18n.value.featureWithdrawnBack, { date: dateOf(mark.liftedFrom) })}`
        : from;
});

const reason = computed(() =>
    withdrawn.value
        ? messageText(i18n.value.featureWithdrawnReason, { reason: withdrawn.value.reason })
        : '',
);
</script>

<style scoped>
.sp-withdrawn-mark {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sa-space-1) var(--sa-space-2);
}
.sp-withdrawn-mark__reason {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    overflow-wrap: anywhere;
}
</style>
