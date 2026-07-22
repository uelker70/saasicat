<template>
    <header class="sa-pv-header">
        <div class="sa-pv-header__row">
            <div class="sa-pv-header__col">
                <div class="sa-pv-header__chips">
                    <span class="sa-pv-header__label">{{ snapshot.label }}</span>
                    <PlanVersionStatusBadge :status="snapshot.status" />
                    <template v-if="compareSnapshot">
                        <q-icon name="compare_arrows" size="16px" class="sa-pv-header__cmp-icon" />
                        <span class="sa-pv-header__label sa-pv-header__label--cmp">{{
                            compareSnapshot.label
                        }}</span>
                        <button
                            type="button"
                            class="sa-pv-header__cmp-btn"
                            @click="emit('clearCompare')"
                        >
                            <q-icon name="close" size="14px" /> {{ msg.compareEnd }}
                        </button>
                    </template>
                </div>
                <h1 class="sa-pv-header__title">{{ snapshot.title }}</h1>
                <p class="sa-pv-header__desc">{{ snapshot.description }}</p>

                <div class="sa-pv-header__meta">
                    <span
                        v-if="snapshot.publishedAt"
                        class="sa-pv-header__meta-item sa-pv-header__meta-item--ok"
                    >
                        <q-icon name="rocket_launch" size="14px" />
                        {{ publishedOnLabel }}
                    </span>
                    <span
                        v-if="snapshot.kind === 'drafts'"
                        class="sa-pv-header__meta-item sa-pv-header__meta-item--warn"
                    >
                        <q-icon name="edit_note" size="14px" />
                        <strong>{{ snapshot.draftCount }}</strong> {{ msg.header.openDrafts }}
                    </span>
                    <span
                        v-if="snapshot.regressionCount > 0"
                        class="sa-pv-header__meta-item sa-pv-header__meta-item--bad"
                    >
                        <q-icon name="trending_down" size="14px" />
                        <strong>{{ snapshot.regressionCount }}</strong> {{ regressionLabel }}
                    </span>
                </div>
            </div>

            <div class="sa-pv-header__actions">
                <button
                    v-if="canPublish"
                    type="button"
                    class="sa-pv-header__publish"
                    @click="emit('publish')"
                >
                    <q-icon name="rocket_launch" size="16px" />
                    {{ msg.header.startPublishFlow }}
                </button>
            </div>
        </div>

        <div class="sa-pv-header__view-row">
            <div
                class="sa-pv-header__switcher"
                :class="{ 'sa-pv-header__switcher--disabled': !!compareSnapshot }"
            >
                <button
                    v-for="m in resolvedModes"
                    :key="m.id"
                    type="button"
                    class="sa-pv-header__mode-btn"
                    :class="{ 'sa-pv-header__mode-btn--active': viewMode === m.id }"
                    @click="emit('viewChange', m.id)"
                >
                    <q-icon :name="m.icon" size="14px" />
                    {{ m.label }}
                </button>
            </div>
            <span v-if="compareSnapshot" class="sa-pv-header__cmp-hint">
                <q-icon name="compare_arrows" size="13px" />
                {{ msg.header.compareModeHint }}
            </span>
        </div>
    </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CatalogSnapshot } from '../../client/plan-versions-catalog.js';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import { formatDate } from './format.js';
import PlanVersionStatusBadge from './PlanVersionStatusBadge.vue';
import type { PlanVersionViewMode } from './types.js';

const props = defineProps<{
    snapshot: CatalogSnapshot;
    viewMode: PlanVersionViewMode;
    compareSnapshot: CatalogSnapshot | null;
    /** Overrides the localized default view switcher. */
    modes?: ReadonlyArray<{ id: PlanVersionViewMode; label: string; icon: string }>;
}>();

const emit = defineEmits<{
    (e: 'viewChange', mode: PlanVersionViewMode): void;
    (e: 'publish'): void;
    (e: 'clearCompare'): void;
}>();

const msg = useSaMessages('planVersions');
const { locale } = useSuperAdminI18n();

const canPublish = computed(
    () => props.snapshot.kind === 'drafts' && props.snapshot.draftCount > 0,
);

