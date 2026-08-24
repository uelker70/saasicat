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
                                    :style="identityChipStyle(planAccent(p.planKey))"
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
                            <q-btn
                                v-if="hasAnyPublished(p)"
                                flat
                                dense
                                no-caps
                                disable
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
                            </q-btn>
                            <q-btn
                                v-else
                                flat
                                no-caps
                                color="negative"
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
                            </q-btn>
                            <q-btn
                                flat
                                dense
                                no-caps
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
                            </q-btn>
                            <q-btn
                                flat
                                dense
                                no-caps
                                :title="msg.list.actionNewVersion"
                                :disable="!!p.draft"
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
                            </q-btn>
                            <q-btn
                                flat
                                dense
                                no-caps
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
                            </q-btn>
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
                            <q-btn
                                v-if="sub.publishedAt === null"
                                flat
                                no-caps
                                color="negative"
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
                            </q-btn>
                            <q-btn
                                v-if="sub.publishedAt === null"
                                flat
                                dense
                                no-caps
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
                            </q-btn>
                            <q-btn
                                flat
                                dense
                                no-caps
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
                            </q-btn>
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
import type { PlanRow, PlanVersionRow } from '@saasicat/core';
import { identityAccentFor, identityChipStyle } from '../../client/identity-accents.js';
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

function planAccent(planKey: string): string {
    return identityAccentFor(
        planKey,
        props.planAccents,
        props.plans.findIndex((p) => p.planKey === planKey),
    );
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
    background: var(--sa-color-bg-app);
    color: var(--sa-color-fg-heading);
    font-family: var(--sa-font-body);
    min-height: 100%;
    box-sizing: border-box;
}

/* Buttons */

/* List wrap */
.sa-plan-list-wrap {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-tile);
    /* Scrolls rather than clips. `overflow: hidden` was here to keep the corner
     * radius, and it also cut the six-column grid off below ~790px — six data
     * columns squeezed into a phone are not readable anyway, so the honest
     * answer is the same as for the tab bar: let it scroll. `hidden` on the
     * cross axis keeps the radius doing its job. */
    overflow-x: auto;
    overflow-y: hidden;
}
.sa-plan-list-toolbar {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-4) var(--sa-space-5);
    border-bottom: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-sunken);
}
/* The search takes the row; the sort hint keeps its content width. */
.sa-plan-list-toolbar > .q-field {
    flex: 1;
}
.sa-plan-list-sortinfo {
    margin-left: auto;
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-subtle);
}

/* List grid */
.sa-plan-list-list {
    display: grid;
    grid-template-columns: 1.6fr 0.9fr 0.7fr 0.9fr 1.4fr 160px;
    /* So the scroll above has something to scroll: without a content floor the
     * tracks shrink to the container and the cells overflow individually,
     * which is the clipped state rather than a scrollable one. */
    min-width: max-content;
    /* Stretch, not centre. Every row is `display: contents`, so its cells are
     * grid items in their own right — and a centred item is only as tall as its
     * own content. The row's hover background is painted per cell, so the band
     * came out notched wherever one column was shorter than its neighbours.
     * The cells fill the row now and centre their contents themselves. */
    align-items: stretch;
}
.sa-plan-list-list-head {
    display: contents;
}
.sa-plan-list-list-head > div {
    display: flex;
    align-items: center;
    background: var(--sa-color-bg-surface-raised);
    padding: var(--sa-space-3) var(--sa-space-5);
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-secondary);
    font-weight: 700;
    border-bottom: 1px solid var(--sa-color-border);
}
.sa-plan-list-empty {
    grid-column: 1 / -1;
    padding: var(--sa-space-8) var(--sa-space-7);
    text-align: center;
    color: var(--sa-color-fg-subtle);
    font-style: italic;
    font-size: var(--sa-text-md);
}
.sa-plan-list-row {
    display: contents;
    cursor: pointer;
}
.sa-plan-list-row > .sa-plan-list-cell {
    /* Column by default — most cells stack a value over a caption. The three
     * that lay their content out in a row say so below. */
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--sa-space-4) var(--sa-space-5);
    border-bottom: 1px solid var(--sa-color-border-soft);
    transition: background 0.12s;
}
.sa-plan-list-row:hover > .sa-plan-list-cell {
    background: var(--sa-color-bg-surface-raised);
}
.sa-plan-list-row--new > .sa-plan-list-cell {
    background: var(--sa-color-positive-surface) !important;
    animation: sa-plan-list-flashNew 2.4s ease-out;
}
@keyframes sa-plan-list-flashNew {
    0% {
        background: var(--sa-color-positive-surface-strong) !important;
    }
    100% {
        background: var(--sa-color-positive-surface) !important;
    }
}

