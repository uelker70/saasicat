<template>
    <div v-if="capabilities.length === 0" class="sa-caps__empty">
        <q-icon name="warning" size="14px" />
        Feature im Katalog ohne implementierende Capability — blockiert im blocking-Strict-Mode das
        Plan-Publish.
    </div>
    <div v-else class="sa-caps">
        <div
            v-for="cap in capabilities"
            :key="cap.capabilityKey"
            class="sa-caps-row"
            :class="{ dep: cap.codeStatus === 'deprecated', gone: cap.codeStatus === 'retired' }"
        >
            <span class="sa-caps-row__kind" :style="kindStyle(cap.kind)">{{ cap.kind }}</span>
            <div class="sa-caps-row__main">
                <div class="sa-caps-row__titlerow">
                    <code class="sa-caps-row__key">{{ cap.capabilityKey }}</code>
                    <span v-if="isNew(cap)" class="sa-caps-row__flag sa-caps-row__flag--new">
                        neu
                    </span>
                    <span
                        v-if="cap.codeStatus === 'experimental'"
                        class="sa-caps-row__flag sa-caps-row__flag--exp"
                    >
                        experimental
                    </span>
                    <span
                        v-if="cap.codeStatus === 'deprecated'"
                        class="sa-caps-row__flag sa-caps-row__flag--dep"
                    >
                        deprecated
                        <template v-if="cap.replacementKey">
                            → <code>{{ cap.replacementKey }}</code>
                        </template>
                    </span>
                    <span
                        v-if="cap.codeStatus === 'retired'"
                        class="sa-caps-row__flag sa-caps-row__flag--gone"
                    >
                        aus Code entfernt
                    </span>
                </div>
                <div class="sa-caps-row__meta">
                    <span v-if="cap.label">{{ cap.label }}</span>
                    <span v-if="declaredAtByKey[cap.capabilityKey]">
                        <span class="sa-muted">impl</span>
                        <code>{{ declaredAtByKey[cap.capabilityKey] }}</code>
                    </span>
                    <span v-if="cap.owner">
                        <span class="sa-muted">Owner</span>
                        <code>{{ cap.owner }}</code>
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { CapabilityCatalogEntryRow } from '@saasicat/types';
import { kindStyle } from './discovery-ui.js';

// Read-only Capability-Liste: Code-Fakten aus dem Scan (#20). Eingebettet im
// Stammdaten-Subtab der Feature-Karte sowie im Orphan-Bucket der Seite.

const props = defineProps<{
    capabilities: CapabilityCatalogEntryRow[];
    declaredAtByKey: Record<string, string>;
    /**
     * Baseline für das „neu"-Flag — Capabilities mit `createdAt` danach
     * gelten als neu seit der letzten Feature-Freigabe (`approvedAt`).
     */
    newSince?: string | null;
}>();

function isNew(cap: CapabilityCatalogEntryRow): boolean {
    return Boolean(props.newSince && cap.createdAt > props.newSince);
}
</script>

<style scoped>
.sa-caps {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.sa-caps-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px 10px;
}
.sa-caps-row.dep {
    border-color: #fecaca;
    background: #fef2f2;
}
.sa-caps-row__kind {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 5px;
    border: 1px solid;
    flex-shrink: 0;
    margin-top: 1px;
}
.sa-caps-row__main {
    flex: 1;
    min-width: 0;
}
.sa-caps-row__titlerow {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
}
.sa-caps-row__key {
    font-size: 11px;
    font-weight: 700;
}
.sa-caps-row__flag {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 4px;
}
.sa-caps-row__flag--new {
    background: #fef3c7;
    color: #92400e;
}
.sa-caps-row__flag--exp {
    background: #ede9fe;
    color: #6d28d9;
}
.sa-caps-row__flag--dep {
    background: #fee2e2;
    color: #b91c1c;
}
.sa-caps-row__flag--gone {
    background: #e2e8f0;
    color: #64748b;
}
.sa-caps-row.gone {
    opacity: 0.6;
}
.sa-caps-row__meta {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 11px;
    color: #475569;
    margin-top: 1px;
}
.sa-caps-row__meta code {
    font-size: 10px;
}
.sa-caps__empty {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #b45309;
    background: #fffbeb;
    border: 1px dashed #fde68a;
    border-radius: 8px;
    padding: 10px 12px;
}
</style>
