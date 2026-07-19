<template>
    <section class="pd-panel">
        <div class="pd-panel-head">
            <div style="min-width: 0">
                <h3 class="pd-panel-title">Versionen</h3>
                <div class="pd-panel-sub">
                    Pro Plan max. 1 offene Draft-Version · Publish setzt Vorgänger auf
                    <code class="pd-code">supersededAt</code>
                </div>
            </div>
            <div class="pd-panel-head-right">
                <button
                    v-if="!draftVersion"
                    class="btn btn--sm primary"
                    type="button"
                    @click="$emit('createDraft')"
                >
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                    >
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                    <span>Draft v{{ nextDraftVersion }}</span>
                </button>
            </div>
        </div>

        <div v-if="chronological.length > 0" class="pd-timeline">
            <div class="pd-timeline-hint">
                <span aria-hidden="true">
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                </span>
                Klicke eine Version, um sie zu wählen
            </div>
            <div class="pd-timeline-bar">
                <div
                    v-for="v in chronological"
                    :key="v.id"
                    :class="[
                        'pd-timeline-seg',
                        statusOf(v),
                        v.id === selectedId ? 'is-selected' : '',
                    ]"
                    :style="{ flex: statusOf(v) === 'draft' ? 1.4 : 1 }"
                    :title="`v${v.version} wählen (${statusOf(v)})`"
                    @click="$emit('update:selectedId', v.id)"
                >
                    v{{ v.version }}<template v-if="statusOf(v) === 'draft'"> · draft</template>
                </div>
            </div>
            <div class="pd-timeline-ticks">
                <span v-for="(t, i) in timelineTicks" :key="i">{{ t }}</span>
            </div>
        </div>

        <div class="pd-versions-tbl">
            <div class="pd-versions-head">
                <div>Version</div>
                <div>Gültig</div>
                <div>Preis</div>
                <div>Auswirkung</div>
                <div>Änderungsnotiz</div>
                <div></div>
            </div>

            <div
                v-for="v in tableRows"
                :key="v.id"
                :class="[
                    'pd-vrow',
                    statusOf(v) === 'draft' ? 'is-draft' : '',
                    v.id === selectedId ? 'is-selected' : '',
                ]"
                @click="$emit('update:selectedId', v.id)"
            >
                <div>
                    <div class="pd-vcol">
                        <span class="pd-v-num">v{{ v.version }}</span>
                        <span :class="['chip dot', statusChip(v)]" style="font-size: 10px">
                            {{ statusOf(v) }}
                        </span>
                    </div>
                </div>
                <div>
                    <div class="pd-validity">
                        <div class="pd-validity-line">
                            <span class="pd-validity-date">
                                {{ v.validFrom ? v.validFrom.slice(0, 10) : '—' }}
                            </span>
                            <span class="pd-arrow-inf">→</span>
                            <span v-if="v.validUntil" class="pd-validity-date">
                                {{ v.validUntil.slice(0, 10) }}
                            </span>
                            <span v-else class="pd-arrow-inf" style="font-size: 14px">∞</span>
                        </div>
                        <span class="pd-validity-sub">
                            {{
                                statusOf(v) === 'draft'
                                    ? 'geplant'
                                    : statusOf(v) === 'live'
                                      ? 'aktiv'
                                      : 'historisch'
                            }}
                        </span>
                    </div>
                </div>
                <div>
                    <div>
                        <div class="pd-pricing-m">{{ formatMoney(v.monthlyNet) }} / Mo</div>
                        <div class="pd-pricing-y">{{ formatMoney(v.yearlyNet) }} / Jahr</div>
                    </div>
                </div>
                <div>
                    <div>
                        <div class="pd-impact-num">{{ impactByVersion[v.version] ?? 0 }}</div>
                        <div class="pd-impact-sub">Mandanten</div>
                    </div>
                </div>
                <div>
                    <span class="pd-change-note" :title="v.changeNote ?? ''">
                        {{ v.changeNote || '—' }}
                    </span>
                </div>
                <div class="pd-row-actions" @click.stop>
                    <span
                        v-if="editabilityOf(v).reason === 'pre-active'"
                        class="pd-pre-active-chip"
                        :title="
                            'Published, aber noch nicht aktiv — Features, Quotas und ' +
                            'Preis können bis zum Aktivierungsdatum noch korrigiert werden'
                        "
                    >
                        editierbar · noch nicht aktiv
                    </span>
                    <template v-if="statusOf(v) === 'draft'">
                        <button
                            class="btn btn--sm primary"
                            type="button"
                            title="Draft veröffentlichen"
                            @click="$emit('publish', v)"
                        >
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                            >
                                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                            </svg>
                        </button>
                    </template>
                    <template v-if="editabilityOf(v).editable">
                        <button
                            class="btn btn--sm"
                            type="button"
                            :title="
                                editabilityOf(v).reason === 'pre-active'
                                    ? 'Future-Version bearbeiten'
                                    : 'Draft bearbeiten'
                            "
                            @click="$emit('editDraft', v)"
                        >
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                            >
                                <path
                                    d="M12 20h9M16.5 3.5a2.12 2.12 0 113 3L7 19l-4 1 1-4 12.5-12.5z"
                                />
                            </svg>
                        </button>
                    </template>
                    <template v-if="statusOf(v) === 'live'">
                        <span
                            v-if="v.endsAt"
                            class="pd-endsat-badge"
                            :title="`Endet am ${formatDate(v.endsAt)}`"
                        >
                            Endet {{ formatDate(v.endsAt) }}
                        </span>
                        <button
                            class="btn btn--sm"
                            type="button"
                            :title="v.endsAt ? 'Enddatum ändern' : 'Version terminieren'"
                            @click="$emit('openTerminate', v)"
                        >
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                            >
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                            <span>{{ v.endsAt ? 'Enddatum…' : 'Terminieren…' }}</span>
                        </button>
                    </template>
                </div>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import type { PlanVersionRow } from '@saasicat/types';
import type { EditabilityOf, StatusChipOf, StatusOf } from './types.js';

defineProps<{
    chronological: PlanVersionRow[];
    tableRows: PlanVersionRow[];
    selectedId: string | null;
    draftVersion: PlanVersionRow | null;
    nextDraftVersion: number;
    timelineTicks: string[];
    impactByVersion: Record<number, number>;
    statusOf: StatusOf;
    statusChip: StatusChipOf;
    editabilityOf: EditabilityOf;
    formatMoney: (raw: string | number) => string;
    formatDate: (iso: string | null | undefined) => string;
}>();

defineEmits<{
    (e: 'update:selectedId', value: string | null): void;
    (e: 'createDraft'): void;
    (e: 'publish', version: PlanVersionRow): void;
    (e: 'editDraft', version: PlanVersionRow): void;
    (e: 'openTerminate', version: PlanVersionRow): void;
}>();
</script>
