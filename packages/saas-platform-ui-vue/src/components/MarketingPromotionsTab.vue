<template>
    <div class="mc-promo">
        <!-- Head -->
        <div class="mc-promo-head">
            <div class="mc-promo-head-text">
                <div class="mc-promo-title">{{ msg.promotionsTab.title }}</div>
                <div class="mc-promo-subtitle">{{ msg.promotionsTab.subtitle }}</div>
            </div>
            <div class="mc-promo-stats">
                <span class="mc-promo-stat active">
                    {{ counts.active }} {{ msg.promotionsTab.statusActive }}
                </span>
                <span class="mc-promo-stat scheduled">
                    {{ counts.scheduled }} {{ msg.promotionsTab.statusScheduled }}
                </span>
                <span class="mc-promo-stat expired">
                    {{ counts.expired }} {{ msg.promotionsTab.statusExpired }}
                </span>
            </div>
            <button class="mc-promo-add" type="button" :disabled="busy" @click="onAdd">
                {{ msg.promotionsTab.add }}
            </button>
        </div>

        <!-- Timeline -->
        <div v-if="promotions.length > 0" class="mc-promo-timeline">
            <div class="mc-promo-timeline-head">{{ msg.promotionsTab.timelineHead }}</div>
            <div class="mc-promo-timeline-chart" :style="{ height: `${timelineHeight}px` }">
                <div
                    v-for="t in ticks"
                    :key="t.label + t.x"
                    class="mc-promo-tick"
                    :style="{ left: `${t.x}%` }"
                >
                    <span class="mc-promo-tick-label">{{ t.label }}</span>
                </div>
                <div class="mc-promo-today" :style="{ left: `${todayX}%` }">
                    <span>{{ msg.promotionsTab.today }}</span>
                </div>
                <div
                    v-for="bar in bars"
                    :key="bar.id"
                    class="mc-promo-bar"
                    :class="bar.status"
                    :style="{
                        left: `${bar.left}%`,
                        width: `${bar.width}%`,
                        top: `${bar.top}px`,
                        background: bar.color,
                    }"
                    :title="`${bar.label} · ${bar.from} → ${bar.to}`"
                    @click="expandedId = expandedId === bar.id ? null : bar.id"
                >
                    <span class="mc-promo-bar-label">{{ bar.label }}</span>
                </div>
            </div>
        </div>

        <div v-if="promotions.length === 0" class="mc-promo-empty">
            {{ msg.promotionsTab.emptyBefore }} <strong>{{ msg.promotionsTab.add }}</strong>
            {{ msg.promotionsTab.emptyAfter }}
        </div>

        <!-- List -->
        <div class="mc-promo-list">
            <template v-for="p in sortedPromotions" :key="p.id">
                <div
                    class="mc-promo-row"
                    :class="{ expanded: expandedId === p.id }"
                    @click="expandedId = expandedId === p.id ? null : p.id"
                >
                    <span class="mc-promo-color" :style="{ background: p.color }" />
                    <div class="mc-promo-row-main">
                        <div class="mc-promo-row-title">{{ p.internalLabel }}</div>
                        <div class="mc-promo-row-sub">
                            <span class="mc-promo-typechip">{{ typeChip(p) }}</span>
                            <span v-if="p.appliesTo.length === 0" class="mc-promo-muted">
                                {{ msg.promotionsTab.noPlans }}
                            </span>
                            <span v-for="k in p.appliesTo" :key="k" class="mc-promo-planchip">
                                {{ k }}
                            </span>
                        </div>
                    </div>
                    <div class="mc-promo-row-when">
                        {{ p.validFrom }} → {{ p.validTo }}
                        <span class="mc-promo-cycle">
                            {{ cycleLabel(p.billingCycle) }}
                            <template v-if="p.onlyLocales">
                                · {{ msg.promotionsTab.onlyPrefix }}
                                {{ p.onlyLocales.join(', ').toUpperCase() }}
                            </template>
                        </span>
                    </div>
                    <span class="mc-promo-status" :class="statusOf(p)">
                        {{ statusLabel(statusOf(p)) }}
                    </span>
                </div>

                <!-- Editor -->
                <div v-if="expandedId === p.id" class="mc-promo-editor">
                    <div class="mc-promo-editor-grid">
                        <div class="mc-promo-editor-col">
                            <label class="mc-promo-label">
                                {{ msg.promotionsTab.internalLabelLabel }}
                            </label>
                            <input
                                class="mc-promo-input"
                                :value="p.internalLabel"
                                @change="patch(p, { internalLabel: inputVal($event) })"
                            />

                            <label class="mc-promo-label">{{ msg.promotionsTab.typeLabel }}</label>
                            <div class="mc-promo-typegrid">
                                <button
                                    v-for="t in typeOptions"
                                    :key="t.id"
                                    type="button"
                                    class="mc-promo-typeopt"
                                    :class="{ active: p.type === t.id }"
                                    @click="changeType(p, t.id)"
                                >
                                    {{ t.label }}
                                </button>
                            </div>

                            <label class="mc-promo-label">{{ msg.promotionsTab.valueLabel }}</label>
                            <div class="mc-promo-valrow">
                                <template v-if="p.type === 'percent' || p.type === 'amount'">
                                    <input
                                        class="mc-promo-input mc-promo-input--sm"
                                        type="number"
                                        :value="numValue(p)"
                                        @change="patch(p, { value: numInput($event) })"
                                    />
                                    <span class="mc-promo-muted">
                                        {{
                                            p.type === 'percent'
                                                ? msg.promotionsTab.percentUnit
                                                : msg.promotionsTab.amountUnit
                                        }}
                                    </span>
                                </template>
                                <template v-else-if="p.type === 'intro'">
                                    <span class="mc-promo-muted">
                                        {{ msg.promotionsTab.introForPrefix }}
                                    </span>
                                    <input
                                        class="mc-promo-input mc-promo-input--sm"
                                        type="number"
                                        :value="introMonths(p)"
                                        @change="patchIntro(p, 'months', numInput($event))"
                                    />
                                    <span class="mc-promo-muted">
                                        {{ msg.promotionsTab.introMonthsUnit }}
                                    </span>
                                    <input
                                        class="mc-promo-input mc-promo-input--sm"
                                        type="number"
                                        :value="introPrice(p)"
                                        @change="patchIntro(p, 'price', numInput($event))"
                                    />
                                    <span class="mc-promo-muted">
                                        {{ msg.promotionsTab.introPriceUnit }}
                                    </span>
                                </template>
                                <template v-else>
                                    <span class="mc-promo-muted">
                                        {{ msg.promotionsTab.freeMonthsPrefix }}
                                    </span>
                                    <input
                                        class="mc-promo-input mc-promo-input--sm"
                                        type="number"
                                        :value="numValue(p)"
                                        @change="patch(p, { value: numInput($event) })"
                                    />
                                    <span class="mc-promo-muted">
                                        {{ msg.promotionsTab.freeMonthsUnit }}
                                    </span>
                                </template>
                            </div>

                            <label class="mc-promo-label">
                                {{ msg.promotionsTab.validityLabel }}
                            </label>
                            <div class="mc-promo-valrow">
                                <input
                                    class="mc-promo-input"
                                    type="date"
                                    :value="p.validFrom"
                                    @change="patch(p, { validFrom: inputVal($event) })"
                                />
                                <span class="mc-promo-muted">→</span>
                                <input
                                    class="mc-promo-input"
                                    type="date"
                                    :value="p.validTo"
                                    @change="patch(p, { validTo: inputVal($event) })"
                                />
                            </div>

                            <label class="mc-promo-label">
                                {{ msg.promotionsTab.billingCycleLabel }}
                            </label>
                            <div class="mc-promo-typegrid">
                                <button
                                    v-for="c in cycleOptions"
                                    :key="c.id"
                                    type="button"
                                    class="mc-promo-typeopt"
                                    :class="{ active: p.billingCycle === c.id }"
                                    @click="patch(p, { billingCycle: c.id })"
                                >
                                    {{ c.label }}
                                </button>
                            </div>

                            <label class="mc-promo-label">
                                {{ msg.promotionsTab.priorityLabel }}
                            </label>
                            <input
                                class="mc-promo-input mc-promo-input--sm"
                                type="number"
                                :value="p.priority"
                                @change="patch(p, { priority: numInput($event) })"
                            />
                        </div>

                        <div class="mc-promo-editor-col">
                            <label class="mc-promo-label">
                                {{ msg.promotionsTab.appliesToLabel }}
                            </label>
                            <div class="mc-promo-planlist">
                                <button
                                    v-for="pl in plans"
                                    :key="pl.key"
                                    type="button"
                                    class="mc-promo-planopt"
                                    :class="{ active: p.appliesTo.includes(pl.key) }"
                                    @click="toggleApply(p, pl.key)"
                                >
                                    {{ pl.label }}
                                    <code>{{ pl.key }}</code>
                                </button>
                            </div>

                            <label class="mc-promo-label">
                                {{ msg.promotionsTab.localeRestrictionLabel }}
                            </label>
                            <div class="mc-promo-typegrid">
                                <button
                                    type="button"
                                    class="mc-promo-typeopt"
                                    :class="{ active: !p.onlyLocales }"
                                    @click="patch(p, { onlyLocales: null })"
                                >
                                    {{ msg.promotionsTab.allLocales }}
                                </button>
                                <button
                                    v-for="l in activeLocales"
                                    :key="l"
                                    type="button"
                                    class="mc-promo-typeopt"
                                    :class="{ active: p.onlyLocales?.includes(l) }"
                                    @click="toggleLocale(p, l)"
                                >
                                    {{ msg.promotionsTab.onlyPrefix }} {{ l.toUpperCase() }}
                                </button>
                            </div>

                            <label class="mc-promo-label">
                                {{ msg.promotionsTab.translationsLabel }}
                            </label>
                            <div v-for="l in activeLocales" :key="l" class="mc-promo-i18n-block">
                                <span class="mc-promo-i18n-code">{{ l.toUpperCase() }}</span>
                                <input
                                    class="mc-promo-input"
                                    :placeholder="msg.promotionsTab.badgePlaceholder"
                                    :value="p.i18n?.[l]?.badge || ''"
                                    @change="patchI18n(p, l, 'badge', inputVal($event))"
                                />
                                <input
                                    class="mc-promo-input"
                                    :placeholder="msg.promotionsTab.fineprintPlaceholder"
                                    :value="p.i18n?.[l]?.fineprint || ''"
                                    @change="patchI18n(p, l, 'fineprint', inputVal($event))"
                                />
                            </div>

                            <label class="mc-promo-label">{{ msg.promotionsTab.colorLabel }}</label>
                            <div class="mc-promo-colors">
                                <button
                                    v-for="c in COLORS"
                                    :key="c"
                                    type="button"
                                    class="mc-promo-colorbtn"
                                    :class="{ active: p.color === c }"
                                    :style="{ background: c }"
                                    @click="patch(p, { color: c })"
                                />
                            </div>

                            <button class="mc-promo-delete" type="button" @click="onRemove(p)">
                                {{ msg.promotionsTab.delete }}
                            </button>
                        </div>
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
    promoStatus,
    type CreatePromotionData,
    type PromotionBillingCycle,
    type PromotionRow,
    type PromotionStatus,
    type PromotionType,
    type UpdatePromotionData,
} from '@saasicat/types';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Promotions tab of the Marketing Catalog (SPEC_V2 §9a). Standalone child
// component — the MarketingCatalogPage wires `usePromotions` and passes the
// list + CRUD callbacks through.

