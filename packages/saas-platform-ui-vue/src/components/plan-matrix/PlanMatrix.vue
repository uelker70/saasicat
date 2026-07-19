<template>
    <div class="pm">
        <!-- Page header -->
        <div class="pm-page-head">
            <div>
                <h2 class="pm-h-title">Pläne · Matrix-Vergleich</h2>
                <p class="pm-h-sub">
                    Alle Pläne nebeneinander · {{ plans.length }} Pläne ·
                    {{ orderedFeatureKeys.length }} Features · {{ orderedQuotaKeys.length }} Quotas
                    · {{ orderedBundleKeys.length }} Bundles
                </p>
            </div>
            <div class="pm-head-actions">
                <button class="pm-btn" type="button" @click="$emit('viewCatalog')">
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                    <span>Catalog-Vorschau</span>
                </button>
                <button class="pm-btn pm-btn--primary" type="button" @click="$emit('createPlan')">
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                    >
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                    <span>Plan anlegen</span>
                </button>
            </div>
        </div>

        <!-- Matrix -->
        <div class="pm-card pm-wrap">
            <table class="pm-table">
                <thead>
                    <tr class="pm-head">
                        <th class="pm-rowhead-cell">
                            <span class="pm-component-kicker">Komponente</span>
                        </th>
                        <th v-for="p in resolvedPlans" :key="p.planKey" class="pm-plan-head">
                            <div
                                class="pm-plan-card"
                                :style="{ borderTopColor: planAccent(p.planKey) }"
                            >
                                <div class="pm-plan-top">
                                    <div>
                                        <div class="pm-plan-key">{{ p.planKey }}</div>
                                        <div class="pm-plan-label">{{ p.label }}</div>
                                    </div>
                                    <button
                                        class="pm-kebab"
                                        type="button"
                                        @click="$emit('openPlan', p.plan)"
                                    >
                                        ⋯
                                    </button>
                                </div>
                                <div class="pm-plan-desc">{{ p.description || ' ' }}</div>
                                <div class="pm-plan-divider" />

                                <div class="pm-status-row">
                                    <span v-if="p.live" class="pm-chip pm-chip--live pm-chip--dot"
                                        >v{{ p.live.version }} live</span
                                    >
                                    <span v-else class="pm-chip pm-chip--supersed pm-chip--dot"
                                        >keine live</span
                                    >
                                    <span
                                        v-if="p.draft"
                                        class="pm-chip pm-chip--draft pm-chip--dot"
                                    >
                                        v{{ p.draft.version }} Entwurf
                                    </span>
                                </div>

                                <div class="pm-price">
                                    <template
                                        v-if="
                                            p.live &&
                                            Number(p.live.monthlyNet) === 0 &&
                                            Number(p.live.yearlyNet) === 0
                                        "
                                    >
                                        <span class="pm-price-free">Kostenlos</span>
                                    </template>
                                    <template v-else-if="p.live">
                                        <span class="pm-price-big">{{
                                            formatMoney(p.live.monthlyNet)
                                        }}</span>
                                        <span class="pm-price-unit">/ Mo</span>
                                        <span class="pm-price-yearly"
                                            >· {{ formatMoney(p.live.yearlyNet) }}/J</span
                                        >
                                    </template>
                                    <template v-else-if="p.draft">
                                        <span class="pm-price-big">{{
                                            formatMoney(p.draft.monthlyNet)
                                        }}</span>
                                        <span class="pm-price-unit">/ Mo</span>
                                        <span class="pm-price-yearly">(Entwurf)</span>
                                    </template>
                                    <template v-else>
                                        <span class="pm-price-free">noch keine Preise</span>
                                    </template>
                                </div>

                                <div class="pm-plan-meta">
                                    <span>{{ p.tenantCount }} Mandanten</span>
                                    <template v-if="p.live?.validFrom">
                                        <span>·</span>
                                        <span>ab {{ p.live.validFrom.slice(0, 10) }}</span>
                                    </template>
                                    <span
                                        :class="[
                                            'pm-chip pm-chip--tiny',
                                            p.live?.marketed ? '' : 'pm-chip--supersed',
                                        ]"
                                    >
                                        {{ p.live?.marketed ? 'im Katalog' : 'privat' }}
                                    </span>
                                </div>

                                <div class="pm-plan-actions">
                                    <button
                                        class="pm-btn pm-btn--sm pm-btn--flex"
                                        type="button"
                                        @click="$emit('openPlan', p.plan)"
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
                                        <span>Öffnen</span>
                                    </button>
                                    <button
                                        class="pm-btn pm-btn--sm pm-btn--ghost"
                                        type="button"
                                        @click="$emit('clonePlan', p.plan)"
                                        aria-label="Plan klonen"
                                    >
                                        <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                        >
                                            <rect x="9" y="9" width="11" height="11" rx="2" />
                                            <path d="M5 15V5a2 2 0 012-2h10" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </th>
                        <th class="pm-add-col">
                            <button class="pm-add" type="button" @click="$emit('createPlan')">
                                <div class="pm-add-icon">
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2.5"
                                    >
                                        <path d="M12 5v14M5 12h14" />
                                    </svg>
                                </div>
                                <div class="pm-add-title">Plan anlegen</div>
                                <div class="pm-add-sub">oder Klon erstellen</div>
                            </button>
                        </th>
                    </tr>
                </thead>

                <tbody>
                    <!-- Quotas section -->
                    <tr class="pm-group">
                        <td :colspan="resolvedPlans.length + 2">
                            <div class="pm-group-inner">
                                <span class="pm-group-dot pm-group-dot--quota" />
                                <span>Quotas</span>
                                <span class="pm-group-count">{{ orderedQuotaKeys.length }}</span>
                            </div>
                        </td>
                    </tr>
                    <tr v-for="qKey in orderedQuotaKeys" :key="`q-${qKey}`" class="pm-row">
                        <td class="pm-rowhead">
                            <div class="pm-rowhead-inner">
                                <div class="pm-rh-label">{{ quotaLabel(qKey) }}</div>
                                <code class="pm-rh-key">{{ qKey }}</code>
                            </div>
                        </td>
                        <td
                            v-for="p in resolvedPlans"
                            :key="`q-${qKey}-${p.planKey}`"
                            :class="[
                                'pm-cell',
                                'pm-cell--val',
                                isDraftSource(p) ? 'pm-cell--draftsrc' : '',
                            ]"
                        >
                            <div v-if="quotaValueFor(p, qKey) !== undefined" class="pm-quota">
                                <span class="pm-num">{{
                                    formatQuota(quotaValueFor(p, qKey))
                                }}</span>
                                <span v-if="quotaUnit(qKey)" class="pm-unit">{{
                                    quotaUnit(qKey)
                                }}</span>
                            </div>
                            <span v-else class="pm-dash">—</span>
                        </td>
                        <td />
                    </tr>

                    <!-- Features section -->
                    <tr class="pm-group">
                        <td :colspan="resolvedPlans.length + 2">
                            <div class="pm-group-inner">
                                <span class="pm-group-dot pm-group-dot--feature" />
                                <span>Features</span>
                                <span class="pm-group-count">{{ orderedFeatureKeys.length }}</span>
                            </div>
                        </td>
                    </tr>
                    <tr v-for="fKey in orderedFeatureKeys" :key="`f-${fKey}`" class="pm-row">
                        <td class="pm-rowhead">
                            <div class="pm-rowhead-inner">
                                <div class="pm-rh-label">{{ featureLabel(fKey) }}</div>
                                <code class="pm-rh-key">{{ fKey }}</code>
                            </div>
                        </td>
                        <!-- Core-Features sind Basis-Infrastruktur: in jedem Plan
                             enthalten, daher kein pro-Plan-Häkchen sondern ein
                             einzelnes „Basis"-Badge über alle Plan-Spalten. -->
                        <td
                            v-if="isCoreFeature(fKey)"
                            class="pm-cell pm-cell--base"
                            :colspan="resolvedPlans.length"
                        >
                            <span class="pm-base-badge">
                                <svg
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2.5"
                                >
                                    <path d="M5 13l4 4L19 7" />
                                </svg>
                                Basis · immer enthalten
                            </span>
                        </td>
                        <template v-else>
                            <td
                                v-for="p in resolvedPlans"
                                :key="`f-${fKey}-${p.planKey}`"
                                :class="[
                                    'pm-cell',
                                    hasFeature(p, fKey) ? 'pm-cell--ok' : 'pm-cell--no',
                                    isDraftSource(p) ? 'pm-cell--draftsrc' : '',
                                ]"
                            >
                                <span
                                    v-if="hasFeature(p, fKey)"
                                    class="pm-check"
                                    :style="{
                                        background: planAccent(p.planKey) + '15',
                                        color: planAccent(p.planKey),
                                    }"
                                >
                                    <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="3"
                                    >
                                        <path d="M5 13l4 4L19 7" />
                                    </svg>
                                </span>
                                <span v-else class="pm-dash">—</span>
                            </td>
                        </template>
                        <td />
                    </tr>

                    <!-- Bundles section -->
                    <tr v-if="orderedBundleKeys.length > 0" class="pm-group">
                        <td :colspan="resolvedPlans.length + 2">
                            <div class="pm-group-inner">
                                <span class="pm-group-dot pm-group-dot--bundle" />
                                <span>Bundles</span>
                                <span class="pm-group-count">{{ orderedBundleKeys.length }}</span>
                            </div>
                        </td>
                    </tr>
                    <tr v-for="bKey in orderedBundleKeys" :key="`b-${bKey}`" class="pm-row">
                        <td class="pm-rowhead">
                            <div class="pm-rowhead-inner">
                                <div class="pm-rh-label">{{ bundleLabel(bKey) }}</div>
                                <code class="pm-rh-key">{{ bKey }}</code>
                            </div>
                        </td>
                        <td
                            v-for="p in resolvedPlans"
                            :key="`b-${bKey}-${p.planKey}`"
                            :class="[
                                'pm-cell',
                                hasBundle(p, bKey) ? 'pm-cell--ok' : 'pm-cell--no',
                                isDraftSource(p) ? 'pm-cell--draftsrc' : '',
                            ]"
                        >
                            <span
                                v-if="hasBundle(p, bKey)"
                                class="pm-check"
                                :style="{
                                    background: planAccent(p.planKey) + '15',
                                    color: planAccent(p.planKey),
                                }"
                            >
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="3"
                                >
                                    <path d="M5 13l4 4L19 7" />
                                </svg>
                            </span>
                            <span v-else class="pm-dash">—</span>
                        </td>
                        <td />
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Legend -->
        <div class="pm-legend">
            <span class="pm-legend-item">
                <span class="pm-legend-check"
                    ><svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                    >
                        <path d="M5 13l4 4L19 7" /></svg
                ></span>
                enthalten
            </span>
            <span class="pm-legend-item">
                <span class="pm-legend-dash">—</span>
                nicht enthalten
            </span>
            <span v-if="loading" class="pm-legend-loading">lade Versionen…</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PlanRow, PlanVersionRow } from '@saasicat/types';

