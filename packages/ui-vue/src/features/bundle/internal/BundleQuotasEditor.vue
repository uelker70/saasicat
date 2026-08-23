<template>
    <div :class="['bd-quotas', { 'bd-locked': locked }]">
        <div
            v-for="q in availableQuotas"
            :key="q.quotaKey"
            class="bd-quota-row"
            :class="{
                on: q.quotaKey in quotas,
                overlap: overlapKeys.includes(q.quotaKey),
            }"
        >
            <button
                type="button"
                class="bd-quota-toggle"
                :disabled="locked"
                :title="
                    locked
                        ? msg.compatPicker.lockedTooltip
                        : q.quotaKey in quotas
                          ? msg.quotasEditor.removeTooltip
                          : msg.quotasEditor.addTooltip
                "
                @click="$emit('toggle', q.quotaKey)"
            >
                <span class="bd-quota-tick" aria-hidden="true">
                    <svg
                        v-if="q.quotaKey in quotas"
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                    >
                        <path d="M5 13l4 4L19 7" />
                    </svg>
                    <svg
                        v-else
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                </span>
            </button>
            <div class="bd-quota-main">
                <div class="bd-quota-label">{{ quotaLabel(q) }}</div>
                <div class="bd-quota-key">{{ q.quotaKey }}</div>
            </div>
            <div class="bd-quota-valwrap">
                <input
                    type="number"
                    class="bd-quota-val"
                    :value="quotas[q.quotaKey] ?? ''"
                    :disabled="!(q.quotaKey in quotas) || locked"
                    :placeholder="String(0)"
                    @input="
                        $emit(
                            'setValue',
                            q.quotaKey,
                            Number(($event.target as HTMLInputElement).value),
                        )
                    "
                />
                <span class="bd-quota-unit">{{ quotaUnit(q) }}</span>
            </div>
        </div>
        <div v-if="availableQuotas.length === 0" class="bd-quotas-empty">
            {{ msg.quotasEditor.empty }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DiscoveredQuota } from '@saasicat/core';
import type { QuotaMeta } from './catalog-i18n.js';
import { useSaMessages } from '../../../vue/use-super-admin-i18n.js';

// BundleQuotasEditor — toggle + numeric per Quota, against the discovery
// snapshot as a library (after plan simulation). `quotas[key]` is the
// configured amount; if the key is missing, the Quota is not in the bundle.
//
// `overlapKeys` marks Quotas that the selected compatible plan already
// carries — warn about double counting.
//
// `quotaRegistry` provides the label/unit resolved in the display locale
// (from the Quota catalog). If an entry is missing, the discovery value applies.

const props = defineProps<{
    availableQuotas: DiscoveredQuota[];
    quotas: Record<string, number>;
    locked?: boolean;
    overlapKeys?: string[];
    quotaRegistry?: Record<string, QuotaMeta>;
}>();

const msg = useSaMessages('bundles');

defineEmits<{
    (e: 'toggle', quotaKey: string): void;
    (e: 'setValue', quotaKey: string, value: number): void;
}>();

const overlapKeys = computed(() => props.overlapKeys ?? []);

function quotaLabel(q: DiscoveredQuota): string {
    return props.quotaRegistry?.[q.quotaKey]?.label ?? q.label ?? q.quotaKey;
}

function quotaUnit(q: DiscoveredQuota): string {
    return props.quotaRegistry?.[q.quotaKey]?.unit ?? q.unit;
}
</script>

<style scoped>
.bd-quotas {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}
.bd-quotas.bd-locked {
    opacity: 0.7;
}
.bd-quota-row {
    display: grid;
    grid-template-columns: 28px 1fr auto;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-3);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.bd-quota-row.on {
    background: var(--sa-color-quota-surface);
    border-color: var(--sa-color-quota-border);
}
.bd-quota-row.overlap {
    border-color: var(--sa-color-negative-border);
    background: var(--sa-color-negative-surface);
}
.bd-quota-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border-strong);
    border-radius: var(--sa-radius-badge);
    cursor: pointer;
    color: var(--sa-color-fg-secondary);
}
.bd-quota-row.on .bd-quota-toggle {
    background: var(--sa-color-accent);
    border-color: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
}
.bd-quota-toggle:disabled {
    cursor: not-allowed;
}
.bd-quota-tick {
    display: inline-flex;
}
.bd-quota-main {
    min-width: 0;
}
.bd-quota-label {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.bd-quota-key {
    font:
        500 var(--sa-text-xs) 'JetBrains Mono',
        ui-monospace,
        monospace;
    color: var(--sa-color-fg-subtle);
}
.bd-quota-valwrap {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
}
.bd-quota-val {
    width: 90px;
    padding: var(--sa-space-2) var(--sa-space-3);
    border: 1px solid var(--sa-color-border-strong);
    border-radius: var(--sa-radius-badge);
    font:
        600 var(--sa-text-md) 'JetBrains Mono',
        ui-monospace,
        monospace;
    text-align: right;
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-fg-heading);
}
.bd-quota-val:disabled {
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-subtle);
    cursor: not-allowed;
}
.bd-quota-unit {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    min-width: 32px;
}
.bd-quotas-empty {
    padding: var(--sa-space-4);
    color: var(--sa-color-fg-subtle);
    font-style: italic;
    font-size: var(--sa-text-md);
}
</style>