const DEFAULT_LOCALE = 'de';

const props = defineProps<{
    promotions: PromotionRow[];
    /** Plan list for the `appliesTo` selection. */
    plans: Array<{ key: string; label: string }>;
    activeLocales: string[];
    busy?: boolean;
    create: (data: CreatePromotionData) => Promise<PromotionRow>;
    update: (id: string, data: UpdatePromotionData) => Promise<PromotionRow>;
    remove: (id: string) => Promise<void>;
    projectKey: string;
}>();

const msg = useSaMessages('marketing');
const common = useSaMessages('common');
const { intlLocale } = useSuperAdminI18n();

const busy = computed(() => props.busy ?? false);
const expandedId = ref<string | null>(null);

const typeOptions = computed<Array<{ id: PromotionType; label: string }>>(() => [
    { id: 'percent', label: msg.value.promotionsTab.typePercent },
    { id: 'amount', label: msg.value.promotionsTab.typeAmount },
    { id: 'intro', label: msg.value.promotionsTab.typeIntro },
    { id: 'freeMonths', label: msg.value.promotionsTab.typeFreeMonths },
]);
const cycleOptions = computed<Array<{ id: PromotionBillingCycle; label: string }>>(() => [
    { id: 'monthly', label: common.value.monthly },
    { id: 'yearly', label: common.value.yearly },
    { id: 'both', label: msg.value.promotionsTab.cycleBoth },
]);
const COLORS = ['#10b981', '#dc2626', '#f59e0b', '#2563eb', '#7c3aed', '#0f172a'];

