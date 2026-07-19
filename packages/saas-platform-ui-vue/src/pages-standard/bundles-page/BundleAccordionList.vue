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
                            {{ i18nLocaleCount(bundle) }} Übersetzung(en)
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
            Keine Bundles entsprechen der Suche.
        </div>
    </div>
</template>

<script setup lang="ts">
import type { BundleRow } from '@saasicat/types';
import {
    BUNDLE_STATUS_META,
    type BundleAggregateStatus,
} from '../../components/bundle-editor/bundle-version-status.js';

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

function statusClass(bundle: BundleRow): string {
    return BUNDLE_STATUS_META[props.aggregateStatusOf(bundle)]?.cls ?? 'draft';
}

function statusLabel(bundle: BundleRow): string {
    const status = props.aggregateStatusOf(bundle);
    return status === 'retired' ? 'Retired' : (BUNDLE_STATUS_META[status]?.label ?? status);
}

function statusTooltip(bundle: BundleRow): string | undefined {
    return BUNDLE_STATUS_META[props.aggregateStatusOf(bundle)]?.tooltip;
}
</script>

<style scoped>
/* Status-Chips co-lokalisiert beim Markup (analog PlanList .pl-chip*). Bewusst
   scoped: die identisch benannte globale .sa-chip-Regel in DiscoveryPage.vue
   würde sonst .sa-chip--live (gleiche Spezifität, spätere Quellreihenfolge)
   übersteuern und das „Live"-Tag grau statt grün rendern. */
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
