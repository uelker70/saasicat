<template>
    <q-card-section>
        <div class="sp-plan-section__usage-title">{{ i18n.featuresOverviewTitle }}</div>
        <ul class="sp-feature-matrix">
            <li
                v-for="f in features"
                :key="f.key"
                class="sp-feature-matrix__row"
                :class="{ 'sp-feature-matrix__row--locked': !f.active }"
            >
                <q-icon
                    :name="f.active ? 'check_circle' : 'lock'"
                    :color="f.active ? 'positive' : 'grey-5'"
                    size="20px"
                    class="sp-feature-matrix__status"
                />
                <div class="sp-feature-matrix__text">
                    <div class="sp-feature-matrix__label">
                        <q-icon v-if="f.icon" :name="f.icon" size="16px" class="q-mr-xs" />
                        {{ f.label }}
                        <q-badge
                            v-if="!f.active"
                            color="grey-4"
                            text-color="grey-9"
                            :label="i18n.featuresLocked"
                            class="q-ml-sm"
                        />
                    </div>
                    <div v-if="f.description" class="sp-feature-matrix__desc">
                        {{ f.description }}
                    </div>
                </div>
            </li>
        </ul>
    </q-card-section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTenantI18n } from '../tenant-i18n.js';
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

interface FeatureRow {
    key: string;
    active: boolean;
    label: string;
    description: string | null;
    icon: string | null;
}

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
.sp-feature-matrix__label {
    font-weight: 500;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
}
.sp-feature-matrix__desc {
    font-size: var(--sa-text-sm);
    color: var(--sp-text-muted, var(--sa-color-fg-muted));
    margin-top: var(--sa-space-1);
}
</style>
