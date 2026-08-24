<template>
    <AdminAccordion
        class="sa-qc"
        :class="{ warn: !quota.usageProvider }"
        :open="expanded"
        :mark-tone="quota.usageProvider ? 'accent' : 'negative'"
        @update:open="emit('toggle')"
    >
        <!-- The glyph already says it; the tone lets the badge say it too. The
             `:color` this replaces was a Quasar PALETTE name, which reaches past
             the role layer — `negative` there is Quasar's, not the theme's. -->
        <template #mark>
            <q-icon :name="quota.usageProvider ? 'inventory_2' : 'error'" size="18px" />
        </template>

        <template #header>
            <div class="sa-qc__head">
                <div class="sa-qc__main">
                    <div class="sa-qc__titlerow">
                        <span class="sa-qc__label">{{ labelValue || quota.quotaKey }}</span>
                        <code class="sa-qc__key">{{ quota.quotaKey }}</code>
                        <span class="sa-chip">{{ quota.enforcementMode }}</span>
                        <span
                            v-if="quota.successorKey"
                            class="sa-qc__flag sa-qc__flag--succ"
                            :title="replacedByLabel"
                        >
                            {{ replacedByLabel }}
                        </span>
                        <span
                            v-if="quota.replaces.length"
                            class="sa-qc__flag sa-qc__flag--repl"
                            :title="replacesLabel"
                        >
                            {{ replacesLabel }}
                        </span>
                    </div>
                    <div class="sa-qc__sub">
                        {{ msg.unit }} <code>{{ quota.unit }}</code> · {{ msg.quota.usageProvider }}
                        <code v-if="quota.usageProvider">{{ quota.usageProvider }}</code>
                        <span v-else class="sa-qc__missing">{{
                            msg.quota.usageProviderMissing
                        }}</span>
                    </div>
                    <div v-if="!quota.usageProvider" class="sa-qc__warning">
                        {{ msg.quota.noUsageProviderWarning }}
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
            </div>
        </template>

        <!-- See DiscoveryFeatureCard: outside the trigger, not `@click.stop`
             inside it. -->
        <template #header-actions>
            <DiscoveryStatusControl
                :status="quota.discoveryStatus"
                @set-status="(target) => emit('review', quota.quotaKey, target)"
            />
        </template>

        <div class="sa-qc__body">
            <div v-if="quota.discoveryStatus === 'outdated'" class="sa-qc__banner">
                <q-icon name="warning" size="16px" />
                <span>
                    {{ msg.quota.outdatedBanner }} <b>{{ msg.reapproveEmphasis }}</b
                    >.
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
    </AdminAccordion>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue';
import type {
    CatalogEntryI18nFields,
    DiscoveryStatus,
    QuotaCatalogEntryRow,
    UpdateCatalogEntryBaseData,
} from '@saasicat/core';
import AdminAccordion from '../../ui/page/AdminAccordion.vue';
import CatalogEntryTransPanel from './CatalogEntryTransPanel.vue';
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

// Expandable Quota card (#20 Slice 1, sim `QuotaRow`) — same lifecycle as
// Features. Body = translations (label/unit/description); `unit` is
// code-derived and only translatable per target locale.

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

const msg = useSaMessages('discovery');

// Draft buffer for the header label — the fields themselves are buffered by
// the CatalogEntryTransPanel; here only so the title follows along while typing.
const drafts = reactive<{ label?: string }>({});
const labelValue = computed(() => drafts.label ?? props.quota.label ?? '');

const replacedByLabel = computed(() =>
    formatMessage(msg.value.replacedBy, { key: props.quota.successorKey ?? '' }),
);
const replacesLabel = computed(() =>
    formatMessage(msg.value.replaces, { keys: props.quota.replaces.join(', ') }),
);

/** Mirror base edits from the translation panel + bubble them up. */
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
/* Surface, radius, open border, head padding, chevron and body come from
 * `AdminAccordion`. What is left is what a QUOTA row puts in that header — and
 * `warn`, which is this card's own idea and not the accordion's.
 *
 * Two values changed by moving: the open border was
 * `--sa-color-scheduled-border` plus a shadow here and `--sa-color-accent`
 * everywhere else, and the head padding was 10/12 against 12/14 next door.
 * Those differences were the finding, not the design. */
.sa-qc.warn {
    border-color: var(--sa-color-negative-border);
    background: var(--sa-color-negative-surface);
}
.sa-qc__head {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
}
.sa-qc__main {
    flex: 1;
    min-width: 0;
}
.sa-qc__titlerow {
    display: flex;
    gap: var(--sa-space-3);
    align-items: center;
    flex-wrap: wrap;
}
.sa-qc__label {
    font-weight: 600;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
}
.sa-qc__key {
    font-size: var(--sa-text-xs);
}
.sa-qc__flag {
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    padding: var(--sa-space-0) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
}
.sa-qc__flag--succ {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
.sa-qc__flag--repl {
    background: var(--sa-color-info-surface-strong);
    color: var(--sa-color-info-fg);
}
.sa-qc__sub {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
    margin-top: var(--sa-space-1);
}
.sa-qc__missing {
    color: var(--sa-color-negative-fg);
    font-weight: 700;
}
.sa-qc__warning {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-negative-fg);
    margin-top: var(--sa-space-2);
}
.sa-qc__coverage {
    display: flex;
    gap: var(--sa-space-2);
    flex-shrink: 0;
}
.sa-qc__banner {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    font-size: var(--sa-text-sm);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-3) var(--sa-space-4);
    margin-bottom: var(--sa-space-3);
    background: var(--sa-color-warning-surface);
    border: 1px solid var(--sa-color-warning-border);
    color: var(--sa-color-warning-fg);
}
</style>