// PlanMatrix — V1 Matrix-Übersicht. Pläne als Spalten, Quotas/Features/
// Bundles als Zeilen. Erwartet die Plan-Stamm-Liste plus pro Plan das
// Mapping auf seine PlanVersionen (Live + Draft). Die Daten kommen vom
// Konsumenten (PlansPage), der pro Plan via usePlanVersions lädt.

interface BundleEntry {
    bundleKey: string;
    label?: string | null;
    features: string[];
    /** Plan-Keys, für die das Bundle buchbar ist (leer/fehlend = alle Pläne).
     *  Quelle: BundleVersion.compatibility.planIds — enthält Plan-KEYS. */
    compatiblePlanKeys?: string[] | null;
}

interface DiscoveryQuota {
    quotaKey: string;
    label?: string | null;
    unit?: string | null;
}

interface FeatureMeta {
    label?: string;
    /** true = Basis-Infrastruktur, in jedem Plan enthalten (nicht pro Plan buchbar). */
    core?: boolean;
}

const props = withDefaults(
    defineProps<{
        plans: PlanRow[];
        /** Versionen pro Plan (id → PlanVersionRow[]). */
        versionsByPlanId: Record<string, PlanVersionRow[]>;
        /** Discovery-Quotas (für Labels + Units). */
        availableQuotas?: DiscoveryQuota[];
        /** Bundles für die Bundle-Sektion. */
        availableBundles?: BundleEntry[];
        /** Feature-Label-Map. */
        featureRegistry?: Record<string, FeatureMeta>;
        /** Tenant-Anzahl pro planKey (für Plan-Header). */
        tenantCountsByPlanKey?: Record<string, number>;
        /** Akzentfarbe pro planKey für Card-Top-Border + Check-Badge. */
        planAccents?: Record<string, string>;
        loading?: boolean;
    }>(),
    {
        availableQuotas: () => [],
        availableBundles: () => [],
        featureRegistry: () => ({}),
        tenantCountsByPlanKey: () => ({}),
        planAccents: () => ({}),
        loading: false,
    },
);