const today = new Date();

function statusOf(p: PromotionRow): PromotionStatus {
    return promoStatus(p, today);
}
function statusLabel(s: PromotionStatus): string {
    if (s === 'active') return msg.value.promotionsTab.statusActive;
    if (s === 'scheduled') return msg.value.promotionsTab.statusScheduled;
    return msg.value.promotionsTab.statusExpired;
}

const counts = computed(() => ({
    active: props.promotions.filter((p) => statusOf(p) === 'active').length,
    scheduled: props.promotions.filter((p) => statusOf(p) === 'scheduled').length,
    expired: props.promotions.filter((p) => statusOf(p) === 'expired').length,
}));

const sortedPromotions = computed(() => {
    const order: Record<PromotionStatus, number> = { active: 0, scheduled: 1, expired: 2 };
    return [...props.promotions].sort((a, b) => {
        const d = order[statusOf(a)] - order[statusOf(b)];
        if (d !== 0) return d;
        return new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime();
    });
});

function typeChip(p: PromotionRow): string {
    if (p.type === 'percent' && typeof p.value === 'number') return `−${p.value}%`;
    if (p.type === 'amount' && typeof p.value === 'number') return `−${p.value} €`;
    if (p.type === 'intro' && typeof p.value === 'object') {
        return formatMessage(msg.value.promotionsTab.chipIntro, {
            price: p.value.price,
            months: p.value.months,
        });
    }
    if (p.type === 'freeMonths' && typeof p.value === 'number') {
        return formatMessage(msg.value.promotionsTab.chipFreeMonths, { months: p.value });
    }
    return p.type;
}
function cycleLabel(c: PromotionBillingCycle): string {
    if (c === 'both') return msg.value.promotionsTab.cycleBothShort;
    if (c === 'monthly') return msg.value.promotionsTab.cycleMonthlyShort;
    return msg.value.promotionsTab.cycleYearlyShort;
}

