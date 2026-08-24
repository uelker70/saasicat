<template>
    <section class="pve-col pve-preview">
        <div class="pve-col-header pve-col-header--preview">
            <div>
                <div class="pve-col-title">{{ msg.catalogPreview.title }}</div>
                <div class="pve-col-sub">{{ msg.catalogPreview.subtitle }}</div>
            </div>
            <div class="pve-preview-toggle">
                <q-btn
                    dense
                    no-caps
                    :flat="previewMode !== 'desktop'"
                    :unelevated="previewMode === 'desktop'"
                    :color="previewMode === 'desktop' ? 'primary' : undefined"
                    :label="msg.catalogPreview.desktop"
                    @click="$emit('update:previewMode', 'desktop')"
                />
                <q-btn
                    dense
                    no-caps
                    :flat="previewMode !== 'mobile'"
                    :unelevated="previewMode === 'mobile'"
                    :color="previewMode === 'mobile' ? 'primary' : undefined"
                    :label="msg.catalogPreview.mobile"
                    @click="$emit('update:previewMode', 'mobile')"
                />
            </div>
        </div>

        <div class="pve-prev-window" :class="`pve-prev-window--${previewMode}`">
            <div class="pve-prev-chrome">
                <!-- The same window controls as MarketingCatalogPreview, drawn
                     a second time, and the same reason for the `-strong`
                     rungs. The chrome itself is duplicated markup and belongs
                     in one component; that is a Phase 4 job, not a colour one. -->
                <span class="pve-prev-dot" style="background: var(--sa-color-negative-strong)" />
                <span class="pve-prev-dot" style="background: var(--sa-color-warning-strong)" />
                <span class="pve-prev-dot" style="background: var(--sa-color-positive-strong)" />
                <div class="pve-prev-url">{{ catalogUrl }}</div>
            </div>
            <div class="pve-prev-body">
                <div class="pve-prev-eyebrow">{{ eyebrow }}</div>
                <div class="pve-prev-title">{{ planDisplayName }}</div>
                <div class="pve-prev-desc">
                    {{ changeNote || msg.catalogPreview.descriptionFallback }}
                </div>
                <div class="pve-prev-price">
                    <span class="pve-prev-price-big">{{ formattedMonthly }}</span>
                    <span class="pve-prev-price-unit">{{ msg.catalogPreview.perMonth }}</span>
                </div>
                <div v-if="yearlySavingsLabel" class="pve-prev-price-yearly">
                    {{ yearlyAlternative }}
                </div>

                <q-btn class="pve-prev-cta" unelevated no-caps :label="msg.catalogPreview.cta" />

                <div class="pve-prev-sep">{{ msg.catalogPreview.included }}</div>
                <ul class="pve-prev-list">
                    <li v-for="row in selectedQuotaList" :key="`pq-${row.quotaKey}`">
                        <span class="pve-prev-tick" aria-hidden="true">
                            <q-icon name="check" size="10px" />
                        </span>
                        <b>{{ quotas[row.quotaKey] }}</b>
                        {{ (row.unit || row.label).toLowerCase() }}
                    </li>
                    <li v-for="key in sortedSelectedFeatures" :key="`pf-${key}`">
                        <span class="pve-prev-tick" aria-hidden="true">
                            <q-icon name="check" size="10px" />
                        </span>
                        {{ featureLabel(key) }}
                    </li>
                    <li
                        v-if="sortedSelectedFeatures.length === 0 && selectedQuotaList.length === 0"
                        class="pve-prev-empty"
                    >
                        {{ msg.catalogPreview.emptyContents }}
                    </li>
                </ul>

                <div class="pve-prev-foot">
                    {{ msg.catalogPreview.footerLabel }} ·
                    <code class="pve-mono pve-mono--xs">{{ planKey }}@v{{ version }}</code>
                    <template v-if="changeNote"> · {{ footerChangeNote }} </template>
                </div>
            </div>
        </div>

        <div class="pve-prev-validate">
            <div class="pve-prev-validate-head">
                <span class="pve-prev-validate-tick" aria-hidden="true">
                    <q-icon name="check" size="14px" />
                </span>
                <span class="pve-prev-validate-title">{{ msg.catalogPreview.checklistTitle }}</span>
                <span class="pve-prev-validate-count">{{ checklistCountLabel }}</span>
            </div>
            <div
                v-for="item in checklist"
                :key="item.id"
                :class="['pve-vchk', item.ok ? 'pve-vchk--ok' : 'pve-vchk--warn']"
            >
                <span aria-hidden="true">
                    <q-icon v-if="item.ok" name="check" size="14px" />
                    <q-icon v-else name="warning" size="14px" />
                </span>
                <!-- Checklist labels come from the i18n catalog, where one
                     entry (`checklistTenantImpact`) emphasises the affected
                     tenant count with a bold span. Both interpolated values are
                     numbers the platform computed, never request data. -->
                <!-- eslint-disable-next-line vue/no-v-html -->
                <span v-html="item.label" />
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatMessage } from '../../../client/i18n/format.js';
import { useSaMessages } from '../../../vue/use-super-admin-i18n.js';
import type { ChecklistItem, PreviewMode, SelectedQuotaRow } from './plan-version-editor.types.js';

const props = defineProps<{
    previewMode: PreviewMode;
    catalogUrl: string;
    planKey: string;
    version: number;
    changeNote: string;
    quotas: Record<string, number>;
    planDisplayName: string;
    formattedMonthly: string;
    formattedYearly: string;
    yearlySavingsLabel: string | null;
    selectedQuotaList: SelectedQuotaRow[];
    sortedSelectedFeatures: string[];
    checklist: ChecklistItem[];
    checklistOkCount: number;
    featureLabel: (key: string) => string;
}>();

defineEmits<{
    (e: 'update:previewMode', value: PreviewMode): void;
}>();

const msg = useSaMessages('planEditor');

const eyebrow = computed(() =>
    formatMessage(msg.value.catalogPreview.eyebrow, { version: props.version }),
);

const yearlyAlternative = computed(() =>
    formatMessage(msg.value.catalogPreview.yearlyAlternative, {
        price: props.formattedYearly,
        savings: props.yearlySavingsLabel ?? '',
    }),
);

const footerChangeNote = computed(() =>
    formatMessage(msg.value.catalogPreview.footerChangeNote, { note: props.changeNote }),
);

const checklistCountLabel = computed(() =>
    formatMessage(msg.value.catalogPreview.checklistCount, {
        ok: props.checklistOkCount,
        total: props.checklist.length,
    }),
);
</script>