defineEmits<{
    (e: 'openPlan', plan: PlanRow): void;
    (e: 'createPlan'): void;
    (e: 'clonePlan', plan: PlanRow): void;
    (e: 'viewCatalog'): void;
}>();

interface ResolvedPlan {
    plan: PlanRow;
    planKey: string;
    label: string;
    description: string | null;
    live: PlanVersionRow | null;
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

const resolvedPlans = computed<ResolvedPlan[]>(() =>
    [...props.plans]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.planKey.localeCompare(b.planKey))
        .map((plan) => {
            const versions = props.versionsByPlanId[plan.id] ?? [];
            const live =
                versions.find((v) => v.publishedAt !== null && v.supersededAt === null) ?? null;
            const draft = versions.find((v) => v.publishedAt === null) ?? null;
            return {
                plan,
                planKey: plan.planKey,
                label: plan.label,
                description: plan.description ?? null,
                live,
                draft,
                tenantCount: props.tenantCountsByPlanKey[plan.planKey] ?? 0,
            };
        }),
);

function quotasOf(v: PlanVersionRow | null): Record<string, number> {
    if (!v) return {};
    if (v.quotas && Object.keys(v.quotas).length > 0) return v.quotas;
    const legacy: Record<string, number> = {};
    if (typeof v.maxUsers === 'number') legacy.users = v.maxUsers;
    if (typeof v.maxVehicles === 'number') legacy.vehicles = v.maxVehicles;
    if (typeof v.maxStorageGb === 'number') legacy.storageGb = v.maxStorageGb;
    return legacy;
}

