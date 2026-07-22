<template>
    <section class="pc-card pc-card--left">
        <div class="pc-card-head">
            <div class="pc-card-head-text">
                <div class="pc-card-title">{{ msg.versions.title }}</div>
                <div class="pc-card-sub">
                    {{ msg.versions.subtitle }}
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
                <span>{{ newDraftButtonLabel }}</span>
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
                    v{{ seg.version
                    }}<template v-if="seg.status === 'draft'">{{
                        msg.versions.timelineDraftSuffix
                    }}</template>
                </div>
            </div>
            <div class="pc-vtl-axis">
                <span v-for="(label, i) in timelineAxis" :key="i">{{ label }}</span>
            </div>
        </div>

        <div class="pc-vrow pc-vrow--head">
            <div class="pc-vrow-version pc-vrow-headlabel">{{ msg.versions.colVersion }}</div>
            <div class="pc-vrow-cell pc-vrow-headlabel">{{ msg.versions.colValidity }}</div>
            <div class="pc-vrow-cell pc-vrow-headlabel pc-vrow-cell--right">
                {{ msg.versions.colPricing }}
            </div>
            <div class="pc-vrow-cell pc-vrow-headlabel pc-vrow-cell--right">
                {{ msg.versions.colImpact }}
            </div>
            <div class="pc-vrow-note pc-vrow-headlabel">{{ msg.versions.colChangeNoteShort }}</div>
            <div class="pc-vrow-actions" />
        </div>
        <div v-if="versions.length === 0" class="pc-empty">
            {{ msg.versions.empty }}
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
                    {{ formatMoney(row.monthlyNet)
                    }}<span class="pc-vrow-price-unit">{{ msg.versions.perMonthUnit }}</span>
                </div>
                <div class="pc-vrow-sub">
                    {{ formatMoney(row.yearlyNet) }} {{ msg.versions.perYearUnit }}
                </div>
            </div>
            <div class="pc-vrow-cell pc-vrow-cell--right">
                <div
                    class="pc-vrow-impact"
                    :class="(impactByVersion[row.version] ?? 0) > 0 ? '' : 'pc-vrow-impact--zero'"
                >
                    {{ impactByVersion[row.version] ?? 0 }}
                </div>
                <div class="pc-vrow-sub">{{ msg.versions.tenants }}</div>
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
                    <span>{{ msg.versions.publish }}</span>
                </button>
                <button
                    v-if="editabilityOf(row).editable"
                    class="pc-btn pc-btn--sm"
                    type="button"
                    :title="
                        editabilityOf(row).reason === 'pre-active'
                            ? msg.versions.preActiveTitle
                            : msg.versions.editDraftTitle
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
                    <span>{{ common.edit }}</span>
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
                    <span>{{ msg.versions.viewDiff }}</span>
                </button>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { isVersionEditable, type PlanVersionRow } from '@saasicat/types';
import { formatMessage } from '../../client/i18n/format.js';
import { formatCurrency } from '../../client/i18n/currency.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import type { TimelineSegment } from './types';

const props = defineProps<{
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

const msg = useSaMessages('planDetail');
const { locale } = useSuperAdminI18n();
const common = useSaMessages('common');

const newDraftButtonLabel = computed(() =>
    formatMessage(msg.value.versions.newDraftButton, { version: props.nextDraftVersion }),
);

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
    return formatCurrency(num, locale.value);
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
    if (days <= 0) return msg.value.versions.updatedToday;
    if (days < 30) return formatMessage(msg.value.versions.updatedDaysAgo, { days });
    if (days < 365) {
        return formatMessage(msg.value.versions.updatedMonthsAgo, {
            months: Math.floor(days / 30),
        });
    }
    return formatMessage(msg.value.versions.updatedYearsAgo, { years: Math.floor(days / 365) });
}
</script>
