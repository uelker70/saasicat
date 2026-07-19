<template>
    <section class="pve-col pve-preview">
        <div class="pve-col-header pve-col-header--preview">
            <div>
                <div class="pve-col-title">Live-Vorschau · Public-Catalog</div>
                <div class="pve-col-sub">So sehen Interessenten den Plan</div>
            </div>
            <div class="pve-preview-toggle">
                <button
                    type="button"
                    :class="[
                        'pve-btn pve-btn--sm',
                        { 'pve-btn--ghost': previewMode !== 'desktop' },
                    ]"
                    @click="$emit('update:previewMode', 'desktop')"
                >
                    Desktop
                </button>
                <button
                    type="button"
                    :class="['pve-btn pve-btn--sm', { 'pve-btn--ghost': previewMode !== 'mobile' }]"
                    @click="$emit('update:previewMode', 'mobile')"
                >
                    Mobil
                </button>
            </div>
        </div>

        <div class="pve-prev-window" :class="`pve-prev-window--${previewMode}`">
            <div class="pve-prev-chrome">
                <span class="pve-prev-dot" style="background: #ef4444" />
                <span class="pve-prev-dot" style="background: #f59e0b" />
                <span class="pve-prev-dot" style="background: #10b981" />
                <div class="pve-prev-url">{{ catalogUrl }}</div>
            </div>
            <div class="pve-prev-body">
                <div class="pve-prev-eyebrow">Unsere Pläne · Vorschau Draft v{{ version }}</div>
                <div class="pve-prev-title">{{ planDisplayName }}</div>
                <div class="pve-prev-desc">
                    {{ changeNote || 'Plan-Beschreibung wird aus der Change-Note generiert.' }}
                </div>
                <div class="pve-prev-price">
                    <span class="pve-prev-price-big">{{ formattedMonthly }}</span>
                    <span class="pve-prev-price-unit">/ Monat</span>
                </div>
                <div v-if="yearlySavingsLabel" class="pve-prev-price-yearly">
                    oder {{ formattedYearly }} / Jahr · {{ yearlySavingsLabel }}
                </div>

                <button type="button" class="pve-prev-cta">Jetzt 30 Tage testen</button>

                <div class="pve-prev-sep">Enthalten</div>
                <ul class="pve-prev-list">
                    <li v-for="row in selectedQuotaList" :key="`pq-${row.quotaKey}`">
                        <span class="pve-prev-tick" aria-hidden="true">
                            <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="3"
                            >
                                <path d="M5 13l4 4L19 7" />
                            </svg>
                        </span>
                        <b>{{ quotas[row.quotaKey] }}</b>
                        {{ (row.unit || row.label).toLowerCase() }}
                    </li>
                    <li v-for="key in sortedSelectedFeatures" :key="`pf-${key}`">
                        <span class="pve-prev-tick" aria-hidden="true">
                            <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="3"
                            >
                                <path d="M5 13l4 4L19 7" />
                            </svg>
                        </span>
                        {{ featureLabel(key) }}
                    </li>
                    <li
                        v-if="sortedSelectedFeatures.length === 0 && selectedQuotaList.length === 0"
                        class="pve-prev-empty"
                    >
                        Noch keine Inhalte zugewiesen.
                    </li>
                </ul>

                <div class="pve-prev-foot">
                    Marketing-Catalog ·
                    <code class="pve-mono pve-mono--xs">{{ planKey }}@v{{ version }}</code>
                    <template v-if="changeNote">
                        · Change-Note „{{ changeNote }}" wird bei Publish veröffentlicht.
                    </template>
                </div>
            </div>
        </div>

        <div class="pve-prev-validate">
            <div class="pve-prev-validate-head">
                <span class="pve-prev-validate-tick" aria-hidden="true">
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
                <span class="pve-prev-validate-title">Publish-Checkliste</span>
                <span class="pve-prev-validate-count"
                    >{{ checklistOkCount }} / {{ checklist.length }} ok</span
                >
            </div>
            <div
                v-for="item in checklist"
                :key="item.id"
                :class="['pve-vchk', item.ok ? 'pve-vchk--ok' : 'pve-vchk--warn']"
            >
                <span aria-hidden="true">
                    <svg
                        v-if="item.ok"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                    >
                        <path d="M5 13l4 4L19 7" />
                    </svg>
                    <svg
                        v-else
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path
                            d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                        />
                        <path d="M12 9v4M12 17h.01" />
                    </svg>
                </span>
                <span v-html="item.label" />
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import type { ChecklistItem, PreviewMode, SelectedQuotaRow } from './types.js';

defineProps<{
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
</script>