// ─── Timeline ───
const axisStart = computed(() => {
    const dates = props.promotions.flatMap((p) => [
        new Date(p.validFrom).getTime(),
        new Date(p.validTo).getTime(),
    ]);
    const min = Math.min(today.getTime(), ...dates);
    return new Date(min - 30 * 86400000);
});
const axisEnd = computed(() => {
    const dates = props.promotions.flatMap((p) => [
        new Date(p.validFrom).getTime(),
        new Date(p.validTo).getTime(),
    ]);
    const max = Math.max(today.getTime(), ...dates);
    return new Date(max + 30 * 86400000);
});
function pct(d: Date | string): number {
    const span = axisEnd.value.getTime() - axisStart.value.getTime();
    if (span <= 0) return 0;
    const v = ((new Date(d).getTime() - axisStart.value.getTime()) / span) * 100;
    return Math.max(0, Math.min(100, v));
}
const todayX = computed(() => pct(today));
function tickLabel(d: Date): string {
    const month = new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString(intlLocale.value, {
        month: 'short',
    });
    return `${month} ${d.getFullYear()}`;
}
const ticks = computed(() => {
    const out: Array<{ x: number; label: string }> = [];
    const start = axisStart.value;
    const end = axisEnd.value;
    const d = new Date(Date.UTC(start.getFullYear(), start.getMonth(), 1));
    while (d <= end) {
        if (d.getMonth() % 3 === 0) {
            out.push({ x: pct(d), label: tickLabel(d) });
        }
        d.setMonth(d.getMonth() + 1);
    }
    return out;
});
const ROW_H = 26;
const bars = computed(() => {
    const rows: Array<Array<{ from: number; to: number }>> = [];
    return sortedPromotions.value.map((p) => {
        const left = pct(p.validFrom);
        const right = pct(p.validTo);
        let rowIdx = rows.findIndex(
            (r) => !r.some((b) => !(b.to < left - 1 || b.from > right + 1)),
        );
        if (rowIdx === -1) {
            rowIdx = rows.length;
            rows.push([]);
        }
        rows[rowIdx].push({ from: left, to: right });
        return {
            id: p.id,
            label: p.internalLabel,
            color: p.color,
            status: statusOf(p),
            from: p.validFrom,
            to: p.validTo,
            left,
            width: Math.max(2, right - left),
            top: 8 + rowIdx * ROW_H,
        };
    });
});
const timelineHeight = computed(() => {
    const rowCount = Math.max(1, ...bars.value.map((b) => (b.top - 8) / ROW_H + 1));
    return 16 + rowCount * ROW_H + 22;
});

