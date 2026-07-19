<template>
    <section class="pc-card pc-card--left">
        <div class="pc-card-head">
            <div class="pc-card-head-text">
                <div class="pc-card-title">Versionen</div>
                <div class="pc-card-sub">
                    Pro Plan max. 1 offene Draft-Version · Publish setzt Vorgänger auf
                    <code class="pc-mono">supersededAt</code>
                </div>
            </div>
            <button
                class="pc-btn pc-btn--sm pc-btn--primary"
                type="button"
                :disabled="hasOpenDraft"
                @click="emit('createDraft')"
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

        <div v-if="versions.length > 0" class="pc-vtimeline">
            <div class="pc-vtl-track">
                <div
                    v-for="seg in timelineSegments"
                    :key="seg.key"
                    :class="['pc-vtl-seg', `pc-vtl-${seg.status}`]"
                    :style="{ flex: seg.flex }"
                >
                    v{{ seg.version }}<template v-if="seg.status === 'draft'"> · draft</template>
                </div>
            </div>
            <div class="pc-vtl-axis">
                <span v-for="(label, i) in timelineAxis" :key="i">{{ label }}</span>
            </div>
        </div>

        <div class="pc-vrow pc-vrow--head">
            <div class="pc-vrow-version pc-vrow-headlabel">Version</div>
            <div class="pc-vrow-cell pc-vrow-headlabel">Gültig</div>
            <div class="pc-vrow-cell pc-vrow-headlabel pc-vrow-cell--right">Pricing</div>
            <div class="pc-vrow-cell pc-vrow-headlabel pc-vrow-cell--right">Impact</div>
            <div class="pc-vrow-note pc-vrow-headlabel">Change-Note</div>
            <div class="pc-vrow-actions" />
        </div>
        <div v-if="versions.length === 0" class="pc-empty">
            Noch keine Versionen — „Neue Draft-Version" oben rechts.
        </div>
        <div
            v-for="row in sortedVersions"
            :key="row.id"
            :class="['pc-vrow', row.publishedAt === null ? 'pc-vrow--active' : '']"
        >
            <div class="pc-vrow-version">
                <span class="pc-vrow-vlabel">v{{ row.version }}</span>
                <span :class="['pc-chip pc-chip--dot', statusChipClass(row)]">{{
                    statusLabel(row)
                }}</span>
            </div>
            <div class="pc-vrow-cell">
                <div class="pc-vrow-validity">
                    {{ row.validFrom ? row.validFrom.slice(0, 10) : '—' }}
                    <span class="pc-vrow-arrow">→</span>
                    <template v-if="row.validUntil">{{ row.validUntil.slice(0, 10) }}</template>
                    <span v-else class="pc-vrow-inf">∞</span>
                </div>
                <div class="pc-vrow-sub">{{ updatedLabel(row) }}</div>
            </div>
            <div class="pc-vrow-cell pc-vrow-cell--right">
                <div class="pc-vrow-price">
                    {{ formatMoney(row.monthlyNet) }}<span class="pc-vrow-price-unit">/ Mo</span>
                </div>
                <div class="pc-vrow-sub">{{ formatMoney(row.yearlyNet) }} / Jahr</div>
            </div>
            <div class="pc-vrow-cell pc-vrow-cell--right">
                <div
                    class="pc-vrow-impact"
                    :class="(impactByVersion[row.version] ?? 0) > 0 ? '' : 'pc-vrow-impact--zero'"
                >
                    {{ impactByVersion[row.version] ?? 0 }}
                </div>
                <div class="pc-vrow-sub">Mandanten</div>
            </div>
            <div class="pc-vrow-note" :title="row.changeNote ?? ''">
                {{ row.changeNote || '—' }}
            </div>
            <div class="pc-vrow-actions">
                <button
                    v-if="row.publishedAt === null"
                    class="pc-btn pc-btn--sm pc-btn--primary"
                    type="button"
                    @click="emit('publish', row)"
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
                    <span>Publish</span>
                </button>
                <button
                    v-if="editabilityOf(row).editable"
                    class="pc-btn pc-btn--sm"
                    type="button"
                    :title="
                        editabilityOf(row).reason === 'pre-active'
                            ? 'Published, aber noch nicht aktiv — Features, Quotas und Preis können bis zum Aktivierungsdatum noch korrigiert werden'
                            : 'Draft bearbeiten'
                    "
                    @click="emit('editDraft', row)"
                >
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M12 20h9M16.5 3.5a2.12 2.12 0 113 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                    <span>Bearbeiten</span>
                </button>
                <button
                    v-if="row.publishedAt !== null && row.supersededAt === null && draftVersion"
                    class="pc-btn pc-btn--sm"
                    type="button"
                    @click="emit('viewDiff', draftVersion, row)"
                >
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span>Diff</span>
                </button>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { isVersionEditable, type PlanVersionRow } from '@saasicat/types';
import type { TimelineSegment } from './types';

defineProps<{
    versions: PlanVersionRow[];
    sortedVersions: PlanVersionRow[];
    timelineSegments: TimelineSegment[];
    timelineAxis: string[];
    hasOpenDraft: boolean;
    nextDraftVersion: number;
    impactByVersion: Record<number, number>;
    draftVersion: PlanVersionRow | null;
}>();

const emit = defineEmits<{
    (e: 'createDraft'): void;
    (e: 'publish', version: PlanVersionRow): void;
    (e: 'editDraft', version: PlanVersionRow): void;
    (e: 'viewDiff', from: PlanVersionRow, to: PlanVersionRow): void;
}>();

function editabilityOf(version: PlanVersionRow): {
    editable: boolean;
    reason: 'draft' | 'pre-active' | null;
} {
    return isVersionEditable(version);
}

function statusChipClass(row: PlanVersionRow): string {
    if (row.publishedAt === null) return 'pc-chip--draft';
    if (row.supersededAt !== null) return 'pc-chip--supersed';
    return 'pc-chip--live';
}

function statusLabel(row: PlanVersionRow): string {
    if (row.publishedAt === null) return 'draft';
    if (row.supersededAt !== null) return 'superseded';
    return 'live';
}

function formatMoney(raw: string | number): string {
    const num = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(num)) return String(raw);
    if (Number.isInteger(num)) return `${num} €`;
    return `${num.toFixed(2).replace('.', ',')} €`;
}

function updatedLabel(row: PlanVersionRow): string {
    const iso =
        row.publishedAt ??
        (row as unknown as { updatedAt?: string }).updatedAt ??
        (row as unknown as { createdAt?: string }).createdAt ??
        '';
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days <= 0) return 'heute';
    if (days < 30) return `vor ${days} Tagen`;
    if (days < 365) return `vor ${Math.floor(days / 30)} Monaten`;
    return `vor ${Math.floor(days / 365)} Jahren`;
}
</script>
