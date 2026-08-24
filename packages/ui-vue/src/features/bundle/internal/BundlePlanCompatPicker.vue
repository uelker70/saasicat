<template>
    <div class="bv-compat">
        <div class="bv-compat-hint">{{ msg.compatPicker.hint }}</div>
        <div class="bv-compat-grid">
            <!-- @optionSurface
                 A compatibility card — a heading, a body and a state in one clickable
                 surface. Quasar has no component for a card that is also a control. -->
            <button
                v-for="entry in entries"
                :key="entry.plan.planKey"
                type="button"
                class="bv-compat-card"
                :class="{
                    on: selectedKeys.includes(entry.plan.planKey),
                    warn: showOverlap(entry),
                }"
                :disabled="locked"
                :title="
                    locked
                        ? msg.compatPicker.lockedTooltip
                        : selectedKeys.includes(entry.plan.planKey)
                          ? msg.compatPicker.removeTooltip
                          : msg.compatPicker.addTooltip
                "
                @click="onToggle(entry.plan.planKey)"
            >
                <div class="bv-compat-head">
                    <span class="bv-compat-mark">{{ entry.plan.planKey.slice(0, 3) }}</span>
                    <div class="bv-compat-body">
                        <div class="bv-compat-name">{{ entry.plan.label }}</div>
                        <div class="bv-compat-key">{{ entry.plan.planKey }}</div>
                    </div>
                    <span
                        v-if="selectedKeys.includes(entry.plan.planKey)"
                        class="bv-compat-check"
                        aria-hidden="true"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="3"
                        >
                            <path d="M5 13l4 4L19 7" />
                        </svg>
                    </span>
                </div>
                <div v-if="showOverlap(entry)" class="bv-compat-overlap">
                    <div class="bv-compat-overlap-head">{{ msg.compatPicker.overlapHead }}</div>
                    <div v-if="entry.overlap.features.length > 0" class="bv-compat-overlap-list">
                        <span class="bv-compat-overlap-kind">
                            {{ msg.compatPicker.overlapFeatures }}
                        </span>
                        <span
                            v-for="fk in entry.overlap.features"
                            :key="fk"
                            class="bv-compat-overlap-chip"
                        >
                            {{ featureLabel(fk) }}
                        </span>
                    </div>
                    <div v-if="entry.overlap.quotas.length > 0" class="bv-compat-overlap-list">
                        <span class="bv-compat-overlap-kind">
                            {{ msg.compatPicker.overlapQuotas }}
                        </span>
                        <span
                            v-for="qk in entry.overlap.quotas"
                            :key="qk"
                            class="bv-compat-overlap-chip"
                        >
                            {{ quotaLabel(qk) }}
                        </span>
                    </div>
                </div>
            </button>
            <div v-if="plans.length === 0" class="bv-compat-empty">
                {{ msg.compatPicker.empty }}
            </div>
        </div>
        <div v-if="overlapCount > 0" class="bv-compat-summary">
            <span class="bv-compat-summary-ico">⚠</span>
            <span>
                <b>{{ overlapCount }}</b>
                {{
                    overlapCount === 1 ? msg.compatPicker.summaryOne : msg.compatPicker.summaryMany
                }}
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DiscoveredQuota, PlanRow, PlanVersionRow } from '@saasicat/core';

import { findBundlePlanOverlap, type BundlePlanOverlap } from './bundle-version-status';

import type { FeatureMeta } from './BundleFeaturesEditor.vue';
import type { QuotaMeta } from './catalog-i18n.js';
import { useSaMessages } from '../../../vue/use-super-admin-i18n.js';

// BundlePlanCompatPicker — multi-select of the plans this bundle may be
// booked with as an add-on (plan-bundle visibility, after plan
// simulation). For each selected plan the feature/quota overlap is
// computed live and shown as a warning.
//
// Note P11.7.4: the selection is currently persisted to
// `BundleVersionRow.compatibility` (the field exists in the type)
// — a dedicated `bundle_plans` junction will come in its own
// phase.

interface CompatEntry {
    plan: PlanRow;
    overlap: BundlePlanOverlap;
}

const props = defineProps<{
    /** Plan master records from the consumer wrapper. */
    plans: PlanRow[];
    /** Live (or latest) PlanVersion per planKey — overlap source. */
    livePlanVersions?: Record<string, PlanVersionRow | null>;
    /** Features/quotas of the current BundleVersion (for overlap computation). */
    bundleFeatures: string[];
    bundleQuotas: Record<string, number>;
    /** Currently selected plan keys. */
    selectedKeys: string[];
    locked?: boolean;
    /** For overlap chip labels. */
    featureRegistry?: Record<string, FeatureMeta>;
    availableQuotas?: DiscoveredQuota[];
    /** Quota labels resolved in the display locale (from the quota catalog). */
    quotaRegistry?: Record<string, QuotaMeta>;
}>();

