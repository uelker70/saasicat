<template>
    <div class="sa-plan-list">
        <AdminStatistics :columns="4">
            <AdminKpi :label="msg.list.statPlans" :value="resolvedPlans.length" />
            <AdminKpi :label="msg.list.statLive" :value="liveCount" tone="positive" />
            <AdminKpi
                :label="msg.list.statDrafts"
                :value="draftCount"
                :tone="draftCount > 0 ? 'warn' : 'neutral'"
            />
            <AdminKpi :label="msg.list.statTenants" :value="totalTenants" />
        </AdminStatistics>

        <!-- List wrapper -->
        <div class="sa-plan-list-wrap">
            <div class="sa-plan-list-toolbar">
                <div class="sa-plan-list-search">
                    <span class="sa-plan-list-search-ico" aria-hidden="true">
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <circle cx="11" cy="11" r="7" />
                            <path d="M21 21l-4.35-4.35" />
                        </svg>
                    </span>
                    <input v-model="search" :placeholder="msg.list.searchPlaceholder" />
                    <span class="sa-plan-list-kbd">⌘ K</span>
                </div>
                <div class="sa-plan-list-toolbar-spacer" />
                <div class="sa-plan-list-sortinfo">{{ msg.list.sortedBy }}</div>
            </div>

            <div class="sa-plan-list-list">
                <div class="sa-plan-list-list-head">
                    <div>{{ msg.list.columnPlan }}</div>
                    <div>{{ common.status }}</div>
                    <div>{{ msg.list.columnVersion }}</div>
                    <div>{{ msg.list.columnPrice }}</div>
                    <div>{{ msg.list.columnTenants }}</div>
                    <div />
                </div>

                <div v-if="filteredPlans.length === 0" class="sa-plan-list-empty">
                    <template v-if="resolvedPlans.length === 0">
                        {{ msg.list.emptyNoPlans }}
                    </template>
                    <template v-else>{{ emptyNoMatch }}</template>
                </div>

                <template v-for="p in filteredPlans" :key="p.plan.id">
                    <!-- Parent row: currently live version (or first future / nothing) -->
                    <div
                        :class="[
                            'sa-plan-list-row',
                            { 'sa-plan-list-row--new': highlightPlanKey === p.planKey },
                        ]"
                        @click="$emit('openPlan', p.plan)"
                    >
                        <div class="sa-plan-list-cell sa-plan-list-cell--name">
                            <div class="sa-plan-list-plan-name">
                                <div
                                    class="sa-plan-list-plan-mark"
                                    :style="{
                                        background: planAccent(p.planKey) + '15',
                                        color: planAccent(p.planKey),
                                        borderColor: planAccent(p.planKey) + '33',
                                    }"
                                >
                                    {{ p.planKey.slice(0, 3) }}
                                </div>
                                <div class="sa-plan-list-plan-titles">
                                    <div class="sa-plan-list-plan-title">
                                        {{ p.label }}
                                        <span
                                            v-if="highlightPlanKey === p.planKey"
                                            class="sa-plan-list-chip sa-plan-list-chip--new"
                                            >{{ msg.list.badgeNew }}</span
                                        >
                                    </div>
                                    <div class="sa-plan-list-plan-desc">
                                        {{ p.description || '—' }}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="sa-plan-list-cell sa-plan-list-cell--status">
                            <template v-if="p.currentLive">
                                <span
                                    class="sa-plan-list-chip sa-plan-list-chip--live sa-plan-list-chip--dot"
                                    >{{ msg.list.chipLive }}</span
                                >
                                <span
                                    v-if="!p.currentLive.marketed"
                                    class="sa-plan-list-chip sa-plan-list-chip--supersed sa-plan-list-chip--tiny"
                                    >{{ msg.list.chipPrivate }}</span
                                >
                            </template>
                            <template v-else-if="p.primary && p.primary.publishedAt">
                                <span
                                    class="sa-plan-list-chip sa-plan-list-chip--scheduled sa-plan-list-chip--dot"
                                >
                                    {{ validFromLabel(p.primary.validFrom) }}
                                </span>
                            </template>
                            <template v-else>
                                <span
                                    class="sa-plan-list-chip sa-plan-list-chip--supersed sa-plan-list-chip--dot"
                                    >{{ msg.list.chipNoLive }}</span
                                >
                            </template>
                        </div>

                        <div class="sa-plan-list-cell">
                            <div v-if="p.primary" class="sa-plan-list-version-num">
                                v{{ p.primary.version }}
                            </div>
                            <div
                                v-else
                                class="sa-plan-list-version-num sa-plan-list-version-num--muted"
                            >
                                —
                            </div>
                            <div v-if="p.primary?.validFrom" class="sa-plan-list-version-sub">
                                {{
                                    validityRange(
                                        p.currentLive ? msg.list.since : msg.list.from,
                                        p.primary.validFrom,
                                        p.primary.validUntil,
                                    )
                                }}
                            </div>
                        </div>

                        <div class="sa-plan-list-cell">
                            <template v-if="!p.primary">
                                <span class="sa-plan-list-price-text">—</span>
                            </template>
                            <template
                                v-else-if="
                                    Number(p.primary.monthlyNet) === 0 &&
                                    Number(p.primary.yearlyNet) === 0
                                "
                            >
                                <span class="sa-plan-list-price-text">{{
                                    msg.list.priceFree
                                }}</span>
                            </template>
                            <template v-else>
                                <div>
                                    <span class="sa-plan-list-price-big">{{
                                        formatMoney(p.primary.monthlyNet)
                                    }}</span>
                                    <span class="sa-plan-list-price-unit">{{
                                        ' ' + msg.list.perMonthShort
                                    }}</span>
                                </div>
                                <div class="sa-plan-list-price-sub">
                                    {{ formatMoney(p.primary.yearlyNet) }}
                                    {{ msg.list.perYearShort }}
                                </div>
                            </template>
                        </div>

                        <div class="sa-plan-list-cell sa-plan-list-cell--tenants">
                            <span class="sa-plan-list-tenant-num">{{ p.tenantCount }}</span>
                            <div class="sa-plan-list-tenant-bar">
                                <div
                                    class="sa-plan-list-tenant-bar-fill"
                                    :style="{
                                        width: tenantBarWidth(p.tenantCount),
                                        background: planAccent(p.planKey),
                                    }"
                                />
                            </div>
                        </div>

                        <div class="sa-plan-list-cell sa-plan-list-cell--actions" @click.stop>
                            <button
                                v-if="hasAnyPublished(p)"
                                class="sa-btn sa-btn--sm sa-btn--ghost"
                                type="button"
                                disabled
                                :title="msg.list.actionDeleteBlocked"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    opacity="0.4"
                                >
                                    <rect x="3" y="11" width="18" height="11" rx="2" />
                                    <path d="M7 11V7a5 5 0 0110 0v4" />
                                </svg>
                            </button>
                            <button
                                v-else
                                class="sa-btn sa-btn--sm sa-btn--ghost sa-btn--danger"
                                type="button"
                                :title="msg.list.actionDeletePlan"
                                @click="$emit('archivePlan', p.plan, false)"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                >
                                    <path
                                        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                                    />
                                </svg>
                            </button>
                            <button
                                class="sa-btn sa-btn--sm sa-btn--ghost"
                                type="button"
                                :title="msg.list.actionClonePlan"
                                @click="$emit('clonePlan', p.plan)"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                >
                                    <rect x="9" y="9" width="11" height="11" rx="2" />
                                    <path d="M5 15V5a2 2 0 012-2h10" />
                                </svg>
                            </button>
                            <button
                                class="sa-btn sa-btn--sm sa-btn--ghost"
                                type="button"
                                :title="msg.list.actionNewVersion"
                                :disabled="!!p.draft"
                                @click="onNewVersion(p)"
                            >
                                <svg
                                    width="14"
                                    height="14"
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
                            <button
                                class="sa-btn sa-btn--sm"
                                type="button"
                                :title="msg.list.actionOpenPlan"
                                @click="$emit('openPlan', p.plan)"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                >
                                    <path d="M9 18l6-6-6-6" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <!-- Sub rows: drafts + future-scheduled versions, indented -->
                    <div
                        v-for="sub in p.subRows"
                        :key="`${p.plan.id}-${sub.id}`"
                        class="sa-plan-list-row sa-plan-list-row--sub"
                        @click.stop="$emit('openPlan', p.plan)"
                    >
                        <div
                            class="sa-plan-list-cell sa-plan-list-cell--name sa-plan-list-cell--sub-name"
                        >
                            <div class="sa-plan-list-sub-tree" aria-hidden="true">
                                <span class="sa-plan-list-sub-tree-elbow" />
                            </div>
                            <div class="sa-plan-list-sub-titles">
                                <div class="sa-plan-list-sub-title">
                                    v{{ sub.version }}
                                    <template v-if="sub.publishedAt === null">
                                        <span
                                            class="sa-plan-list-chip sa-plan-list-chip--draft sa-plan-list-chip--dot sa-plan-list-chip--tiny"
                                            >{{ msg.list.chipDraft }}</span
                                        >
                                    </template>
                                    <template v-else>
                                        <span
                                            class="sa-plan-list-chip sa-plan-list-chip--scheduled sa-plan-list-chip--dot sa-plan-list-chip--tiny"
                                            >{{ msg.list.chipScheduled }}</span
                                        >
                                    </template>
                                </div>
                                <div class="sa-plan-list-sub-desc">
                                    {{ sub.changeNote || msg.list.noChangeNote }}
                                </div>
                            </div>
                        </div>

                        <div class="sa-plan-list-cell sa-plan-list-cell--status">
                            <span
                                v-if="sub.publishedAt === null"
                                class="sa-plan-list-chip sa-plan-list-chip--draft sa-plan-list-chip--dot sa-plan-list-chip--tiny"
                                >{{ msg.list.chipDraft }}</span
                            >
                            <span
                                v-else
                                class="sa-plan-list-chip sa-plan-list-chip--scheduled sa-plan-list-chip--dot sa-plan-list-chip--tiny"
                                >{{ validFromLabel(sub.validFrom) }}</span
                            >
                        </div>

                        <div class="sa-plan-list-cell">
                            <div class="sa-plan-list-version-num sa-plan-list-version-num--sub">
                                v{{ sub.version }}
                            </div>
                            <div v-if="sub.validFrom" class="sa-plan-list-version-sub">
                                {{ validityRange(msg.list.from, sub.validFrom, sub.validUntil) }}
                            </div>
                        </div>

                        <div class="sa-plan-list-cell">
                            <template
                                v-if="Number(sub.monthlyNet) === 0 && Number(sub.yearlyNet) === 0"
                            >
                                <span class="sa-plan-list-price-text">{{
                                    msg.list.priceFree
                                }}</span>
                            </template>
                            <template v-else>
                                <div>
                                    <span class="sa-plan-list-price-big">{{
                                        formatMoney(sub.monthlyNet)
                                    }}</span>
                                    <span class="sa-plan-list-price-unit">{{
                                        ' ' + msg.list.perMonthShort
                                    }}</span>
                                </div>
                                <div class="sa-plan-list-price-sub">
                                    {{ formatMoney(sub.yearlyNet) }} {{ msg.list.perYearShort }}
                                </div>
                            </template>
                        </div>

                        <div class="sa-plan-list-cell sa-plan-list-cell--sub-impact">
                            <span class="sa-plan-list-version-sub">{{
                                tenantCountLabel(p.tenantCount)
                            }}</span>
                        </div>

                        <div class="sa-plan-list-cell sa-plan-list-cell--actions" @click.stop>
                            <button
                                v-if="sub.publishedAt === null"
                                class="sa-btn sa-btn--sm sa-btn--ghost sa-btn--danger"
                                type="button"
                                :title="discardDraftTitle(sub.version)"
                                @click="$emit('discardDraft', p.plan, sub)"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                >
                                    <path
                                        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                                    />
                                </svg>
                            </button>
                            <button
                                v-if="sub.publishedAt === null"
                                class="sa-btn sa-btn--sm sa-btn--ghost"
                                type="button"
                                :title="msg.list.actionEditDraft"
                                @click="$emit('editDraft', p.plan, sub)"
                            >
                                <svg
                                    width="14"
                                    height="14"
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
                            <button
                                class="sa-btn sa-btn--sm"
                                type="button"
                                :title="msg.list.actionOpenInCockpit"
                                @click="$emit('openPlan', p.plan)"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                >
                                    <path d="M9 18l6-6-6-6" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import AdminKpi from '../admin-page/AdminKpi.vue';
