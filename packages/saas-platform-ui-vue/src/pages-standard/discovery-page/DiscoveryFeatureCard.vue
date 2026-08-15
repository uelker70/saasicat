<template>
    <AdminAccordion class="sa-fc" :open="expanded" @update:open="emit('toggle')">
        <template #mark><q-icon :name="iconValue || 'help_outline'" size="18px" /></template>

        <template #header>
            <div class="sa-fc__head">
                <div class="sa-fc__main">
                    <div class="sa-fc__titlerow">
                        <code class="sa-fc__key">{{ feature.featureKey }}</code>
                        <span class="sa-fc__label">{{ labelValue || feature.featureKey }}</span>
                        <span v-if="newCapsCount > 0" class="sa-fc__flag sa-fc__flag--new">
                            {{ newCapsLabel }}
                        </span>
                        <span v-if="deprecatedCapsCount > 0" class="sa-fc__flag sa-fc__flag--dep">
                            {{ deprecatedCapsLabel }}
                        </span>
                        <span
                            v-if="feature.successorKey"
                            class="sa-fc__flag sa-fc__flag--succ"
                            :title="replacedByLabel"
                        >
                            {{ replacedByLabel }}
                        </span>
                        <span
                            v-if="feature.replaces.length"
                            class="sa-fc__flag sa-fc__flag--repl"
                            :title="replacesLabel"
                        >
                            {{ replacesLabel }}
                        </span>
                    </div>
                    <div class="sa-fc__sub">
                        <template v-if="owners.length">
                            <span class="sa-muted">{{ msg.owner }}</span>
                            {{ owners.join(', ') }}
                            <span class="sa-fc__dot">·</span>
                        </template>
                        {{ capabilities.length }}
                        {{
                            capabilities.length === 1
                                ? msg.feature.capabilityOne
                                : msg.feature.capabilityMany
                        }}
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
            </div>
        </template>

        <!-- Outside the trigger, not merely `@click.stop` inside it. The old
             head was a `<div @click>` with this control nested in it, and the
             only thing keeping a status change from also toggling the card was
             a `.stop` somebody remembered. Structure beats memory. -->
        <template #header-actions>
            <DiscoveryStatusControl
                :status="feature.discoveryStatus"
                @set-status="(target) => emit('review', feature.featureKey, target)"
            />
        </template>

        <div class="sa-fc__body">
            <div v-if="feature.discoveryStatus === 'outdated'" class="sa-fc__banner warn">
                <q-icon name="warning" size="16px" />
                <span>
                    {{ msg.feature.outdatedBanner }} <b>{{ msg.reapproveEmphasis }}</b
                    >.
                </span>
            </div>
            <div v-if="feature.discoveryStatus === 'obsolete'" class="sa-fc__banner mute">
                <q-icon name="info" size="16px" />
                <span>{{ msg.feature.obsoleteBanner }}</span>
            </div>

            <q-tabs v-model="sub" dense align="left" class="sa-fc__subtabs">
                <q-tab name="stamm" :label="msg.feature.tabBaseData" />
                <q-tab name="i18n" :label="msg.feature.tabTranslations" />
            </q-tabs>

            <div v-if="sub === 'stamm'" class="sa-fc__split">
                <div class="sa-fc__split-col">
                    <div class="sa-fc__split-head">{{ msg.feature.settings }}</div>
                    <div class="sa-fc__fields">
                        <div class="sa-fc-field">
                            <label class="sa-fc-field__cap">{{ msg.feature.iconLabel }}</label>
                            <q-input
                                dense
                                outlined
                                :model-value="iconValue"
                                :placeholder="msg.feature.iconPlaceholder"
                                @update:model-value="(v) => onField('icon', String(v ?? ''))"
                            >
                                <template #prepend>
                                    <q-icon :name="iconValue || 'help_outline'" />
                                </template>
                            </q-input>
                        </div>
                        <div class="sa-fc-field">
                            <label class="sa-fc-field__cap">{{ msg.feature.tierLabel }}</label>
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
                        {{ msg.feature.codeCapabilities }}
                        <span class="sa-fc__split-count">{{ codeCapabilitiesCountLabel }}</span>
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
    </AdminAccordion>
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
import AdminAccordion from '../../components/admin-page/AdminAccordion.vue';
import CatalogEntryTransPanel from './CatalogEntryTransPanel.vue';
import DiscoveryCapList from './DiscoveryCapList.vue';
import DiscoveryStatusControl from './DiscoveryStatusControl.vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
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

const msg = useSaMessages('discovery');

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

const newCapsLabel = computed(() =>
    formatMessage(msg.value.feature.newCaps, { count: newCapsCount.value }),
);
const deprecatedCapsLabel = computed(() =>
    formatMessage(msg.value.feature.deprecatedCaps, { count: deprecatedCapsCount.value }),
);
const replacedByLabel = computed(() =>
    formatMessage(msg.value.replacedBy, { key: props.feature.successorKey ?? '' }),
);
const replacesLabel = computed(() =>
    formatMessage(msg.value.replaces, { keys: props.feature.replaces.join(', ') }),
);
const codeCapabilitiesCountLabel = computed(() =>
    formatMessage(msg.value.feature.codeCapabilitiesCount, { count: props.capabilities.length }),
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
/* Surface, radius, open border, head padding, chevron and body come from
 * `AdminAccordion`. What is left is what a FEATURE row puts in that header.
 *
 * These seven rules were byte-identical to `DiscoveryQuotaCard`'s after a
 * prefix rename — jscpd could not see it, because `minTokens: 50` is larger
 * than any single rule here. The duplication was real and below the threshold. */
.sa-fc__head {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
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
    font-size: var(--sa-text-xs);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
    padding: 2px 6px;
    border-radius: 5px;
    white-space: nowrap;
}
.sa-fc__label {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.sa-fc__flag {
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 5px;
}
.sa-fc__flag--new {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
.sa-fc__flag--dep {
    background: var(--sa-color-negative-surface-strong);
    color: var(--sa-color-negative-fg);
}
.sa-fc__flag--succ {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
.sa-fc__flag--repl {
    background: var(--sa-color-info-surface-strong);
    color: var(--sa-color-info-fg);
}
.sa-fc__sub {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
    margin-top: 1px;
}
.sa-fc__dot {
    margin: 0 4px;
    color: var(--sa-color-fg-disabled);
}
.sa-fc__tier {
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--sa-color-scheduled);
}
.sa-fc__coverage {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
}
.sa-fc__banner {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--sa-text-sm);
    border-radius: 8px;
    padding: 8px 12px;
    margin-bottom: 10px;
}
.sa-fc__banner.warn {
    background: var(--sa-color-warning-surface);
    border: 1px solid var(--sa-color-warning-border);
    color: var(--sa-color-warning-fg);
}
.sa-fc__banner.mute {
    background: var(--sa-color-border-soft);
    border: 1px solid var(--sa-color-border);
    color: var(--sa-color-fg-secondary);
}
.sa-fc__subtabs {
    margin-bottom: 12px;
    border-bottom: 1px solid var(--sa-color-border);
}
.sa-fc__split {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 14px;
}
.sa-fc__split-head {
    font-size: var(--sa-text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--sa-color-fg-subtle);
    margin-bottom: 8px;
}
.sa-fc__split-count {
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: var(--sa-color-fg-disabled);
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
    font-size: var(--sa-text-xs);
    font-weight: 600;
    text-transform: uppercase;
    color: var(--sa-color-fg-subtle);
}
</style>
