<template>
    <div class="sa-qc" :class="{ expanded, warn: !quota.usageProvider }">
        <div class="sa-qc__head" @click="emit('toggle')">
            <q-icon
                :name="quota.usageProvider ? 'inventory_2' : 'error'"
                :color="quota.usageProvider ? 'primary' : 'negative'"
                size="20px"
                class="sa-qc__icon"
            />
            <div class="sa-qc__main">
                <div class="sa-qc__titlerow">
                    <span class="sa-qc__label">{{ labelValue || quota.quotaKey }}</span>
                    <code class="sa-qc__key">{{ quota.quotaKey }}</code>
                    <span class="sa-chip">{{ quota.enforcementMode }}</span>
                    <span
                        v-if="quota.successorKey"
                        class="sa-qc__flag sa-qc__flag--succ"
                        :title="`ersetzt durch ${quota.successorKey}`"
                    >
                        ersetzt durch {{ quota.successorKey }}
                    </span>
                    <span
                        v-if="quota.replaces.length"
                        class="sa-qc__flag sa-qc__flag--repl"
                        :title="`ersetzt: ${quota.replaces.join(', ')}`"
                    >
                        ersetzt: {{ quota.replaces.join(', ') }}
                    </span>
                </div>
                <div class="sa-qc__sub">
                    Einheit <code>{{ quota.unit }}</code> · UsageProvider
                    <code v-if="quota.usageProvider">{{ quota.usageProvider }}</code>
                    <span v-else class="sa-qc__missing">fehlt</span>
                </div>
                <div v-if="!quota.usageProvider" class="sa-qc__warning">
                    Eine harte Quota ohne UsageProvider ist nicht deploy-fähig (Preflight, SPEC_V2
                    §6.3).
                </div>
            </div>

            <div class="sa-qc__coverage">
                <span
                    v-for="lng in targetLocales"
                    :key="lng"
                    class="sa-cov-pill"
                    :class="coverageClass(coverage(lng))"
                >
                    <span>{{ localeShort(lng) }}</span>
                    <span>{{ coveragePct(coverage(lng)) }}%</span>
                </span>
            </div>

            <DiscoveryStatusControl
                :status="quota.discoveryStatus"
                @set-status="(target) => emit('review', quota.quotaKey, target)"
            />
            <q-icon name="chevron_right" class="sa-qc__chev" :class="{ open: expanded }" />
        </div>

        <div v-if="expanded" class="sa-qc__body">
            <div v-if="quota.discoveryStatus === 'outdated'" class="sa-qc__banner">
                <q-icon name="warning" size="16px" />
                <span>
                    Die code-abgeleiteten Quota-Fakten (Einheit/Enforcement/Provider) haben sich
                    seit der letzten Freigabe geändert — bitte prüfen und <b>erneut freigeben</b>.
                </span>
            </div>
            <CatalogEntryTransPanel
                :entry="transEntry"
                :fields="['label', 'unit', 'description']"
                :active-locales="activeLocales"
                @update:base="onTransBase"
                @update:locale="
                    (locale, patch) => emit('quota-locale', quota.quotaKey, locale, patch)
                "
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import type {
    CatalogEntryI18nFields,
    DiscoveryStatus,
    QuotaCatalogEntryRow,
    UpdateCatalogEntryBaseData,
} from '@saasicat/types';
import CatalogEntryTransPanel from './CatalogEntryTransPanel.vue';
import DiscoveryStatusControl from './DiscoveryStatusControl.vue';
import {
    coverageClass,
    coveragePct,
    DISCOVERY_DEFAULT_LOCALE,
    entryCoverage,
    localeShort,
    type TransEntry,
} from './discovery-ui.js';

// Ausklappbare Quota-Karte (#20 Slice 1, Sim `QuotaRow`) — gleicher Lebens-
// zyklus wie Features. Body = Übersetzungen (label/unit/description); `unit`
// ist code-abgeleitet und nur pro Ziel-Locale übersetzbar.

const props = defineProps<{
    quota: QuotaCatalogEntryRow;
    activeLocales: string[];
    expanded: boolean;
}>();

const emit = defineEmits<{
    toggle: [];
    review: [key: string, target: DiscoveryStatus];
    'quota-base': [key: string, patch: UpdateCatalogEntryBaseData];
    'quota-locale': [key: string, locale: string, patch: CatalogEntryI18nFields];
}>();

// Draft-Puffer für das Header-Label — die Felder selbst puffert das
// CatalogEntryTransPanel; hier nur, damit der Titel beim Tippen mitzieht.
const drafts = reactive<{ label?: string }>({});
const labelValue = computed(() => drafts.label ?? props.quota.label ?? '');

/** Basis-Edits aus dem Übersetzungs-Panel spiegeln + nach oben reichen. */
function onTransBase(patch: { label?: string; description?: string }): void {
    if (patch.label !== undefined) drafts.label = patch.label;
    emit('quota-base', props.quota.quotaKey, patch);
}

const targetLocales = computed(() =>
    props.activeLocales.filter((l) => l !== DISCOVERY_DEFAULT_LOCALE),
);

const transEntry = computed<TransEntry>(() => ({
    key: props.quota.quotaKey,
    label: labelValue.value,
    description: props.quota.description,
    unit: props.quota.unit,
    i18n: props.quota.i18n ?? {},
}));

function coverage(locale: string): number {
    return entryCoverage(transEntry.value, locale, ['label', 'unit', 'description']);
}
</script>

<style scoped>
.sa-qc {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #fff;
    overflow: hidden;
}
.sa-qc.warn {
    border-color: #fecaca;
}
.sa-qc.expanded {
    border-color: #c7d2fe;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}
.sa-qc__head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    cursor: pointer;
}
.sa-qc.warn .sa-qc__head {
    background: #fef2f2;
}
.sa-qc__icon {
    flex-shrink: 0;
}
.sa-qc__main {
    flex: 1;
    min-width: 0;
}
.sa-qc__titlerow {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
}
.sa-qc__label {
    font-weight: 600;
    font-size: 13px;
    color: #0f172a;
}
.sa-qc__key {
    font-size: 11px;
}
.sa-qc__flag {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 5px;
}
.sa-qc__flag--succ {
    background: #fef3c7;
    color: #92400e;
}
.sa-qc__flag--repl {
    background: #dbeafe;
    color: #1e40af;
}
.sa-qc__sub {
    font-size: 11px;
    color: #64748b;
    margin-top: 2px;
}
.sa-qc__missing {
    color: #b91c1c;
    font-weight: 700;
}
.sa-qc__warning {
    font-size: 11px;
    color: #b91c1c;
    margin-top: 4px;
}
.sa-qc__coverage {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
}
.sa-qc__chev {
    color: #94a3b8;
    transition: transform 0.15s;
}
.sa-qc__chev.open {
    transform: rotate(90deg);
}
.sa-qc__body {
    border-top: 1px solid #f1f5f9;
    padding: 12px;
    background: #f8fafc;
}
.sa-qc__banner {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    border-radius: 8px;
    padding: 8px 12px;
    margin-bottom: 10px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
}
</style>