/* Sub-rows (drafts + future-scheduled versions, indented under the parent) */
.sa-plan-list-row--sub > .sa-plan-list-cell {
    background: var(--sa-color-bg-surface-raised);
    padding-top: var(--sa-space-3);
    padding-bottom: var(--sa-space-3);
}
.sa-plan-list-row--sub:hover > .sa-plan-list-cell {
    background: var(--sa-color-border-soft);
}
.sa-plan-list-row > .sa-plan-list-cell--sub-name {
    display: flex;
    flex-direction: row;
    /* The base rule centres on the main axis, which is vertical for a column
     * cell but horizontal here — it would float the indent and leave the tree
     * elbow pointing at nothing. */
    justify-content: flex-start;
    align-items: center;
    gap: var(--sa-space-4);
    padding-left: var(--sa-space-8) !important;
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
    left: var(--sa-space-4);
    width: 14px;
    border-left: 1.5px solid var(--sa-color-border-strong);
    border-bottom: 1.5px solid var(--sa-color-border-strong);
    border-bottom-left-radius: 6px;
}
.sa-plan-list-sub-titles {
    min-width: 0;
}
.sa-plan-list-sub-title {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-secondary);
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
}
.sa-plan-list-sub-desc {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    margin-top: var(--sa-space-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sa-plan-list-version-num--sub {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-secondary);
}
.sa-plan-list-cell--sub-impact {
    color: var(--sa-color-fg-subtle);
}

.sa-plan-list-plan-name {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
}
.sa-plan-list-plan-mark {
    width: 36px;
    height: 36px;
    border-radius: var(--sa-radius-field);
    display: grid;
    place-items: center;
    font: 700 var(--sa-text-xs) var(--sa-font-mono);
    letter-spacing: var(--sa-tracking-wide);
    flex: 0 0 auto;
    border: 1px solid;
}
.sa-plan-list-plan-titles {
    min-width: 0;
}
.sa-plan-list-plan-title {
    font-size: var(--sa-text-lg);
    font-weight: 700;
    color: var(--sa-color-fg-heading);
    letter-spacing: var(--sa-tracking-normal);
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    flex-wrap: wrap;
}
.sa-plan-list-plan-desc {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    margin-top: var(--sa-space-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sa-plan-list-cell--status {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-1);
    align-items: flex-start;
}

/* Chips */
.sa-plan-list-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
    font-size: var(--sa-text-xs);
    font-weight: 600;
    background: var(--sa-color-bg-sunken);
    color: var(--sa-color-fg-secondary);
    border: 1px solid var(--sa-color-border);
}
.sa-plan-list-chip--tiny {
    padding: var(--sa-space-0) var(--sa-space-2);
    font-size: var(--sa-text-2xs);
}
.sa-plan-list-chip--new {
    background: var(--sa-color-info-surface-strong);
    color: var(--sa-color-info-fg);
    border-color: var(--sa-color-info-border);
    font-size: var(--sa-text-2xs);
}
.sa-plan-list-chip--live {
    background: var(--sa-color-positive-surface);
    color: var(--sa-color-positive-fg);
    border-color: var(--sa-color-positive-border);
}
.sa-plan-list-chip--draft {
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
    border-color: var(--sa-color-warning-border);
}
.sa-plan-list-chip--supersed {
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
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
    font-size: var(--sa-text-md);
    font-weight: 700;
    color: var(--sa-color-fg-heading);
}
.sa-plan-list-version-num--muted {
    color: var(--sa-color-fg-disabled);
}
.sa-plan-list-version-sub {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    margin-top: var(--sa-space-1);
}

.sa-plan-list-price-big {
    font-size: var(--sa-text-lg);
    font-weight: 700;
    color: var(--sa-color-fg-heading);
}
.sa-plan-list-price-unit {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}
.sa-plan-list-price-sub {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    margin-top: var(--sa-space-1);
}
.sa-plan-list-price-text {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}

.sa-plan-list-row > .sa-plan-list-cell--tenants {
    display: flex;
    flex-direction: row;
    justify-content: flex-start;
    align-items: center;
    gap: var(--sa-space-3);
}
.sa-plan-list-tenant-num {
    font-size: var(--sa-text-lg);
    font-weight: 700;
    color: var(--sa-color-fg-heading);
}
.sa-plan-list-tenant-bar {
    flex: 1;
    height: 6px;
    background: var(--sa-color-border-soft);
    border-radius: var(--sa-radius-pill);
    overflow: hidden;
}
.sa-plan-list-tenant-bar-fill {
    height: 100%;
}

.sa-plan-list-row > .sa-plan-list-cell--actions {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sa-space-2);
}
</style>
