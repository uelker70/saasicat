<template>
    <section class="pve-col pve-pool">
        <div class="pve-col-header">
            <div>
                <div class="pve-col-title">{{ msg.componentPool.title }}</div>
                <div class="pve-col-sub">{{ msg.componentPool.subtitle }}</div>
            </div>
        </div>
        <div class="pve-search">
            <span class="pve-search-ico" aria-hidden="true">
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.35-4.35" />
                </svg>
            </span>
            <input
                :value="searchTerm"
                :placeholder="msg.componentPool.searchPlaceholder"
                @input="updateSearchTerm"
            />
            <span class="pve-kbd">⌘ K</span>
        </div>
        <div class="pve-tabs" role="tablist">
            <button
                v-for="tab in poolTabs"
                :key="tab.id"
                type="button"
                role="tab"
                :class="['pve-tab', { 'pve-tab--active': activeTab === tab.id }]"
                @click="$emit('update:activeTab', tab.id)"
            >
                {{ tab.label }}
                <span class="pve-tab-count">{{ tab.count }}</span>
            </button>
        </div>
        <div class="pve-pool-list">
            <template v-if="activeTab === 'features'">
                <template v-for="grp in filteredFeatureGroups" :key="grp.key">
                    <div class="pve-pool-group">{{ grp.label }}</div>
                    <div
                        v-for="f in grp.rows"
                        :key="f.featureKey"
                        class="pve-pool-card"
                        :class="{ 'pve-pool-card--selected': isFeatureOn(f.featureKey) }"
                        draggable="true"
                        @click="$emit('toggle-feature', f.featureKey, !isFeatureOn(f.featureKey))"
                        @dragstart="$emit('drag-start', 'feature', f.featureKey, $event)"
                        @dragend="$emit('drag-end')"
                    >
                        <span class="pve-pool-grip" aria-hidden="true">
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                            >
                                <circle cx="9" cy="6" r="1.5" fill="currentColor" />
                                <circle cx="15" cy="6" r="1.5" fill="currentColor" />
                                <circle cx="9" cy="12" r="1.5" fill="currentColor" />
                                <circle cx="15" cy="12" r="1.5" fill="currentColor" />
                                <circle cx="9" cy="18" r="1.5" fill="currentColor" />
                                <circle cx="15" cy="18" r="1.5" fill="currentColor" />
                            </svg>
                        </span>
                        <div class="pve-pool-card-main">
                            <div class="pve-pool-card-row">
                                <span class="pve-pool-card-label">{{
                                    featureLabel(f.featureKey)
                                }}</span>
                                <span
                                    v-if="isFeatureOn(f.featureKey)"
                                    class="pve-pool-card-check"
                                    aria-hidden="true"
                                >
                                    <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                    >
                                        <path d="M5 13l4 4L19 7" />
                                    </svg>
                                </span>
                            </div>
                            <div class="pve-pool-card-meta">
                                <code class="pve-pool-card-key">{{ f.featureKey }}</code>
                                <span class="pve-pool-card-dot">·</span>
                                <span>{{ featureGroupLabel(f.featureKey) }}</span>
                            </div>
                        </div>
                    </div>
                </template>
                <div v-if="filteredFeatureGroups.length === 0" class="pve-empty">
                    {{ msg.componentPool.emptyFeatures }}
                </div>
            </template>

            <template v-else-if="activeTab === 'quotas'">
                <div
                    v-for="q in filteredQuotas"
                    :key="q.quotaKey"
                    class="pve-pool-card"
                    :class="{ 'pve-pool-card--selected': isQuotaOn(q.quotaKey) }"
                    draggable="true"
                    @click="$emit('pool-quota-click', q)"
                    @dragstart="$emit('drag-start', 'quota', q.quotaKey, $event)"
                    @dragend="$emit('drag-end')"
                >
                    <span class="pve-pool-grip" aria-hidden="true">
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                        >
                            <circle cx="9" cy="6" r="1.5" fill="currentColor" />
                            <circle cx="15" cy="6" r="1.5" fill="currentColor" />
                            <circle cx="9" cy="12" r="1.5" fill="currentColor" />
                            <circle cx="15" cy="12" r="1.5" fill="currentColor" />
                            <circle cx="9" cy="18" r="1.5" fill="currentColor" />
                            <circle cx="15" cy="18" r="1.5" fill="currentColor" />
                        </svg>
                    </span>
                    <div class="pve-pool-card-main">
                        <div class="pve-pool-card-row">
                            <span class="pve-pool-card-label">{{ q.label || q.quotaKey }}</span>
                            <span
                                v-if="isQuotaOn(q.quotaKey)"
                                class="pve-pool-card-check"
                                aria-hidden="true"
                            >
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="3"
                                >
                                    <path d="M5 13l4 4L19 7" />
                                </svg>
                            </span>
                        </div>
                        <div class="pve-pool-card-meta">
                            <code class="pve-pool-card-key">{{ q.quotaKey }}</code>
                            <template v-if="q.unit">
                                <span class="pve-pool-card-dot">·</span>
                                <span>{{ q.unit }}</span>
                            </template>
                        </div>
                    </div>
                </div>
                <div v-if="filteredQuotas.length === 0" class="pve-empty">
                    {{ msg.componentPool.emptyQuotas }}
                </div>
            </template>

            <template v-else>
                <div
                    v-for="b in filteredBundles"
                    :key="b.bundleKey"
                    class="pve-pool-card"
                    :class="{
                        'pve-pool-card--selected': isBundleFullyOn(b),
                        'pve-pool-card--partial': isBundlePartiallyOn(b),
                    }"
                    draggable="true"
                    @click="$emit('toggle-bundle', b, !isBundleFullyOn(b))"
                    @dragstart="$emit('drag-start', 'bundle', b.bundleKey, $event)"
                    @dragend="$emit('drag-end')"
                >
                    <span class="pve-pool-grip" aria-hidden="true">
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                        >
                            <circle cx="9" cy="6" r="1.5" fill="currentColor" />
                            <circle cx="15" cy="6" r="1.5" fill="currentColor" />
                            <circle cx="9" cy="12" r="1.5" fill="currentColor" />
                            <circle cx="15" cy="12" r="1.5" fill="currentColor" />
                            <circle cx="9" cy="18" r="1.5" fill="currentColor" />
                            <circle cx="15" cy="18" r="1.5" fill="currentColor" />
                        </svg>
                    </span>
                    <div class="pve-pool-card-main">
                        <div class="pve-pool-card-row">
                            <span class="pve-pool-card-label">{{ b.label || b.bundleKey }}</span>
                            <span
                                v-if="isBundleFullyOn(b)"
                                class="pve-pool-card-check"
                                aria-hidden="true"
                            >
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="3"
                                >
                                    <path d="M5 13l4 4L19 7" />
                                </svg>
                            </span>
                        </div>
                        <div class="pve-pool-card-meta">
                            <code class="pve-pool-card-key">{{ b.bundleKey }}</code>
                            <span class="pve-pool-card-dot">·</span>
                            <span>{{ featureCount(b.features.length) }}</span>
                        </div>
                    </div>
                </div>
                <div v-if="filteredBundles.length === 0" class="pve-empty">
                    {{ msg.componentPool.emptyBundles }}
                </div>
            </template>
        </div>
    </section>
