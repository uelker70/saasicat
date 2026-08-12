<template>
    <div class="sa-plan-list">
        <!-- List wrapper -->
        <div class="sa-plan-list-wrap">
            <div class="sa-plan-list-toolbar">
                <q-input
                    v-model="search"
                    dense
                    outlined
                    clearable
                    :placeholder="msg.list.searchPlaceholder"
                >
                    <template #prepend><q-icon name="search" /></template>
                </q-input>
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
import { resolvePlans, type ResolvedPlan } from '../../client/resolve-plans.js';
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

// `clearable` emits null, not '' — see Quasar's use-field clearValue().
const search = ref<string | null>('');

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

const resolvedPlans = computed(() =>
    resolvePlans({
        plans: props.plans,
        versionsByPlanId: props.versionsByPlanId,
        tenantCountsByPlanKey: props.tenantCountsByPlanKey,
    }),
);

const filteredPlans = computed(() => {
    // Plans with only expired versions are hidden entirely
    // — only currently-valid and future ones stay visible in the admin listing.
    const base = resolvedPlans.value.filter((p) => !p.allExpired);
    const q = (search.value ?? '').trim().toLocaleLowerCase(intlLocale.value);
    if (!q) return base;
    return base.filter(
        (p) =>
            p.planKey.toLocaleLowerCase(intlLocale.value).includes(q) ||
            p.label.toLocaleLowerCase(intlLocale.value).includes(q),
    );
});

const emptyNoMatch = computed(() =>
    formatMessage(msg.value.list.emptyNoMatch, { query: search.value ?? '' }),
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

function onNewVersion(row: ResolvedPlan<PlanRow, PlanVersionRow>): void {
    if (row.draft) return; // already an open draft → no new one
    const basis = row.currentLive;
    if (!basis) {
        // without a live version: via the cockpit path
        emit('openPlan', row.plan);
        return;
    }
    emit('newVersion', row.plan, basis);
}

function hasAnyPublished(row: ResolvedPlan<PlanRow, PlanVersionRow>): boolean {
    // Superseded or expired counts too — the plan root stays in the DB
    // forever for contract-protection P1 reasons.
    const versions = props.versionsByPlanId[row.plan.id] ?? [];
    return versions.some((v) => v.publishedAt !== null);
}
</script>

<style scoped>
.sa-plan-list {
    /* padding: 22px 26px; */
    background: var(--sa-bg-app);
    color: var(--sa-heading);
    font-family: var(--sa-font-body);
    min-height: 100%;
    box-sizing: border-box;
}

/* Buttons */

/* List wrap */
.sa-plan-list-wrap {
    background: var(--sa-bg-surface);
    border: 1px solid var(--sa-border);
    border-radius: 10px;
    overflow: hidden;
}
.sa-plan-list-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--sa-border);
    background: var(--sa-bg-surface-2);
}
/* The search takes the row; the sort hint keeps its content width. */
.sa-plan-list-toolbar > .q-field {
    flex: 1;
}
.sa-plan-list-sortinfo {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--sa-muted-light);
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
    background: var(--sa-color-bg-surface-raised);
    padding: 10px 16px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--sa-muted-dark);
    font-weight: 700;
    border-bottom: 1px solid var(--sa-border);
}
.sa-plan-list-empty {
    grid-column: 1 / -1;
    padding: 32px 24px;
    text-align: center;
    color: var(--sa-muted-light);
    font-style: italic;
    font-size: 13px;
}
.sa-plan-list-row {
    display: contents;
    cursor: pointer;
}
.sa-plan-list-row > .sa-plan-list-cell {
    padding: 14px 16px;
    border-bottom: 1px solid var(--sa-border-soft);
    transition: background 0.12s;
}
.sa-plan-list-row:hover > .sa-plan-list-cell {
    background: var(--sa-color-bg-surface-raised);
}
.sa-plan-list-row--new > .sa-plan-list-cell {
    background: var(--sa-positive-bg) !important;
    animation: sa-plan-list-flashNew 2.4s ease-out;
}
@keyframes sa-plan-list-flashNew {
    0% {
        background: var(--sa-color-positive-surface-strong) !important;
    }
    100% {
        background: var(--sa-positive-bg) !important;
    }
}