const emit = defineEmits<{
    (e: 'toggle', planKey: string): void;
}>();

const msg = useSaMessages('bundles');

const entries = computed<CompatEntry[]>(() =>
    props.plans.map((plan) => ({
        plan,
        overlap: findBundlePlanOverlap(
            { features: props.bundleFeatures, quotas: props.bundleQuotas },
            props.livePlanVersions?.[plan.planKey] ?? null,
        ),
    })),
);

const overlapCount = computed(
    () =>
        entries.value.filter((e) => props.selectedKeys.includes(e.plan.planKey) && e.overlap.hasAny)
            .length,
);

function showOverlap(entry: CompatEntry): boolean {
    return props.selectedKeys.includes(entry.plan.planKey) && entry.overlap.hasAny;
}

function featureLabel(key: string): string {
    return props.featureRegistry?.[key]?.label ?? key;
}

function quotaLabel(key: string): string {
    return (
        props.quotaRegistry?.[key]?.label ??
        props.availableQuotas?.find((q) => q.quotaKey === key)?.label ??
        key
    );
}

function onToggle(planKey: string): void {
    if (props.locked) return;
    emit('toggle', planKey);
}
</script>

<style scoped>
.bv-compat {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.bv-compat-hint {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    line-height: 1.5;
}
.bv-compat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--sa-space-3);
}
.bv-compat-card {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
    padding: var(--sa-space-3) var(--sa-space-4);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    color: var(--sa-color-fg-heading);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.bv-compat-card:hover:not(:disabled) {
    background: var(--sa-color-bg-sunken);
}
.bv-compat-card.on {
    border-color: var(--sa-color-accent);
    background: var(--sa-color-accent-surface-strong);
}
.bv-compat-card.warn {
    border-color: var(--sa-color-negative-border);
    background: var(--sa-color-negative-surface);
}
.bv-compat-card:disabled {
    cursor: not-allowed;
    opacity: 0.7;
}
.bv-compat-head {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
}
.bv-compat-mark {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    background: var(--sa-color-scheduled-surface-strong);
    color: var(--sa-color-scheduled-fg);
    border: 1px solid var(--sa-color-scheduled-border);
    border-radius: var(--sa-radius-badge);
    font:
        700 var(--sa-text-2xs) 'JetBrains Mono',
        ui-monospace,
        monospace;
    letter-spacing: var(--sa-tracking-wide);
    flex: 0 0 auto;
}
.bv-compat-body {
    flex: 1;
    min-width: 0;
}
.bv-compat-name {
    font-size: var(--sa-text-md);
    font-weight: 600;
}
.bv-compat-key {
    font:
        500 var(--sa-text-xs) 'JetBrains Mono',
        ui-monospace,
        monospace;
    color: var(--sa-color-fg-muted);
}
.bv-compat-check {
    color: var(--sa-color-accent);
    display: inline-flex;
}
.bv-compat-overlap {
    padding: var(--sa-space-2) var(--sa-space-3);
    background: var(--sa-color-bg-surface);
    border: 1px dashed var(--sa-color-negative-border);
    border-radius: var(--sa-radius-badge);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
    color: var(--sa-color-negative-fg);
}
.bv-compat-overlap-head {
    font-size: var(--sa-text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
}
.bv-compat-overlap-list {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
    flex-wrap: wrap;
    font-size: var(--sa-text-sm);
}
.bv-compat-overlap-kind {
    color: var(--sa-color-negative-fg);
    font-weight: 600;
}
.bv-compat-overlap-chip {
    padding: var(--sa-space-0) var(--sa-space-2);
    border: 1px solid var(--sa-color-negative-border);
    border-radius: var(--sa-radius-badge);
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-negative-fg);
}
.bv-compat-empty {
    padding: var(--sa-space-4);
    color: var(--sa-color-fg-subtle);
    font-style: italic;
    font-size: var(--sa-text-md);
    text-align: center;
}
.bv-compat-summary {
    display: flex;
    align-items: flex-start;
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-4);
    background: var(--sa-color-negative-surface);
    border: 1px solid var(--sa-color-negative-border);
    border-radius: var(--sa-radius-field);
    color: var(--sa-color-negative-fg);
    font-size: var(--sa-text-md);
    line-height: 1.5;
}
.bv-compat-summary-ico {
    font-weight: 700;
}
</style>