</template>

<script setup lang="ts">
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type {
    BundleEntry,
    DiscoveryQuota,
    FeatureGroup,
    PoolKind,
    PoolTab,
    PoolTabItem,
} from './types.js';

defineProps<{
    searchTerm: string;
    activeTab: PoolTab;
    poolTabs: PoolTabItem[];
    filteredFeatureGroups: FeatureGroup[];
    filteredQuotas: DiscoveryQuota[];
    filteredBundles: BundleEntry[];
    featureLabel: (key: string) => string;
    featureGroupLabel: (key: string) => string;
    isFeatureOn: (key: string) => boolean;
    isQuotaOn: (key: string) => boolean;
    isBundleFullyOn: (bundle: BundleEntry) => boolean;
    isBundlePartiallyOn: (bundle: BundleEntry) => boolean;
}>();

const emit = defineEmits<{
    (e: 'update:searchTerm', value: string): void;
    (e: 'update:activeTab', value: PoolTab): void;
    (e: 'toggle-feature', key: string, on: boolean): void;
    (e: 'pool-quota-click', quota: DiscoveryQuota): void;
    (e: 'toggle-bundle', bundle: BundleEntry, on: boolean): void;
    (e: 'drag-start', kind: PoolKind, key: string, event: DragEvent): void;
    (e: 'drag-end'): void;
}>();

const msg = useSaMessages('planEditor');

function featureCount(count: number): string {
    return formatMessage(msg.value.componentPool.featureCount, { count });
}

function updateSearchTerm(event: Event): void {
    emit('update:searchTerm', (event.target as HTMLInputElement | null)?.value ?? '');
}
</script>
