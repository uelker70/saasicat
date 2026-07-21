<template>
    <div class="bv-vstrip">
        <div class="bv-vstrip-label">Versionen</div>
        <div class="bv-vstrip-tabs">
            <button
                v-for="v in sortedVersions"
                :key="v.id"
                type="button"
                class="bv-vtab"
                :class="[`bv-vtab-${statusOf(v)}`, { 'bv-vtab-current': v.id === modelValue }]"
                :title="BUNDLE_STATUS_META[statusOf(v)].tooltip"
                @click="$emit('update:modelValue', v.id)"
            >
                <span class="bv-vtab-name">v{{ v.version }}</span>
                <span :class="['bv-vtab-status', statusOf(v)]">
                    {{ BUNDLE_STATUS_META[statusOf(v)].label }}
                </span>
                <span class="bv-vtab-dates">
                    {{ formatDateDE(v.validFrom) }}
                    <template v-if="v.validUntil"> – {{ formatDateDE(v.validUntil) }}</template>
                    <template v-else> – offen</template>
                </span>
                <span class="bv-vtab-price">
                    {{ v.monthlyNet ?? '—' }}<template v-if="v.monthlyNet"> €</template> / Mo
                </span>
            </button>
            <button
                type="button"
                class="bv-vtab bv-vtab-new"
                :disabled="!canAddVersion"
                :title="
                    canAddVersion
                        ? 'Neue, zukünftige Version anlegen'
                        : 'Bundle hat bereits eine Draft-Version — erst publishen oder verwerfen'
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
                <span>Neue Version</span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BundleVersionRow } from '@saasicat/types';

import {
    BUNDLE_STATUS_META,
    bundleVersionStatus,
    bundleVersionsSorted,
    formatDateDE,
} from './bundle-version-status';

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

const sortedVersions = computed(() => bundleVersionsSorted(props.versions));

const canAddVersion = computed(() => !props.versions.some((v) => v.publishedAt === null));

function statusOf(v: BundleVersionRow) {
    return bundleVersionStatus(v, props.now);
}
</script>

<style scoped>
.bv-vstrip {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    background: #fbfbfd;
    border: 1px solid var(--bv-border, #e5e7eb);
    border-radius: 10px;
}
.bv-vstrip-label {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #64748b;
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
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
    color: #0f172a;
    text-align: left;
    transition:
        border-color 0.12s,
        box-shadow 0.12s,
        background 0.12s;
}
.bv-vtab:hover {
    background: #f8fafc;
}
.bv-vtab-current {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
}
.bv-vtab-name {
    font:
        700 13px 'JetBrains Mono',
        ui-monospace,
        monospace;
    letter-spacing: 0.02em;
}
.bv-vtab-status {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 4px;
    justify-self: end;
}
.bv-vtab-status.live {
    background: #d1fae5;
    color: #065f46;
}
.bv-vtab-status.scheduled {
    background: #fef3c7;
    color: #92400e;
}
.bv-vtab-status.superseded {
    background: #e2e8f0;
    color: #475569;
}
.bv-vtab-status.draft {
    background: #dbeafe;
    color: #1e40af;
}
.bv-vtab-dates {
    grid-column: 1 / -1;
    font-size: 11px;
    color: #64748b;
}
.bv-vtab-price {
    grid-column: 1 / -1;
    font-size: 11.5px;
    color: #475569;
    font-weight: 600;
}

.bv-vtab-new {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: #fff;
    border: 1px dashed #cbd5e1;
    color: #2563eb;
    font-size: 12.5px;
    font-weight: 600;
}
.bv-vtab-new:hover:not(:disabled) {
    background: #eff6ff;
    border-color: #93c5fd;
}
.bv-vtab-new:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
</style>