/**
 * Effektive Version einer Spalte: live, sonst Entwurf. Damit bildet die
 * Matrix auch reine Draft-Pläne ab (Erstbefüllung vor dem ersten Publish);
 * Draft-Spalten sind via `isDraftSource` visuell markiert.
 */
function effectiveOf(p: ResolvedPlan): PlanVersionRow | null {
    return p.live ?? p.draft;
}

function isDraftSource(p: ResolvedPlan): boolean {
    return !p.live && !!p.draft;
}

function quotaValueFor(p: ResolvedPlan, key: string): number | undefined {
    const q = quotasOf(effectiveOf(p));
    return Object.prototype.hasOwnProperty.call(q, key) ? q[key] : undefined;
}

const orderedQuotaKeys = computed<string[]>(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const q of props.availableQuotas) {
        if (!seen.has(q.quotaKey)) {
            seen.add(q.quotaKey);
            ordered.push(q.quotaKey);
        }
    }
    for (const p of resolvedPlans.value) {
        for (const k of Object.keys(quotasOf(effectiveOf(p)))) {
            if (!seen.has(k)) {
                seen.add(k);
                ordered.push(k);
            }
        }
    }
    return ordered;
});

const orderedFeatureKeys = computed<string[]>(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const key of Object.keys(props.featureRegistry)) {
        if (!seen.has(key)) {
            seen.add(key);
            ordered.push(key);
        }
    }
    for (const p of resolvedPlans.value) {
        const version = effectiveOf(p);
        if (!version) continue;
        for (const f of version.features) {
            if (!seen.has(f)) {
                seen.add(f);
                ordered.push(f);
            }
        }
    }
    // Treppen-Sortierung: zuerst Features mit der breitesten Plan-Abdeckung;
    // bei Gleichstand gewinnen die, die schon in den günstigeren Plänen
    // (linke Spalten) enthalten sind — so entsteht die Treppe. Features ohne
    // jede Zuordnung landen unten; innerhalb gleicher Stufen alphabetisch.
    const presence = new Map<string, { count: number; mask: string }>();
    for (const key of ordered) {
        let count = 0;
        let mask = '';
        for (const p of resolvedPlans.value) {
            const has = hasFeature(p, key);
            mask += has ? '1' : '0';
            if (has) count += 1;
        }
        presence.set(key, { count, mask });
    }
    return ordered.sort((a, b) => {
        const pa = presence.get(a)!;
        const pb = presence.get(b)!;
        if (pa.count !== pb.count) return pb.count - pa.count;
        if (pa.mask !== pb.mask) return pb.mask.localeCompare(pa.mask);
        return featureLabel(a).localeCompare(featureLabel(b), 'de-DE');
    });
});

