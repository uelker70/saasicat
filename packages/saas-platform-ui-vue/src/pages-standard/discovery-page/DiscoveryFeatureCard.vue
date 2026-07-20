<template>
    <div class="sa-fc" :class="{ expanded }">
        <div class="sa-fc__head" @click="emit('toggle')">
            <q-icon :name="iconValue || 'help_outline'" size="22px" class="sa-fc__icon" />
            <div class="sa-fc__main">
                <div class="sa-fc__titlerow">
                    <code class="sa-fc__key">{{ feature.featureKey }}</code>
                    <span class="sa-fc__label">{{ labelValue || feature.featureKey }}</span>
                    <span v-if="newCapsCount > 0" class="sa-fc__flag sa-fc__flag--new">
                        {{ newCapsCount }} neu
                    </span>
                    <span v-if="deprecatedCapsCount > 0" class="sa-fc__flag sa-fc__flag--dep">
                        {{ deprecatedCapsCount }} deprecated
                    </span>
                    <span
                        v-if="feature.successorKey"
                        class="sa-fc__flag sa-fc__flag--succ"
                        :title="`ersetzt durch ${feature.successorKey}`"
                    >
                        ersetzt durch {{ feature.successorKey }}
                    </span>
                    <span
                        v-if="feature.replaces.length"
                        class="sa-fc__flag sa-fc__flag--repl"
                        :title="`ersetzt: ${feature.replaces.join(', ')}`"
                    >
                        ersetzt: {{ feature.replaces.join(', ') }}
                    </span>
                </div>
                <div class="sa-fc__sub">
                    <template v-if="owners.length">
                        <span class="sa-muted">Owner</span>
                        {{ owners.join(', ') }}
                        <span class="sa-fc__dot">·</span>
                    </template>
                    {{ capabilities.length }}
                    Capabilit{{ capabilities.length === 1 ? 'y' : 'ies' }}
                    <template v-if="tierValue">
                        <span class="sa-fc__dot">·</span>
                        <span class="sa-fc__tier">{{ tierValue }}</span>
                    </template>
                </div>
            </div>

            <div class="sa-fc__coverage">
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
                :status="feature.discoveryStatus"
                @set-status="(target) => emit('review', feature.featureKey, target)"
            />
            <q-icon name="chevron_right" class="sa-fc__chev" :class="{ open: expanded }" />
        </div>

        <div v-if="expanded" class="sa-fc__body">
            <div v-if="feature.discoveryStatus === 'outdated'" class="sa-fc__banner warn">
                <q-icon name="warning" size="16px" />
                <span>
                    Die Implementierung hat sich seit der letzten Freigabe geändert. Bitte
                    Stammdaten &amp; Capabilities prüfen und <b>erneut freigeben</b>.
                </span>
            </div>
            <div v-if="feature.discoveryStatus === 'obsolete'" class="sa-fc__banner mute">
                <q-icon name="info" size="16px" />
                <span>
                    Dieses Feature ist abgekündigt. Es sollte in neuen Plänen nicht mehr verwendet
                    werden.
                </span>
            </div>

            <q-tabs v-model="sub" dense align="left" class="sa-fc__subtabs">
                <q-tab name="stamm" label="Stammdaten" />
                <q-tab name="i18n" label="Übersetzungen" />
            </q-tabs>

            <div v-if="sub === 'stamm'" class="sa-fc__split">
                <div class="sa-fc__split-col">
                    <div class="sa-fc__split-head">Einstellungen</div>
                    <div class="sa-fc__fields">
                        <div class="sa-fc-field">
                            <label class="sa-fc-field__cap">Icon (Quasar-Icon-Name)</label>
                            <q-input
                                dense
                                outlined
                                :model-value="iconValue"
                                placeholder="z. B. directions_car"
                                @update:model-value="(v) => onField('icon', String(v ?? ''))"
                            >
                                <template #prepend>
                                    <q-icon :name="iconValue || 'help_outline'" />
                                </template>
                            </q-input>
                        </div>
                        <div class="sa-fc-field">
                            <label class="sa-fc-field__cap">Tier</label>
                            <q-select
                                dense
                                outlined
                                clearable
                                use-input
                                new-value-mode="add-unique"
                                :options="TIER_OPTIONS"
                                :model-value="tierValue || null"
                                @update:model-value="(v) => onField('tier', String(v ?? ''))"
                            />
                        </div>
                    </div>
                </div>
                <div class="sa-fc__split-col">
                    <div class="sa-fc__split-head">
                        Code Capabilities
                        <span class="sa-fc__split-count">
                            {{ capabilities.length }} · read-only
                        </span>
                    </div>
                    <DiscoveryCapList
                        :capabilities="capabilities"
                        :declared-at-by-key="declaredAtByKey"
                        :new-since="feature.approvedAt"
                    />
                </div>
            </div>

            <CatalogEntryTransPanel
                v-else
                :entry="transEntry"
                :fields="['label', 'description']"
                :active-locales="activeLocales"
                @update:base="onTransBase"
                @update:locale="
                    (locale, patch) => emit('feature-locale', feature.featureKey, locale, patch)
                "
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type {
    CapabilityCatalogEntryRow,
    CatalogEntryI18nFields,
    DiscoveryStatus,
    FeatureCatalogEntryRow,
    UpdateCatalogEntryBaseData,
} from '@saasicat/types';
import CatalogEntryTransPanel from './CatalogEntryTransPanel.vue';
import DiscoveryCapList from './DiscoveryCapList.vue';
import DiscoveryStatusControl from './DiscoveryStatusControl.vue';
import {
    coverageClass,
    coveragePct,
    DISCOVERY_DEFAULT_LOCALE,
    entryCoverage,
    localeShort,
    type TransEntry,
} from './discovery-ui.js';