const publishedOnLabel = computed(() =>
    formatMessage(msg.value.header.publishedOn, {
        date: formatDate(props.snapshot.publishedAt ?? undefined, locale.value),
    }),
);

const regressionLabel = computed(() =>
    props.snapshot.regressionCount === 1
        ? msg.value.header.regressionOne
        : msg.value.header.regressionMany,
);

const resolvedModes = computed(
    () =>
        props.modes ?? [
            { id: 'list' as const, label: msg.value.header.modeList, icon: 'list' },
            { id: 'matrix' as const, label: msg.value.header.modeMatrix, icon: 'grid_view' },
            { id: 'audit' as const, label: msg.value.header.modeAudit, icon: 'history' },
        ],
);
</script>

<style scoped>
.sa-pv-header {
    padding: 20px 28px 18px;
    border-bottom: 1px solid var(--sa-border, #e2e8f0);
    background: var(--sa-bg-surface, #ffffff);
}
.sa-pv-header__row {
    display: flex;
    align-items: flex-start;
    gap: 20px;
}
.sa-pv-header__col {
    flex: 1;
    min-width: 0;
}
.sa-pv-header__chips {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
    flex-wrap: wrap;
}
.sa-pv-header__label {
    font-family: var(--sa-font-mono, ui-monospace, monospace);
    font-size: 13px;
    font-weight: 700;
    color: var(--sa-heading, #0f172a);
    background: #f1f5f9;
    padding: 3px 10px;
    border-radius: 6px;
}
.sa-pv-header__label--cmp {
    background: #fef3c7;
}
.sa-pv-header__cmp-icon {
    color: var(--sa-muted, #64748b);
}
.sa-pv-header__cmp-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--sa-muted, #64748b);
    font-size: 11px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.sa-pv-header__title {
    margin: 0;
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 22px;
    color: var(--sa-heading, #0f172a);
    letter-spacing: -0.01em;
}
.sa-pv-header__desc {
    margin: 6px 0 0;
    color: var(--sa-muted-dark, #475569);
    font-size: 13.5px;
    line-height: 1.55;
    max-width: 760px;
}

.sa-pv-header__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: 14px;
    font-size: 12px;
    color: var(--sa-muted, #64748b);
}
.sa-pv-header__meta-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}
.sa-pv-header__meta-item strong {
    color: var(--sa-body, #1e293b);
    font-weight: 600;
}
.sa-pv-header__meta-item--ok :deep(.q-icon) {
    color: var(--sa-positive, #047857);
}
.sa-pv-header__meta-item--warn :deep(.q-icon) {
    color: var(--sa-warning, #b45309);
}
.sa-pv-header__meta-item--bad :deep(.q-icon) {
    color: var(--sa-negative, #dc2626);
}
.sa-pv-header__meta-item--bad strong {
    color: var(--sa-negative, #dc2626);
}

.sa-pv-header__actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
}
.sa-pv-header__publish {
    background: var(--sa-primary, #3f6bff);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 1px 3px rgba(63, 107, 255, 0.3);
}

.sa-pv-header__view-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 18px;
    flex-wrap: wrap;
}
.sa-pv-header__switcher {
    display: inline-flex;
    background: #f1f5f9;
    padding: 3px;
    border-radius: 9px;
}
.sa-pv-header__switcher--disabled {
    opacity: 0.5;
    pointer-events: none;
}
.sa-pv-header__mode-btn {
    background: transparent;
    color: var(--sa-body, #1e293b);
    border: none;
    border-radius: 7px;
    padding: 6px 12px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
}
.sa-pv-header__mode-btn :deep(.q-icon) {
    color: var(--sa-muted, #64748b);
}
.sa-pv-header__mode-btn--active {
    background: #fff;
    color: var(--sa-primary, #3f6bff);
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
}
.sa-pv-header__mode-btn--active :deep(.q-icon) {
    color: var(--sa-primary, #3f6bff);
}

.sa-pv-header__cmp-hint {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--sa-warning, #b45309);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--sa-warning-soft, rgba(245, 158, 11, 0.1));
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--sa-amber-border, rgba(245, 158, 11, 0.3));
}
</style>