const orderedBundleKeys = computed<string[]>(() => props.availableBundles.map((b) => b.bundleKey));

function quotaLabel(key: string): string {
    return props.availableQuotas.find((q) => q.quotaKey === key)?.label || key;
}
function quotaUnit(key: string): string {
    return props.availableQuotas.find((q) => q.quotaKey === key)?.unit || '';
}
function featureLabel(key: string): string {
    return props.featureRegistry[key]?.label ?? key;
}
function isCoreFeature(key: string): boolean {
    return props.featureRegistry[key]?.core === true;
}
function bundleLabel(key: string): string {
    return props.availableBundles.find((b) => b.bundleKey === key)?.label || key;
}

function hasFeature(p: ResolvedPlan, fKey: string): boolean {
    const version = effectiveOf(p);
    return !!version && version.features.includes(fKey);
}

function hasBundle(p: ResolvedPlan, bKey: string): boolean {
    const bundle = props.availableBundles.find((b) => b.bundleKey === bKey);
    if (!bundle) return false;
    // Verfügbarkeit = Plan-Kompatibilität des Bundles (leer = alle Pläne).
    // Früher fälschlich „alle Bundle-Features im Plan enthalten" → ein auf
    // einen Plan beschränktes Bundle erschien dadurch für ALLE Pläne.
    const compat = bundle.compatiblePlanKeys ?? [];
    return compat.length === 0 || compat.includes(p.planKey);
}

function formatMoney(raw: string | number): string {
    const num = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(num)) return String(raw);
    if (Number.isInteger(num)) return `${num} €`;
    return `${num.toFixed(2).replace('.', ',')} €`;
}

function formatQuota(v: number | undefined): string {
    if (v === undefined) return '—';
    if (v === -1) return '∞';
    return String(v);
}
</script>

<style scoped>
.pm {
    --pm-bg: #f6f7f9;
    --pm-surface: #ffffff;
    --pm-surface-2: #f8fafc;
    --pm-border: #e5e7eb;
    --pm-border-strong: #d1d5db;
    --pm-text: #0f172a;
    --pm-text-2: #475569;
    --pm-text-3: #94a3b8;
    --pm-primary: #2563eb;
    --pm-live: #10b981;
    --pm-live-bg: #ecfdf5;
    --pm-draft: #f59e0b;
    --pm-draft-bg: #fffbeb;
    --pm-supersed: #94a3b8;
    --pm-supersed-bg: #f1f5f9;
    --pm-font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --pm-font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

    padding: 22px 26px;
    background: var(--pm-bg);
    color: var(--pm-text);
    font-family: var(--pm-font-sans);
    min-height: 100%;
    box-sizing: border-box;
}
.pm * {
    box-sizing: border-box;
}