import AdminStatistics from '../admin-page/AdminStatistics.vue';
import { computed, ref } from 'vue';
import type { PlanRow, PlanVersionRow } from '@saasicat/types';
import { formatMessage } from '../../client/i18n/format.js';
import { formatCurrency } from '../../client/i18n/currency.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// PlanList — list view of all plans (default view in PlansPage,
// corresponds to the ListScreen from the plan simulation). One row per
// plan with mark chip, status, version, price, tenant progress, row
// actions (clone · new version · open).

const props = withDefaults(
    defineProps<{
        plans: PlanRow[];
        versionsByPlanId: Record<string, PlanVersionRow[]>;
        tenantCountsByPlanKey?: Record<string, number>;
        planAccents?: Record<string, string>;
        /** Plan key that was last created/updated — gets the NEU highlight. */
        highlightPlanKey?: string | null;
    }>(),
    {
        tenantCountsByPlanKey: () => ({}),
        planAccents: () => ({}),
        highlightPlanKey: null,
    },
);

const emit = defineEmits<{
    (e: 'openPlan', plan: PlanRow): void;
    (e: 'clonePlan', plan: PlanRow): void;
    (e: 'newVersion', plan: PlanRow, basis: PlanVersionRow): void;
    (e: 'editDraft', plan: PlanRow, draft: PlanVersionRow): void;
    (e: 'discardDraft', plan: PlanRow, draft: PlanVersionRow): void;
    (e: 'archivePlan', plan: PlanRow, hasLive: boolean): void;
}>();