// ─── Mutations ───
function inputVal(e: Event): string {
    return (e.target as HTMLInputElement).value;
}
function numInput(e: Event): number {
    return Number((e.target as HTMLInputElement).value) || 0;
}
function numValue(p: PromotionRow): number {
    return typeof p.value === 'number' ? p.value : 0;
}
function introPrice(p: PromotionRow): number {
    return typeof p.value === 'object' ? p.value.price : 0;
}
function introMonths(p: PromotionRow): number {
    return typeof p.value === 'object' ? p.value.months : 0;
}

function patch(p: PromotionRow, data: UpdatePromotionData): void {
    void props.update(p.id, data);
}
function patchIntro(p: PromotionRow, field: 'price' | 'months', value: number): void {
    const base = typeof p.value === 'object' ? p.value : { price: 0, months: 3 };
    patch(p, { value: { ...base, [field]: value } });
}
function changeType(p: PromotionRow, type: PromotionType): void {
    let value: PromotionRow['value'] = 10;
    if (type === 'intro') value = { price: 9, months: 3 };
    if (type === 'freeMonths') value = 2;
    patch(p, { type, value });
}
function toggleApply(p: PromotionRow, planKey: string): void {
    const has = p.appliesTo.includes(planKey);
    patch(p, {
        appliesTo: has ? p.appliesTo.filter((k) => k !== planKey) : [...p.appliesTo, planKey],
    });
}
function toggleLocale(p: PromotionRow, locale: string): void {
    const cur = p.onlyLocales ?? [];
    const next = cur.includes(locale) ? cur.filter((l) => l !== locale) : [...cur, locale];
    patch(p, { onlyLocales: next.length === 0 ? null : next });
}
function patchI18n(
    p: PromotionRow,
    locale: string,
    field: 'badge' | 'fineprint',
    value: string,
): void {
    const i18n = { ...(p.i18n ?? {}) };
    const entry = { ...(i18n[locale] ?? {}) };
    if (value) entry[field] = value;
    else delete entry[field];
    i18n[locale] = entry;
    patch(p, { i18n });
}

async function onAdd(): Promise<void> {
    const created = await props.create({
        projectKey: props.projectKey,
        internalLabel: msg.value.promotionsTab.newPromotionLabel,
        type: 'percent',
        value: 10,
        appliesTo: [],
        billingCycle: 'both',
        validFrom: new Date().toISOString().slice(0, 10),
        validTo: new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10),
        priority: 5,
        color: '#2563eb',
        i18n: { [DEFAULT_LOCALE]: { badge: 'Aktion' } },
    });
    expandedId.value = created.id;
}

async function onRemove(p: PromotionRow): Promise<void> {
    const question = formatMessage(msg.value.promotionsTab.deleteConfirm, {
        label: p.internalLabel,
    });
    if (!window.confirm(question)) return;
    if (expandedId.value === p.id) expandedId.value = null;
    await props.remove(p.id);
}
</script>