.pm-page-head {
    display: flex;
    align-items: flex-end;
    gap: 20px;
    margin-bottom: 18px;
}
.pm-h-title {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0;
}
.pm-h-sub {
    font-size: 12.5px;
    color: var(--pm-text-2);
    margin: 3px 0 0;
}
.pm-head-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
}

.pm-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px;
    border-radius: 7px;
    font: 500 13px var(--pm-font-sans);
    cursor: pointer;
    border: 1px solid var(--pm-border-strong);
    background: #fff;
    color: var(--pm-text);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.pm-btn:hover {
    background: var(--pm-surface-2);
}
.pm-btn--primary {
    background: var(--pm-primary);
    border-color: var(--pm-primary);
    color: #fff;
}
.pm-btn--primary:hover {
    background: #1d4ed8;
}
.pm-btn--ghost {
    border-color: transparent;
    background: transparent;
}
.pm-btn--ghost:hover {
    background: rgba(15, 23, 42, 0.05);
}
.pm-btn--sm {
    padding: 5px 9px;
    font-size: 12px;
    gap: 5px;
}
.pm-btn--flex {
    flex: 1;
}

.pm-card {
    background: var(--pm-surface);
    border: 1px solid var(--pm-border);
    border-radius: 10px;
}
.pm-wrap {
    overflow: auto;
}

.pm-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 13px;
}
.pm-head th {
    background: #fbfbfd;
    border-bottom: 1px solid var(--pm-border);
}
.pm-rowhead-cell {
    text-align: left;
    padding: 12px 16px;
    vertical-align: bottom;
    width: 280px;
    min-width: 240px;
}
.pm-component-kicker {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--pm-text-3);
    font-weight: 700;
}

.pm-plan-head {
    padding: 12px 8px;
    vertical-align: top;
    min-width: 200px;
}
.pm-plan-card {
    background: #fff;
    border: 1px solid var(--pm-border);
    border-top: 3px solid;
    border-radius: 10px;
    padding: 14px 14px 12px;
    display: flex;
    flex-direction: column;
}
.pm-plan-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}
.pm-plan-key {
    font: 700 11px var(--pm-font-mono);
    letter-spacing: 0.08em;
    color: var(--pm-text-2);
}
.pm-plan-label {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--pm-text);
}
.pm-plan-desc {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 4px;
    line-height: 1.4;
    min-height: 32px;
}
.pm-plan-divider {
    height: 1px;
    background: var(--pm-border);
    margin: 10px 0;
}
.pm-kebab {
    background: none;
    border: 0;
    color: var(--pm-text-3);
    cursor: pointer;
    font-size: 16px;
    padding: 0;
    line-height: 1;
}
.pm-status-row {
    display: flex;
    gap: 5px;
    align-items: center;
    flex-wrap: wrap;
}
.pm-price {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-top: 10px;
    flex-wrap: wrap;
}
.pm-price-big {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
}
.pm-price-unit {
    font-size: 11px;
    color: #64748b;
}
.pm-price-yearly {
    font-size: 10px;
    color: var(--pm-text-3);
    margin-left: 4px;
}
.pm-price-free {
    font-size: 14px;
    font-weight: 600;
    color: var(--pm-text);
}
.pm-plan-meta {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
    font-size: 11px;
    color: #64748b;
    margin-top: 8px;
}
.pm-plan-actions {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid #f1f5f9;
}

