<template>
    <div class="sa-bundles__list">
        <div
            v-for="bundle in filteredBundles"
            :key="bundle.id"
            class="sa-bd-card"
            :class="{ open: openKey === bundle.id }"
        >
            <div class="sa-bd-card__head" @click="emit('toggle', bundle)">
                <div class="sa-bd-card__mark"><q-icon name="inventory_2" size="18px" /></div>
                <div class="sa-bd-card__titlewrap">
                    <div class="sa-bd-card__titlerow">
                        <span class="sa-bd-card__key">{{ bundle.bundleKey }}</span>
                        <span
                            class="sa-bundle-chip"
                            :class="`sa-bundle-chip--${statusClass(bundle)}`"
                            :title="statusTooltip(bundle)"
                        >
                            {{ statusLabel(bundle) }}
                        </span>
                        <span
                            v-if="i18nLocaleCount(bundle) > 0"
                            class="sa-bundle-chip sa-bundle-chip--info"
                        >
                            {{ translationCount(bundle) }}
                        </span>
                    </div>
                    <div class="sa-bd-card__name">{{ bundle.label }}</div>
                    <div class="sa-bd-card__desc">{{ bundle.description || '—' }}</div>
                </div>
                <q-icon
                    name="chevron_right"
                    class="sa-bd-card__chev"
                    :class="{ open: openKey === bundle.id }"
                />
            </div>

            <div v-if="openKey === bundle.id" class="sa-bd-card__body">
                <slot name="detail" :bundle="bundle" />
            </div>
        </div>

        <div v-if="bundlesTotal > 0 && filteredBundles.length === 0" class="sa-bd-empty-row">
            {{ msg.list.emptyNoMatch }}
        </div>
    </div>
</template>

<script setup lang="ts">
import type { BundleRow } from '@saasicat/types';
import {
    bundleStatusMeta,
    type BundleAggregateStatus,
} from '../../components/bundle-editor/bundle-version-status.js';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

const props = defineProps<{
    filteredBundles: BundleRow[];
    bundlesTotal: number;
    openKey: string | null;
    aggregateStatusOf: (bundle: BundleRow) => BundleAggregateStatus;
    i18nLocaleCount: (bundle: BundleRow) => number;
}>();

defineSlots<{
    detail(props: { bundle: BundleRow }): unknown;
}>();

const emit = defineEmits<{
    toggle: [bundle: BundleRow];
}>();

const msg = useSaMessages('bundles');

function statusMetaOf(bundle: BundleRow) {
    return bundleStatusMeta(props.aggregateStatusOf(bundle), msg.value);
}

function statusClass(bundle: BundleRow): string {
    return statusMetaOf(bundle).cls;
}

function statusLabel(bundle: BundleRow): string {
    return statusMetaOf(bundle).label;
}

function statusTooltip(bundle: BundleRow): string {
    return statusMetaOf(bundle).tooltip;
}

function translationCount(bundle: BundleRow): string {
    return formatMessage(msg.value.list.translationCount, { count: props.i18nLocaleCount(bundle) });
}
</script>

<style scoped>
/* Status chips co-located with the markup (analogous to PlanList .pl-chip*).
   Deliberately scoped: the identically named global .sa-bundle-chip rule in
   DiscoveryPage.vue would otherwise override .sa-bundle-chip--live (same specificity,
   later source order) and render the "Live" tag grey instead of green. */
.sa-bundle-chip {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--sa-border-soft);
    color: var(--sa-muted-dark);
}
.sa-bundle-chip--info {
    background: var(--sa-primary-50);
    color: var(--sa-primary-strong);
}
.sa-bundle-chip--live {
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
}
.sa-bundle-chip--draft {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
.sa-bundle-chip--supersed {
    background: var(--sa-border);
    color: var(--sa-muted);
}
.sa-bundle-chip--scheduled {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
</style>
