<template>
    <TenantCardSection>
        <div class="sp-plan-section__usage-title">{{ i18n.featuresOverviewTitle }}</div>
        <ul class="sp-feature-matrix">
            <li
                v-for="f in features"
                :key="f.key"
                class="sp-feature-matrix__row"
                :class="{ 'sp-feature-matrix__row--locked': !f.active }"
            >
                <svg
                    class="sp-feature-matrix__status"
                    :class="`sp-feature-matrix__status--${f.active ? 'on' : 'off'}`"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                >
                    <template v-if="f.active">
                        <circle cx="12" cy="12" r="9" />
                        <path d="m8 12 3 3 5-6" />
                    </template>
                    <template v-else>
                        <rect x="5" y="11" width="14" height="9" rx="2" />
                        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </template>
                </svg>
                <div class="sp-feature-matrix__text">
                    <div class="sp-feature-matrix__label">
                        <!-- The registry's `icon` is a Quasar icon name — the
                             host's iconography, not ours, and rendering it
                             needs the host's icon font. A slot lets the host
                             draw its own; an absent slot draws nothing rather
                             than the word `directions_car`. -->
                        <slot name="feature-icon" :feature="f"></slot>
                        {{ f.label }}
                        <span v-if="!f.active" class="sp-badge sp-badge--neutral">
                            {{ i18n.featuresLocked }}
                        </span>
                    </div>
                    <div v-if="f.description" class="sp-feature-matrix__desc">
                        {{ f.description }}
                    </div>
                </div>
            </li>
        </ul>
    </TenantCardSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTenantI18n } from '../tenant-i18n.js';
import type { FeatureRow } from './feature-row.js';
import TenantCardSection from '../ui/TenantCardSection.vue';
import '../ui/tenant-ui.css';
import type { FeatureUiRegistry } from '@saasicat/core';
import { useSuperAdminI18n } from '@saasicat/ui-vue';

// TenantFeatureMatrix — complete feature-scope overview (#18):
// all known features, split into included/locked, with translation
// from the feature registry (fallback: featureLabel hook → key).

const i18n = useTenantI18n();

const props = defineProps<{
    /** Feature registry (label/description/icon per FeatureKey). */
    featureRegistry: FeatureUiRegistry | null;
    /** FeatureKeys unlocked in the current plan. */
    activeFeatures: string[];
    /** Fallback label if the registry does not know the key. */
    featureLabel: (key: string) => string;
}>();

const { intlLocale } = useSuperAdminI18n();

const features = computed<FeatureRow[]>(() => {
    const registry = props.featureRegistry ?? {};
    const active = new Set(props.activeFeatures);
    // Union: all registry keys + all active keys (in case an active
    // feature is exceptionally not present in the registry).
    const keys = new Set<string>([...Object.keys(registry), ...props.activeFeatures]);
    const rows: FeatureRow[] = [...keys].map((key) => {
        const meta = registry[key];
        return {
            key,
            active: active.has(key),
            label: meta?.label ?? props.featureLabel(key),
            description: meta?.description ?? null,
            icon: meta?.icon ?? null,
        };
    });
    // Included first, then alphabetically by label.
    return rows.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.label.localeCompare(b.label, intlLocale.value);
    });
});
</script>

<style scoped>
.sp-feature-matrix {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--sa-space-3) var(--sa-space-7);
}
.sp-feature-matrix__row {
    display: flex;
    gap: var(--sa-space-3);
    align-items: flex-start;
    padding: var(--sa-space-2) 0;
}
.sp-feature-matrix__row--locked {
    opacity: 0.6;
}
.sp-feature-matrix__status {
    margin-top: var(--sa-space-0);
    flex: 0 0 auto;
}
.sp-feature-matrix__status--on {
    color: var(--sa-color-positive);
}
.sp-feature-matrix__status--off {
    color: var(--sa-color-fg-muted);
}
.sp-feature-matrix__label {
    font-weight: 500;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--sa-space-2);
}
.sp-feature-matrix__desc {
    font-size: var(--sa-text-sm);
    color: var(--sp-text-muted, var(--sa-color-fg-muted));
    margin-top: var(--sa-space-1);
}
</style>
