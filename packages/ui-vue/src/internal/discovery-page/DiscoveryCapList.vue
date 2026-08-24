<template>
    <div v-if="capabilities.length === 0" class="sa-caps__empty">
        <q-icon name="warning" size="14px" />
        {{ msg.capList.orphanFeature }}
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
                        {{ msg.capList.removedFromCode }}
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
import type { CapabilityCatalogEntryRow } from '@saasicat/core';
import { kindStyle } from './discovery-ui.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// Read-only Capability list: code facts from the scan (#20). Embedded in the
// master-data subtab of the feature card as well as in the page's orphan bucket.

const props = defineProps<{
    capabilities: CapabilityCatalogEntryRow[];
    declaredAtByKey: Record<string, string>;
    /**
     * Baseline for the "new" flag — Capabilities with a later `createdAt`
     * count as new since the last feature approval (`approvedAt`).
     */
    newSince?: string | null;
}>();

const msg = useSaMessages('discovery');

function isNew(cap: CapabilityCatalogEntryRow): boolean {
    return Boolean(props.newSince && cap.createdAt > props.newSince);
}
</script>

<style scoped>
.sa-caps {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}
.sa-caps-row {
    display: flex;
    gap: var(--sa-space-3);
    align-items: flex-start;
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-3) var(--sa-space-3);
}
.sa-caps-row.dep {
    border-color: var(--sa-color-negative-border);
    background: var(--sa-color-negative-surface);
}
.sa-caps-row__kind {
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    text-transform: uppercase;
    padding: var(--sa-space-1) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
    border: 1px solid;
    flex-shrink: 0;
    margin-top: var(--sa-space-0);
}
.sa-caps-row__main {
    flex: 1;
    min-width: 0;
}
.sa-caps-row__titlerow {
    display: flex;
    gap: var(--sa-space-2);
    align-items: center;
    flex-wrap: wrap;
}
.sa-caps-row__key {
    font-size: var(--sa-text-xs);
    font-weight: 700;
}
.sa-caps-row__flag {
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    padding: var(--sa-space-0) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
}
.sa-caps-row__flag--new {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
.sa-caps-row__flag--exp {
    background: var(--sa-color-feature-surface);
    color: var(--sa-color-feature-fg);
}
.sa-caps-row__flag--dep {
    background: var(--sa-color-negative-surface-strong);
    color: var(--sa-color-negative-fg);
}
.sa-caps-row__flag--gone {
    background: var(--sa-color-border);
    color: var(--sa-color-fg-muted);
}
.sa-caps-row.gone {
    opacity: 0.6;
}
.sa-caps-row__meta {
    display: flex;
    gap: var(--sa-space-4);
    flex-wrap: wrap;
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-secondary);
    margin-top: var(--sa-space-0);
}
.sa-caps-row__meta code {
    font-size: var(--sa-text-2xs);
}
.sa-caps__empty {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
    font-size: var(--sa-text-xs);
    color: var(--sa-color-warning-fg);
    background: var(--sa-color-warning-surface);
    border: 1px dashed var(--sa-color-warning-border);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-3) var(--sa-space-4);
}
</style>