<style scoped>
.mc-promo {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.mc-promo-head {
    display: flex;
    align-items: center;
    gap: 16px;
}
.mc-promo-head-text {
    flex: 1;
}
.mc-promo-title {
    font-size: 15px;
    font-weight: 700;
}
.mc-promo-subtitle {
    font-size: 12px;
    color: #64748b;
}
.mc-promo-stats {
    display: flex;
    gap: 8px;
}
.mc-promo-stat {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: 999px;
    background: #f1f5f9;
    color: #475569;
}
.mc-promo-stat.active {
    background: #dcfce7;
    color: #166534;
}
.mc-promo-stat.scheduled {
    background: #dbeafe;
    color: #1d4ed8;
}
.mc-promo-stat.expired {
    background: #f1f5f9;
    color: #94a3b8;
}
.mc-promo-add {
    border: 0;
    background: #3f6bff;
    color: #fff;
    font-weight: 600;
    font-size: 13px;
    padding: 8px 14px;
    border-radius: 8px;
    cursor: pointer;
}
.mc-promo-add:disabled {
    opacity: 0.5;
    cursor: default;
}
.mc-promo-timeline {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
}
.mc-promo-timeline-head {
    font-size: 11px;
    color: #64748b;
    margin-bottom: 6px;
}
.mc-promo-timeline-chart {
    position: relative;
    border-left: 1px solid #e2e8f0;
}
.mc-promo-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: #f1f5f9;
}
.mc-promo-tick-label {
    position: absolute;
    bottom: 0;
    left: 3px;
    font-size: 9px;
    color: #94a3b8;
    white-space: nowrap;
}
.mc-promo-today {
    position: absolute;
    top: 0;
    bottom: 18px;
    width: 0;
    border-left: 2px dashed #ef4444;
}
.mc-promo-today span {
    position: absolute;
    top: -2px;
    left: 3px;
    font-size: 9px;
    color: #ef4444;
    font-weight: 700;
}
.mc-promo-bar {
    position: absolute;
    height: 20px;
    border-radius: 5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    overflow: hidden;
    opacity: 0.92;
}
.mc-promo-bar.expired {
    opacity: 0.45;
}
.mc-promo-bar-label {
    font-size: 10px;
    color: #fff;
    font-weight: 600;
    padding: 0 6px;
    white-space: nowrap;
}
.mc-promo-empty {
    padding: 28px;
    text-align: center;
    color: #94a3b8;
    font-size: 13px;
    border: 1px dashed #cbd5e1;
    border-radius: 10px;
}
.mc-promo-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.mc-promo-row {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px 12px;
    cursor: pointer;
}
.mc-promo-row.expanded {
    border-color: #3f6bff;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
}
.mc-promo-color {
    width: 10px;
    height: 28px;
    border-radius: 3px;
    flex-shrink: 0;
}
.mc-promo-row-main {
    flex: 1;
    min-width: 0;
}
.mc-promo-row-title {
    font-size: 13px;
    font-weight: 600;
}
.mc-promo-row-sub {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 2px;
}
.mc-promo-typechip {
    font-size: 10px;
    font-weight: 700;
    background: #eff6ff;
    color: #1d4ed8;
    padding: 1px 6px;
    border-radius: 4px;
}
.mc-promo-planchip {
    font-size: 10px;
    background: #f1f5f9;
    color: #475569;
    padding: 1px 6px;
    border-radius: 4px;
}
.mc-promo-muted {
    font-size: 11px;
    color: #94a3b8;
}
.mc-promo-row-when {
    font-size: 11px;
    color: #64748b;
    text-align: right;
}
.mc-promo-cycle {
    display: block;
    color: #94a3b8;
}
.mc-promo-status {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 6px;
}
.mc-promo-status.active {
    background: #dcfce7;
    color: #166534;
}
.mc-promo-status.scheduled {
    background: #dbeafe;
    color: #1d4ed8;
}
.mc-promo-status.expired {
    background: #f1f5f9;
    color: #94a3b8;
}
.mc-promo-editor {
    border: 1px solid #3f6bff;
    border-top: 0;
    border-radius: 0 0 8px 8px;
    background: #f8fafc;
    padding: 14px;
}
.mc-promo-editor-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
}
.mc-promo-editor-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.mc-promo-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #475569;
    margin-top: 6px;
}
.mc-promo-input {
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 13px;
}
.mc-promo-input--sm {
    max-width: 90px;
}
.mc-promo-valrow {
    display: flex;
    gap: 8px;
    align-items: center;
}
.mc-promo-typegrid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.mc-promo-typeopt {
    border: 1px solid #cbd5e1;
    background: #fff;
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
}
.mc-promo-typeopt.active {
    border-color: #3f6bff;
    background: #eff6ff;
    color: #1d4ed8;
    font-weight: 600;
}
.mc-promo-planlist {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.mc-promo-planopt {
    display: flex;
    justify-content: space-between;
    border: 1px solid #cbd5e1;
    background: #fff;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
}
.mc-promo-planopt.active {
    border-color: #3f6bff;
    background: #eff6ff;
}
.mc-promo-planopt code {
    color: #94a3b8;
    font-size: 10px;
}
.mc-promo-i18n-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #fff;
}
.mc-promo-i18n-code {
    font-size: 10px;
    font-weight: 700;
    background: #f1f5f9;
    padding: 2px 7px;
    border-radius: 5px;
    align-self: flex-start;
}
.mc-promo-colors {
    display: flex;
    gap: 6px;
}
.mc-promo-colorbtn {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 2px solid transparent;
    cursor: pointer;
}
.mc-promo-colorbtn.active {
    border-color: #0f172a;
}
.mc-promo-delete {
    margin-top: 12px;
    align-self: flex-start;
    border: 1px solid #fecaca;
    background: #fef2f2;
    color: #b91c1c;
    font-weight: 600;
    font-size: 12px;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
}
</style>
