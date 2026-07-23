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
                            class="sa-chip"
                            :class="`sa-chip--${statusClass(bundle)}`"
                            :title="statusTooltip(bundle)"
                        >
                            {{ statusLabel(bundle) }}
                        </span>
                        <span v-if="i18nLocaleCount(bundle) > 0" class="sa-chip sa-chip--info">
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
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

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
const { locale } = useSuperAdminI18n();

function statusMetaOf(bundle: BundleRow) {
    return bundleStatusMeta(props.aggregateStatusOf(bundle), locale.value);
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
   Deliberately scoped: the identically named global .sa-chip rule in
   DiscoveryPage.vue would otherwise override .sa-chip--live (same specificity,
   later source order) and render the "Live" tag grey instead of green. */
.sa-chip {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 6px;
    background: #f1f5f9;
    color: #475569;
}
.sa-chip--info {
    background: #eff6ff;
    color: #1d4ed8;
}
.sa-chip--live {
    background: #dcfce7;
    color: #166534;
}
.sa-chip--draft {
    background: #fef3c7;
    color: #92400e;
}
.sa-chip--supersed {
    background: #e2e8f0;
    color: #64748b;
}
.sa-chip--scheduled {
    background: #fef3c7;
    color: #92400e;
}
</style>