const msg = useSaMessages('plans');
const { locale, intlLocale } = useSuperAdminI18n();
const common = useSaMessages('common');

const search = ref('');

interface ResolvedPlan {
    plan: PlanRow;
    planKey: string;
    label: string;
    description: string | null;
    /** Version currently active for new bookings (validFrom ≤ today < validUntil or validUntil null). */
    currentLive: PlanVersionRow | null;
    /** Version shown on the parent row (currentLive preferred). */
    primary: PlanVersionRow | null;
    /** Drafts + future-published versions (sorted: future ASC by validFrom, drafts at the end). */
    subRows: PlanVersionRow[];
    /** True if the plan has any versions at all (for hide logic). */
    hasAnyVersion: boolean;
    /** True if all versions are expired (validUntil < today, no draft / no future). */
    allExpired: boolean;
    /** First open draft (for the header KPI "offene Drafts"). */
    draft: PlanVersionRow | null;
    tenantCount: number;
}

const DEFAULT_ACCENTS: Record<string, string> = {
    STARTER: '#64748b',
    STANDARD: '#2563eb',
    PRO: '#7c3aed',
    PROFESSIONAL: '#7c3aed',
    BUSINESS: '#0ea5e9',
    ENTERPRISE: '#0f766e',
    BASIC: '#475569',
};
const FALLBACK_ACCENTS = ['#2563eb', '#7c3aed', '#0f766e', '#f59e0b', '#0ea5e9', '#ef4444'];