/* Sub-rows (drafts + future-scheduled versions, indented under the parent) */
.sa-plan-list-row--sub > .sa-plan-list-cell {
    background: var(--sa-color-bg-surface-raised);
    padding-top: 10px;
    padding-bottom: 10px;
}
.sa-plan-list-row--sub:hover > .sa-plan-list-cell {
    background: var(--sa-border-soft);
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
    border-left: 1.5px solid var(--sa-color-border-strong);
    border-bottom: 1.5px solid var(--sa-color-border-strong);
    border-bottom-left-radius: 6px;
}
.sa-plan-list-sub-titles {
    min-width: 0;
}
.sa-plan-list-sub-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--sa-muted-dark);
    display: flex;
    align-items: center;
    gap: 8px;
}
.sa-plan-list-sub-desc {
    font-size: 11.5px;
    color: var(--sa-muted);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sa-plan-list-version-num--sub {
    font-size: 13px;
    font-weight: 600;
    color: var(--sa-muted-dark);
}
.sa-plan-list-cell--sub-impact {
    color: var(--sa-muted-light);
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
    font: 700 11px var(--sa-font-mono);
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
    color: var(--sa-heading);
    letter-spacing: -0.01em;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}
.sa-plan-list-plan-desc {
    font-size: 11.5px;
    color: var(--sa-muted);
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
    background: var(--sa-bg-surface-2);
    color: var(--sa-muted-dark);
    border: 1px solid var(--sa-border);
}
.sa-plan-list-chip--tiny {
    padding: 1px 6px;
    font-size: 10px;
}
.sa-plan-list-chip--new {
    background: var(--sa-color-info-surface-strong);
    color: var(--sa-color-info-fg);
    border-color: var(--sa-color-info-border);
    font-size: 10px;
}
.sa-plan-list-chip--live {
    background: var(--sa-positive-bg);
    color: var(--sa-color-positive-fg);
    border-color: var(--sa-color-positive-border);
}
.sa-plan-list-chip--draft {
    background: var(--sa-warning-bg);
    color: var(--sa-color-warning-fg);
    border-color: var(--sa-color-warning-border);
}
.sa-plan-list-chip--supersed {
    background: var(--sa-border-soft);
    color: var(--sa-muted-dark);
    border-color: var(--sa-color-border-strong);
}
.sa-plan-list-chip--scheduled {
    background: var(--sa-color-scheduled-surface);
    color: var(--sa-color-scheduled-fg);
    border-color: var(--sa-color-scheduled-border);
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
    color: var(--sa-heading);
}
.sa-plan-list-version-num--muted {
    color: var(--sa-color-fg-disabled);
}
.sa-plan-list-version-sub {
    font-size: 10.5px;
    color: var(--sa-muted-light);
    margin-top: 2px;
}

.sa-plan-list-price-big {
    font-size: 14px;
    font-weight: 700;
    color: var(--sa-heading);
}
.sa-plan-list-price-unit {
    font-size: 11px;
    color: var(--sa-muted-light);
}
.sa-plan-list-price-sub {
    font-size: 10.5px;
    color: var(--sa-muted-light);
    margin-top: 2px;
}
.sa-plan-list-price-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--sa-heading);
}

.sa-plan-list-cell--tenants {
    display: flex;
    align-items: center;
    gap: 10px;
}
.sa-plan-list-tenant-num {
    font-size: 16px;
    font-weight: 700;
    color: var(--sa-heading);
}
.sa-plan-list-tenant-bar {
    flex: 1;
    height: 6px;
    background: var(--sa-border-soft);
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
