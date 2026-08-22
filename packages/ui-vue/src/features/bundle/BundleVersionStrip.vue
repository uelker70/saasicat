<template>
    <div class="bv-vstrip">
        <div class="bv-vstrip-label">{{ msg.versionStrip.label }}</div>
        <div class="bv-vstrip-tabs">
            <button
                v-for="v in sortedVersions"
                :key="v.id"
                type="button"
                class="bv-vtab"
                :class="[`bv-vtab-${statusOf(v)}`, { 'bv-vtab-current': v.id === modelValue }]"
                :title="statusMetaOf(v).tooltip"
                @click="$emit('update:modelValue', v.id)"
            >
                <span class="bv-vtab-name">v{{ v.version }}</span>
                <span :class="['bv-vtab-status', statusOf(v)]">
                    {{ statusMetaOf(v).label }}
                </span>
                <span class="bv-vtab-dates">
                    {{ formatDate(v.validFrom, locale) }}
                    <template v-if="v.validUntil">
                        – {{ formatDate(v.validUntil, locale) }}</template
                    >
                    <template v-else> – {{ msg.fields.validUntilOpen }}</template>
                </span>
                <span class="bv-vtab-price">
                    {{ v.monthlyNet ?? '—' }}<template v-if="v.monthlyNet"> €</template>
                    {{ msg.versionStrip.perMonth }}
                </span>
            </button>
            <button
                type="button"
                class="bv-vtab bv-vtab-new"
                :disabled="!canAddVersion"
                :title="
                    canAddVersion
                        ? msg.versionStrip.addTooltip
                        : msg.versionStrip.addDisabledTooltip
                "
                @click="$emit('addVersion')"
            >
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{{ msg.versionStrip.addVersion }}</span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BundleVersionRow } from '@saasicat/types';

import {
    bundleStatusMeta,
    bundleVersionStatus,
    bundleVersionsSorted,
    formatDate,
    type BundleStatusMeta,
} from './internal/bundle-version-status';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// BundleVersionStrip — tab bar across all versions of a bundle, modeled on
// the plan simulation (saasadminui/project/bundles.jsx → BundleVersionStrip).
// Shows per tab: version number, status chip, validity span,
// monthly price. "New version" button on the far right; disabled when a
// draft already exists (single-draft constraint of the BundleRepository).

const props = defineProps<{
    /** All versions of the bundle (all lifecycle statuses). */
    versions: BundleVersionRow[];
    /** ID of the currently selected version. */
    modelValue: string | null;
    /** Optional: reference point in time for the status check (tests). */
    now?: Date;
}>();

defineEmits<{
    (e: 'update:modelValue', versionId: string): void;
    (e: 'addVersion'): void;
}>();

const msg = useSaMessages('bundles');
const { locale } = useSuperAdminI18n();

const sortedVersions = computed(() => bundleVersionsSorted(props.versions));

const canAddVersion = computed(() => !props.versions.some((v) => v.publishedAt === null));

function statusOf(v: BundleVersionRow) {
    return bundleVersionStatus(v, props.now);
}

function statusMetaOf(v: BundleVersionRow): BundleStatusMeta {
    return bundleStatusMeta(statusOf(v), msg.value);
}
</script>

<style scoped>
.bv-vstrip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    background: var(--sa-color-bg-surface-raised);
    border: 1px solid var(--bv-border, var(--sa-color-border));
    border-radius: 10px;
}
.bv-vstrip-label {
    font-size: var(--sa-text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--sa-color-fg-muted);
}
.bv-vstrip-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.bv-vtab {
    display: grid;
    grid-template-columns: auto auto;
    grid-template-rows: auto auto;
    column-gap: 8px;
    row-gap: 2px;
    align-items: center;
    padding: 8px 12px;
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
    color: var(--sa-color-fg-heading);
    text-align: left;
    transition:
        border-color 0.12s,
        box-shadow 0.12s,
        background 0.12s;
}
.bv-vtab:hover {
    background: var(--sa-color-bg-sunken);
}
.bv-vtab-current {
    border-color: var(--sa-color-accent);
    box-shadow: 0 0 0 2px var(--sa-shadow-tint-3);
}
.bv-vtab-name {
    font:
        700 var(--sa-text-md) 'JetBrains Mono',
        ui-monospace,
        monospace;
    letter-spacing: 0.02em;
}
.bv-vtab-status {
    font-size: var(--sa-text-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 4px;
    justify-self: end;
}
.bv-vtab-status.live {
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
}
.bv-vtab-status.scheduled {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
.bv-vtab-status.superseded {
    background: var(--sa-color-border);
    color: var(--sa-color-fg-secondary);
}
.bv-vtab-status.draft {
    background: var(--sa-color-info-surface-strong);
    color: var(--sa-color-info-fg);
}
.bv-vtab-dates {
    grid-column: 1 / -1;
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
}
.bv-vtab-price {
    grid-column: 1 / -1;
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
    font-weight: 600;
}

.bv-vtab-new {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--sa-color-bg-surface);
    border: 1px dashed var(--sa-color-border-strong);
    color: var(--sa-color-accent);
    font-size: var(--sa-text-md);
    font-weight: 600;
}
.bv-vtab-new:hover:not(:disabled) {
    background: var(--sa-color-accent-surface-strong);
    border-color: var(--sa-color-info-border);
}
.bv-vtab-new:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
</style>