function planAccent(planKey: string): string {
    const provided = props.planAccents[planKey];
    if (provided) return provided;
    const def = DEFAULT_ACCENTS[planKey];
    if (def) return def;
    const idx = props.plans.findIndex((p) => p.planKey === planKey);
    return FALLBACK_ACCENTS[idx % FALLBACK_ACCENTS.length] ?? FALLBACK_ACCENTS[0]!;
}

function todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
}

function isCurrentlyValid(v: PlanVersionRow, today: string): boolean {
    if (v.publishedAt === null) return false;
    if (v.validFrom && v.validFrom.slice(0, 10) > today) return false;
    if (v.validUntil && v.validUntil.slice(0, 10) < today) return false;
    return true;
}

function isFutureScheduled(v: PlanVersionRow, today: string): boolean {
    if (v.publishedAt === null) return false;
    if (!v.validFrom) return false;
    return v.validFrom.slice(0, 10) > today;
}

function isExpired(v: PlanVersionRow, today: string): boolean {
    if (v.publishedAt === null) return false;
    if (!v.validUntil) return false;
    return v.validUntil.slice(0, 10) < today;
}

const resolvedPlans = computed<ResolvedPlan[]>(() => {
    const today = todayIsoDate();
    return [...props.plans]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.planKey.localeCompare(b.planKey))
        .map<ResolvedPlan>((plan) => {
            const versions = props.versionsByPlanId[plan.id] ?? [];
            const drafts = versions.filter((v) => v.publishedAt === null);
            const published = versions.filter((v) => v.publishedAt !== null);
            const currentLive = published.find((v) => isCurrentlyValid(v, today)) ?? null;
            const futureScheduled = published
                .filter((v) => isFutureScheduled(v, today))
                .sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? ''));

            // Parent = currentLive preferred; otherwise the next upcoming
            // future version; otherwise null (drafts only → root row without a version).
            const primary = currentLive ?? futureScheduled[0] ?? null;

            // Sub-rows = all visible versions except the parent
            const subSet = new Set<string>();
            if (primary) subSet.add(primary.id);
            const subRows: PlanVersionRow[] = [];
            for (const v of futureScheduled) {
                if (!subSet.has(v.id)) {
                    subRows.push(v);
                    subSet.add(v.id);
                }
            }
            for (const d of drafts) {
                if (!subSet.has(d.id)) {
                    subRows.push(d);
                    subSet.add(d.id);
                }
            }

            const allExpired =
                versions.length > 0 &&
                drafts.length === 0 &&
                published.every((v) => isExpired(v, today)) &&
                futureScheduled.length === 0;

            return {
                plan,
                planKey: plan.planKey,
                label: plan.label,
                description: plan.description ?? null,
                currentLive,
                primary,
                subRows,
                hasAnyVersion: versions.length > 0,
                allExpired,
                draft: drafts[0] ?? null,
                tenantCount: props.tenantCountsByPlanKey[plan.planKey] ?? 0,
            };
        });
});