.pm-add-col {
    width: 130px;
    padding: 12px 8px;
    vertical-align: top;
}
.pm-add {
    border: 1.5px dashed #c7d2fe;
    border-radius: 10px;
    padding: 16px 10px;
    background: #f5f7ff;
    text-align: center;
    cursor: pointer;
    min-height: 180px;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    font-family: inherit;
}
.pm-add:hover {
    background: #eef2ff;
    border-color: #818cf8;
}
.pm-add-icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #eff6ff;
    color: var(--pm-primary);
    margin: 0 auto 6px;
}
.pm-add-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--pm-primary);
}
.pm-add-sub {
    font-size: 10.5px;
    color: var(--pm-text-3);
    margin-top: 3px;
}

/* Chips */
.pm-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--pm-surface-2);
    color: var(--pm-text-2);
    border: 1px solid var(--pm-border);
}
.pm-chip--tiny {
    padding: 1px 6px;
    font-size: 10px;
}
.pm-chip--live {
    background: var(--pm-live-bg);
    color: #047857;
    border-color: #a7f3d0;
}
.pm-chip--draft {
    background: var(--pm-draft-bg);
    color: #b45309;
    border-color: #fde68a;
}
.pm-chip--supersed {
    background: var(--pm-supersed-bg);
    color: var(--pm-text-2);
    border-color: #cbd5e1;
}
.pm-chip--dot::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

/* Group rows */
.pm-group td {
    background: var(--pm-surface-2);
    border-top: 1px solid var(--pm-border);
    border-bottom: 1px solid var(--pm-border);
}
.pm-group-inner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--pm-text-2);
}
.pm-group-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
}
.pm-group-dot--quota {
    background: #0ea5e9;
}
.pm-group-dot--feature {
    background: #8b5cf6;
}
.pm-group-dot--bundle {
    background: #f59e0b;
}
.pm-group-count {
    background: #e2e8f0;
    color: var(--pm-text-2);
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 10px;
}

/* Data rows */
.pm-row td {
    border-bottom: 1px solid #f1f5f9;
    height: 44px;
}
.pm-row:hover td {
    background: #fcfcfd;
}
.pm-rowhead {
    padding: 8px 16px;
}
.pm-rowhead-inner {
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.pm-rh-label {
    font-size: 13px;
    font-weight: 500;
    color: var(--pm-text);
}
.pm-rh-key {
    font: 500 10px var(--pm-font-mono);
    color: var(--pm-text-3);
}
.pm-cell {
    text-align: center;
    padding: 8px 12px;
    vertical-align: middle;
}
/* Spalte speist sich aus einem unveröffentlichten Entwurf (kein live). */
.pm-cell--draftsrc {
    opacity: 0.62;
    background-image: repeating-linear-gradient(
        135deg,
        transparent 0 6px,
        rgba(217, 119, 6, 0.05) 6px 7px
    );
}
.pm-cell--base {
    text-align: center;
    background: var(--pm-surface-2);
}
.pm-base-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 12px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    background: #eef2ff;
    color: #4338ca;
    border: 1px solid #c7d2fe;
}
.pm-check {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
}
.pm-dash {
    color: #cbd5e1;
    font-weight: 500;
}
.pm-num {
    font: 600 14px var(--pm-font-sans);
    color: var(--pm-text);
}
.pm-unit {
    font-size: 10.5px;
    color: var(--pm-text-3);
    margin-left: 3px;
}
.pm-quota {
    display: flex;
    align-items: baseline;
    justify-content: center;
}

/* Legend */
.pm-legend {
    display: flex;
    gap: 18px;
    margin-top: 14px;
    font-size: 12px;
    color: var(--pm-text-2);
    align-items: center;
}
.pm-legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
}
.pm-legend-check {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    background: #dcfce7;
    color: #16a34a;
    display: grid;
    place-items: center;
}
.pm-legend-dash {
    width: 14px;
    height: 14px;
    color: #cbd5e1;
    display: grid;
    place-items: center;
    font-size: 14px;
    line-height: 1;
}
.pm-legend-loading {
    margin-left: auto;
    font-style: italic;
    color: var(--pm-text-3);
}
</style>
