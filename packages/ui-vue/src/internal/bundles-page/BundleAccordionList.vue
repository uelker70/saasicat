<template>
    <div class="sa-bundles__list">
        <AdminAccordion
            v-for="bundle in filteredBundles"
            :key="bundle.id"
            class="sa-bd-card"
            :open="openKey === bundle.id"
            @update:open="emit('toggle', bundle)"
        >
            <template #mark><q-icon name="inventory_2" size="18px" /></template>

            <template #header>
                <div class="sa-bd-card__head">
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
                </div>
            </template>

            <!--
                The bundle's own action sits on the bundle's own row.
                Soft-delete used to be in the card footer next to "publish this
                version" — one destroys every version, the other releases one,
                and they looked like peers in the same corner as "save".

                In `header-actions` and NOT in `header`. The header slot is
                rendered inside the disclosure `<button>`, so a control placed
                there is interactive content nested in a button: invalid markup,
                and a keyboard or screen-reader user cannot tell whether they
                are toggling the row or deleting it. `@click.stop` hides the
                first half of that and none of the second. This component was
                built with a sibling slot for exactly this case, and says so.
            -->
            <template #header-actions>
                <q-btn
                    class="sa-bd-card__delete"
                    flat
                    dense
                    round
                    color="negative"
                    icon="delete"
                    :aria-label="msg.detail.softDelete"
                    @click="emit('deleteBundle', bundle)"
                >
                    <q-tooltip>{{ msg.detail.softDelete }}</q-tooltip>
                </q-btn>
            </template>

            <slot name="detail" :bundle="bundle" />
        </AdminAccordion>

        <div v-if="bundlesTotal > 0 && filteredBundles.length === 0" class="sa-bd-empty-row">
            {{ msg.list.emptyNoMatch }}
        </div>
    </div>
</template>

<script setup lang="ts">
import type { BundleRow } from '@saasicat/core';
import AdminAccordion from '../../ui/page/AdminAccordion.vue';
import {
    bundleStatusMeta,
    type BundleAggregateStatus,
} from '../../features/bundle/internal/bundle-version-status.js';
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
    deleteBundle: [bundle: BundleRow];
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
    font-size: var(--sa-text-2xs);
    font-weight: 600;
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-badge);
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
}
.sa-bundle-chip--info {
    background: var(--sa-color-accent-surface-strong);
    color: var(--sa-color-accent-strong);
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
    background: var(--sa-color-border);
    color: var(--sa-color-fg-muted);
}
.sa-bundle-chip--scheduled {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
</style>