const filteredPlans = computed(() => {
    // Plans with only expired versions are hidden entirely
    // (SPEC_V2 §4.2.1: only currently-valid + future ones stay visible
    // in the admin listing).
    const base = resolvedPlans.value.filter((p) => !p.allExpired);
    const q = search.value.trim().toLocaleLowerCase(intlLocale.value);
    if (!q) return base;
    return base.filter(
        (p) =>
            p.planKey.toLocaleLowerCase(intlLocale.value).includes(q) ||
            p.label.toLocaleLowerCase(intlLocale.value).includes(q),
    );
});

const liveCount = computed(() => resolvedPlans.value.filter((p) => p.currentLive !== null).length);
const draftCount = computed(() => resolvedPlans.value.filter((p) => p.draft !== null).length);
const totalTenants = computed(() => resolvedPlans.value.reduce((sum, p) => sum + p.tenantCount, 0));

const emptyNoMatch = computed(() =>
    formatMessage(msg.value.list.emptyNoMatch, { query: search.value }),
);

function validFromLabel(validFrom: string | null | undefined): string {
    return formatMessage(msg.value.list.validFrom, { date: validFrom?.slice(0, 10) ?? '' });
}

function validityRange(prefix: string, validFrom: string, validUntil: string | null): string {
    const range = `${prefix} ${validFrom.slice(0, 10)}`;
    if (!validUntil) return range;
    return `${range} ${msg.value.list.until} ${validUntil.slice(0, 10)}`;
}

function tenantCountLabel(count: number): string {
    return formatMessage(msg.value.list.tenantCount, { count });
}

function discardDraftTitle(version: number): string {
    return formatMessage(msg.value.list.actionDiscardDraft, { version });
}

function formatMoney(raw: string | number): string {
    const num = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(num)) return String(raw);
    return formatCurrency(num, locale.value);
}

function tenantBarWidth(count: number): string {
    if (count <= 0) return '0%';
    return `${Math.min(100, count / 1.5)}%`;
}

function onNewVersion(row: ResolvedPlan): void {
    if (row.draft) return; // already an open draft → no new one
    const basis = row.currentLive;
    if (!basis) {
        // without a live version: via the cockpit path
        emit('openPlan', row.plan);
        return;
    }
    emit('newVersion', row.plan, basis);
}

