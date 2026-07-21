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
                        ? 'Live-Version ist read-only'
                        : q.quotaKey in quotas
                          ? 'Quota entfernen'
                          : 'Quota aufnehmen'
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
            Keine Quotas im Discovery-Snapshot.
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DiscoveredQuota } from '@saasicat/types';
import type { QuotaMeta } from './catalog-i18n.js';

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
    gap: 6px;
}
.bd-quotas.bd-locked {
    opacity: 0.7;
}
.bd-quota-row {
    display: grid;
    grid-template-columns: 28px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    transition:
        background 0.12s,
        border-color 0.12s;
}
.bd-quota-row.on {
    background: #f0f9ff;
    border-color: #bae6fd;
}
.bd-quota-row.overlap {
    border-color: #fecaca;
    background: #fef2f2;
}
.bd-quota-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    cursor: pointer;
    color: #475569;
}
.bd-quota-row.on .bd-quota-toggle {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
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
    font-size: 13px;
    font-weight: 600;
    color: #0f172a;
}
.bd-quota-key {
    font:
        500 10.5px 'JetBrains Mono',
        ui-monospace,
        monospace;
    color: #94a3b8;
}
.bd-quota-valwrap {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.bd-quota-val {
    width: 90px;
    padding: 5px 8px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font:
        600 13px 'JetBrains Mono',
        ui-monospace,
        monospace;
    text-align: right;
    background: #fff;
    color: #0f172a;
}
.bd-quota-val:disabled {
    background: #f1f5f9;
    color: #94a3b8;
    cursor: not-allowed;
}
.bd-quota-unit {
    font-size: 11.5px;
    color: #64748b;
    min-width: 32px;
}
.bd-quotas-empty {
    padding: 12px;
    color: #94a3b8;
    font-style: italic;
    font-size: 12.5px;
}
</style>