// Expandable feature card (#20, Sim `FeatureCard`): header with
// StatusControl (approval state machine) + i18n coverage, body with subtabs
// master data (settings + read-only code capabilities) and translations.

const props = defineProps<{
    feature: FeatureCatalogEntryRow;
    /** Capabilities of this feature (read-only code facts). */
    capabilities: CapabilityCatalogEntryRow[];
    /** Owner rollup from the capabilities (#14), most frequent first — computed by the page. */
    owners: string[];
    declaredAtByKey: Record<string, string>;
    activeLocales: string[];
    expanded: boolean;
}>();

const emit = defineEmits<{
    toggle: [];
    review: [key: string, target: DiscoveryStatus];
    'feature-base': [key: string, patch: UpdateCatalogEntryBaseData];
    'feature-locale': [key: string, locale: string, patch: CatalogEntryI18nFields];
}>();

const TIER_OPTIONS = ['CORE', 'ADVANCED', 'PRO', 'ENTERPRISE'];

const sub = ref<'stamm' | 'i18n'>('stamm');

// Local input buffer: once a field has been edited, the draft wins over the
// prop value. Persistence is debounced + the list is replaced from the
// PATCH response — without a buffer a late echo would reset typed characters
// (see CatalogEntryTransPanel).
const drafts = reactive<Record<string, string>>({});
type Field = 'icon' | 'tier' | 'label' | 'description';

function fieldValue(field: Field): string {
    if (field in drafts) return drafts[field];
    const v = props.feature[field];
    return v == null ? '' : String(v);
}
const iconValue = computed(() => fieldValue('icon'));
const tierValue = computed(() => fieldValue('tier'));
const labelValue = computed(() => fieldValue('label'));
const descriptionValue = computed(() => fieldValue('description'));

function onField(field: Field, value: string): void {
    drafts[field] = value;
    emit('feature-base', props.feature.featureKey, { [field]: value });
}

/** Mirror base edits from the translation panel so the header + master data follow along. */
function onTransBase(patch: { label?: string; description?: string }): void {
    for (const [field, value] of Object.entries(patch)) {
        drafts[field as Field] = value ?? '';
    }
    emit('feature-base', props.feature.featureKey, patch);
}

// "New" relative to the last approval: capabilities that entered the catalog
// since `approvedAt`. Without an approval there is no baseline.
const newCapsCount = computed(() => {
    const approvedAt = props.feature.approvedAt;
    if (!approvedAt) return 0;
    return props.capabilities.filter((c) => c.createdAt > approvedAt).length;
});
const deprecatedCapsCount = computed(
    () => props.capabilities.filter((c) => c.codeStatus === 'deprecated').length,
);

const targetLocales = computed(() =>
    props.activeLocales.filter((l) => l !== DISCOVERY_DEFAULT_LOCALE),
);

const transEntry = computed<TransEntry>(() => ({
    key: props.feature.featureKey,
    label: labelValue.value,
    description: descriptionValue.value,
    i18n: props.feature.i18n ?? {},
}));

function coverage(locale: string): number {
    return entryCoverage(transEntry.value, locale, ['label', 'description']);
}
</script>

<style scoped>
.sa-fc {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #fff;
    overflow: hidden;
}
.sa-fc.expanded {
    border-color: #c7d2fe;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
}
.sa-fc__head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    cursor: pointer;
}
.sa-fc__icon {
    color: #475569;
    flex-shrink: 0;
}
.sa-fc__main {
    flex: 1;
    min-width: 0;
}
.sa-fc__titlerow {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.sa-fc__key {
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #f1f5f9;
    color: #475569;
    padding: 2px 6px;
    border-radius: 5px;
    white-space: nowrap;
}
.sa-fc__label {
    font-size: 13px;
    font-weight: 600;
    color: #0f172a;
}
.sa-fc__flag {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 5px;
}
.sa-fc__flag--new {
    background: #fef3c7;
    color: #92400e;
}
.sa-fc__flag--dep {
    background: #fee2e2;
    color: #b91c1c;
}
.sa-fc__flag--succ {
    background: #fef3c7;
    color: #92400e;
}
.sa-fc__flag--repl {
    background: #dbeafe;
    color: #1e40af;
}
.sa-fc__sub {
    font-size: 11px;
    color: #64748b;
    margin-top: 1px;
}
.sa-fc__dot {
    margin: 0 4px;
    color: #cbd5e1;
}
.sa-fc__tier {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: #4f46e5;
}
.sa-fc__coverage {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
}
.sa-fc__chev {
    color: #94a3b8;
    transition: transform 0.15s;
}
.sa-fc__chev.open {
    transform: rotate(90deg);
}
.sa-fc__body {
    border-top: 1px solid #f1f5f9;
    padding: 12px;
    background: #f8fafc;
}
.sa-fc__banner {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    border-radius: 8px;
    padding: 8px 12px;
    margin-bottom: 10px;
}
.sa-fc__banner.warn {
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
}
.sa-fc__banner.mute {
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    color: #475569;
}
.sa-fc__subtabs {
    margin-bottom: 12px;
    border-bottom: 1px solid #e2e8f0;
}
.sa-fc__split {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 14px;
}
.sa-fc__split-head {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #94a3b8;
    margin-bottom: 8px;
}
.sa-fc__split-count {
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: #cbd5e1;
    margin-left: 6px;
}
.sa-fc__fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.sa-fc-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
}
.sa-fc-field__cap {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: #94a3b8;
}
</style>