function hasAnyPublished(row: ResolvedPlan): boolean {
    // Superseded or expired counts too — the plan root stays in the DB
    // forever for contract-protection P1 reasons.
    const versions = props.versionsByPlanId[row.plan.id] ?? [];
    return versions.some((v) => v.publishedAt !== null);
}
</script>

<style scoped>
.sa-plan-list {
    --sa-plan-list-bg: #f6f7f9;
    --sa-plan-list-surface: #ffffff;
    --sa-plan-list-surface-2: #f8fafc;
    --sa-plan-list-border: #e5e7eb;
    --sa-plan-list-border-strong: #d1d5db;
    --sa-plan-list-text: #0f172a;
    --sa-plan-list-text-2: #475569;
    --sa-plan-list-text-3: #94a3b8;
    --sa-plan-list-primary: #2563eb;
    --sa-plan-list-primary-700: #1d4ed8;
    --sa-plan-list-live-bg: #ecfdf5;
    --sa-plan-list-draft-bg: #fffbeb;
    --sa-plan-list-font-sans:
        'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --sa-plan-list-font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

    padding: 22px 26px;
    background: var(--sa-plan-list-bg);
    color: var(--sa-plan-list-text);
    font-family: var(--sa-plan-list-font-sans);
    min-height: 100%;
    box-sizing: border-box;
}
.sa-plan-list * {
    box-sizing: border-box;
}

/* Buttons */

/* List wrap */
.sa-plan-list-wrap {
    background: var(--sa-plan-list-surface);
    border: 1px solid var(--sa-plan-list-border);
    border-radius: 10px;
    overflow: hidden;
}
.sa-plan-list-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--sa-plan-list-border);
    background: #fbfbfd;
}
.sa-plan-list-search {
    flex: 1;
    max-width: 360px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #fff;
    border: 1px solid var(--sa-plan-list-border);
    border-radius: 7px;
    padding: 7px 10px;
}
.sa-plan-list-search-ico {
    color: var(--sa-plan-list-text-3);
    display: inline-flex;
}
.sa-plan-list-search input {
    flex: 1;
    border: 0;
    outline: 0;
    font: 13px var(--sa-plan-list-font-sans);
    background: transparent;
    color: var(--sa-plan-list-text);
}
.sa-plan-list-kbd {
    font: 600 10.5px var(--sa-plan-list-font-mono);
    background: #f1f5f9;
    color: var(--sa-plan-list-text-2);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid #e2e8f0;
}
.sa-plan-list-toolbar-spacer {
    flex: 1;
}
.sa-plan-list-sortinfo {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--sa-plan-list-text-3);
}

/* List grid */
.sa-plan-list-list {
    display: grid;
    grid-template-columns: 1.6fr 0.9fr 0.7fr 0.9fr 1.4fr 160px;
    align-items: center;
}
.sa-plan-list-list-head {
    display: contents;
}
.sa-plan-list-list-head > div {
    background: #fbfbfd;
    padding: 10px 16px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--sa-plan-list-text-2);
    font-weight: 700;
    border-bottom: 1px solid var(--sa-plan-list-border);
}
.sa-plan-list-empty {
    grid-column: 1 / -1;
    padding: 32px 24px;
    text-align: center;
    color: var(--sa-plan-list-text-3);
    font-style: italic;
    font-size: 13px;
}
.sa-plan-list-row {
    display: contents;
    cursor: pointer;
}
.sa-plan-list-row > .sa-plan-list-cell {
    padding: 14px 16px;
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.12s;
}
.sa-plan-list-row:hover > .sa-plan-list-cell {
    background: #fcfcfd;
}
.sa-plan-list-row--new > .sa-plan-list-cell {
    background: var(--sa-plan-list-live-bg) !important;
    animation: sa-plan-list-flashNew 2.4s ease-out;
}
@keyframes sa-plan-list-flashNew {
    0% {
        background: #d1fae5 !important;
    }
    100% {
        background: var(--sa-plan-list-live-bg) !important;
    }
}

/* Sub-rows (drafts + future-scheduled versions, indented under the parent) */
.sa-plan-list-row--sub > .sa-plan-list-cell {
    background: #fafbfd;
    padding-top: 10px;
    padding-bottom: 10px;
}
.sa-plan-list-row--sub:hover > .sa-plan-list-cell {
    background: #f1f5f9;
}
.sa-plan-list-cell--sub-name {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-left: 32px !important;
}
.sa-plan-list-sub-tree {
    display: inline-flex;
    align-items: center;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    position: relative;
}
.sa-plan-list-sub-tree-elbow {
    position: absolute;
    top: 0;
    bottom: 50%;
    left: 12px;
    width: 14px;
    border-left: 1.5px solid #cbd5e1;
    border-bottom: 1.5px solid #cbd5e1;
    border-bottom-left-radius: 6px;
}
.sa-plan-list-sub-titles {
    min-width: 0;
}
.sa-plan-list-sub-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--sa-plan-list-text-2);
    display: flex;
    align-items: center;
    gap: 8px;
}
.sa-plan-list-sub-desc {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sa-plan-list-version-num--sub {
    font-size: 13px;
    font-weight: 600;
    color: var(--sa-plan-list-text-2);
}
.sa-plan-list-cell--sub-impact {
    color: var(--sa-plan-list-text-3);
}

.sa-plan-list-plan-name {
    display: flex;
    align-items: center;
    gap: 12px;
}
.sa-plan-list-plan-mark {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    font: 700 11px var(--sa-plan-list-font-mono);
    letter-spacing: 0.04em;
    flex: 0 0 auto;
    border: 1px solid;
}
.sa-plan-list-plan-titles {
    min-width: 0;
}
.sa-plan-list-plan-title {
    font-size: 14.5px;
    font-weight: 700;
    color: var(--sa-plan-list-text);
    letter-spacing: -0.01em;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.sa-plan-list-plan-desc {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sa-plan-list-cell--status {
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: flex-start;
}

/* Chips */
.sa-plan-list-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--sa-plan-list-surface-2);
    color: var(--sa-plan-list-text-2);
    border: 1px solid var(--sa-plan-list-border);
}
.sa-plan-list-chip--tiny {
    padding: 1px 6px;
    font-size: 10px;
}
.sa-plan-list-chip--new {
    background: #dbeafe;
    color: #1e40af;
    border-color: #bfdbfe;
    font-size: 10px;
}
.sa-plan-list-chip--live {
    background: var(--sa-plan-list-live-bg);
    color: #047857;
    border-color: #a7f3d0;
}
.sa-plan-list-chip--draft {
    background: var(--sa-plan-list-draft-bg);
    color: #b45309;
    border-color: #fde68a;
}
.sa-plan-list-chip--supersed {
    background: #f1f5f9;
    color: var(--sa-plan-list-text-2);
    border-color: #cbd5e1;
}
.sa-plan-list-chip--scheduled {
    background: #eef2ff;
    color: #4338ca;
    border-color: #c7d2fe;
}
.sa-plan-list-chip--dot::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

.sa-plan-list-version-num {
    font-size: 13px;
    font-weight: 700;
    color: var(--sa-plan-list-text);
}
.sa-plan-list-version-num--muted {
    color: #cbd5e1;
}
.sa-plan-list-version-sub {
    font-size: 10.5px;
    color: var(--sa-plan-list-text-3);
    margin-top: 2px;
}

.sa-plan-list-price-big {
    font-size: 14px;
    font-weight: 700;
    color: var(--sa-plan-list-text);
}
.sa-plan-list-price-unit {
    font-size: 11px;
    color: var(--sa-plan-list-text-3);
}
.sa-plan-list-price-sub {
    font-size: 10.5px;
    color: var(--sa-plan-list-text-3);
    margin-top: 2px;
}
.sa-plan-list-price-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--sa-plan-list-text);
}

.sa-plan-list-cell--tenants {
    display: flex;
    align-items: center;
    gap: 10px;
}
.sa-plan-list-tenant-num {
    font-size: 16px;
    font-weight: 700;
    color: var(--sa-plan-list-text);
}
.sa-plan-list-tenant-bar {
    flex: 1;
    height: 6px;
    background: #f1f5f9;
    border-radius: 999px;
    overflow: hidden;
}
.sa-plan-list-tenant-bar-fill {
    height: 100%;
}

.sa-plan-list-cell--actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
}
</style>
