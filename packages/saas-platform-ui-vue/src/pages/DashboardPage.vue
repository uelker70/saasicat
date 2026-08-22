<template>
    <AdminPage class="sa-dashboard">
        <AdminHero :title="msg.title" :subtitle="opts.subtitle">
            <template #actions>
                <AdminRefreshBtn :loading="loading" @refresh="reload" />
            </template>
        </AdminHero>

        <AdminErrorBanner :error="error" />

        <div v-if="loading && !cards.length" class="sa-dashboard__loading">
            <q-spinner size="32px" /> {{ common.loadingData }}
        </div>

        <div v-else-if="!cards.length" class="sa-dashboard__empty">
            {{ msg.emptyKpiCards }}
        </div>

        <AdminSection v-else>
            <AdminStatistics :label="msg.title">
                <AdminKpi
                    v-for="card in cards"
                    :key="card.id"
                    :data-card-id="card.id"
                    :label="card.label"
                    :sub="card.sub"
                    :icon="card.displayHint?.icon"
                    layout="inline"
                >
                    <template #value>
                        <q-spinner v-if="card.loading" size="18px" />
                        <template v-else-if="card.error">—</template>
                        <template v-else>{{ formatValue(card) }}</template>
                    </template>
                </AdminKpi>
            </AdminStatistics>
        </AdminSection>

        <div v-if="opts.distributions && opts.distributions.length > 0" class="sa-dashboard__rows">
            <AdminSection v-for="dist in opts.distributions" :key="dist.id" :title="dist.label">
                <template v-if="dist.total" #actions>
                    <span class="sa-dashboard__count">{{ dist.total }}</span>
                </template>
                <ul class="sa-dashboard__bar-list">
                    <li
                        v-for="entry in dist.entries"
                        :key="entry.label"
                        class="sa-dashboard__bar-row"
                    >
                        <span class="sa-dashboard__bar-name">{{ entry.label }}</span>
                        <span class="sa-dashboard__bar-track">
                            <span
                                class="sa-dashboard__bar-fill"
                                :style="{
                                    width: `${barWidth(entry.value, dist.maxValue)}%`,
                                    background: entry.color ?? dist.barColor ?? defaultBarColor,
                                }"
                            />
                        </span>
                        <span class="sa-dashboard__bar-count">{{ entry.value }}</span>
                    </li>
                </ul>
            </AdminSection>
        </div>

        <AdminSection
            v-if="resolvedShortcuts.length > 0"
            :title="msg.shortcutsTitle"
            class="sa-dashboard__shortcuts"
        >
            <div class="sa-dashboard__shortcut-grid">
                <a
                    v-for="s in resolvedShortcuts"
                    :key="s.id"
                    :href="s.to"
                    class="sa-dashboard__shortcut"
                >
                    <q-icon :name="s.icon ?? 'circle'" size="22px" />
                    <div>
                        <div class="sa-dashboard__shortcut-title">{{ s.label }}</div>
                        <div v-if="s.sub" class="sa-dashboard__shortcut-sub">{{ s.sub }}</div>
                    </div>
                </a>
            </div>
        </AdminSection>

        <slot name="after-kpis" />
    </AdminPage>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref, watch } from 'vue';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import type { AdminManifest, KpiCardDef } from '@saasicat/types';
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { KpiReading, dashboardResource } from '../client/resources/dashboard.resource.js';
import { buildRoutes } from '../client/nav-builder.js';
import { formatMessage } from '../client/i18n/format.js';
import { SUPER_ADMIN_MANIFEST_KEY } from '../vue/super-admin-context.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminKpi from '../ui/data/AdminKpi.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminStatistics from '../ui/data/AdminStatistics.vue';

// Platform standard page: Dashboard.
//
// Reads the KPI cards from the admin manifest (`dashboard.kpiCards`) and asks
// the `dashboard` resource for each card's declared `endpoint`. An app whose
// endpoints answer in a shape the default reader does not recognise overrides
// `kpi` rather than passing a formatter — one override covers every card.
//
// In `options`:
//   - `distributions` : list of bar charts (e.g. subscriptions per plan,
//     promo status). Apps pass the data straight through — the platform
//     renders the bar-chart layout.
//   - `shortcuts`     : list of shortcut cards. Default `'auto'` derives them
//     from `manifest.navigation.standardPages` + `projectPages`. Apps
//     may set an explicit override.
//
// Slots:
//   - `#after-kpis`   : additional free sections below the structures.

export interface DistributionEntry {
    label: string;
    value: number;
    /** Optional override color per entry (otherwise the distribution default). */
    color?: string;
}

export interface DistributionDef {
    id: string;
    label: string;
    entries: readonly DistributionEntry[];
    /** Optional: total sum for the header badge. */
    total?: number | string;
    /** Default color of the bar fills (can be overridden per entry). */
    barColor?: string;
    /** Maximum value for scaling; default = max(entries.value, 1). */
    maxValue?: number;
}

export interface ShortcutDef {
    id: string;
    label: string;
    sub?: string;
    icon?: string;
    to: string;
}

interface KpiCardState {
    id: string;
    label: string;
    sub?: string;
    displayHint: KpiCardDef['displayHint'];
    endpoint: string;
    loading: boolean;
    error: Error | null;
    value: string | number | null;
}

/** Presentation and capability. Never data, never a callback. */
export interface DashboardPageOptions {
    /** Optional subtitle below the H1. */
    subtitle?: string;
    /** Bar-chart sections (subscriptions/promos/...). */
    distributions?: readonly DistributionDef[];
    /**
     * Shortcuts section.
     * - `'auto'` (default): derived from the manifest navigation
     * - `'none'`: no shortcuts section
     * - list: explicit definitions
     */
    shortcuts?: 'auto' | 'none' | readonly ShortcutDef[];
    /** Shortcut sub-texts per StandardPage key (for `shortcuts: 'auto'`). */
    shortcutDescriptions?: Partial<Record<string, string>>;
}

const props = defineProps<{
    /**
     * The manifest, for a mount that is not inside the shell.
     *
     * Inside `createSuperAdminApp` the guard has already loaded it and the page
     * takes it from the injection below, which is why this is optional and why
     * there is no loader prop beside it: a page that had to be told how to
     * fetch the manifest would be a page whose shell had not finished booting.
     */
    manifest?: AdminManifest | null;
    /**
     * Override the dashboard resource for this page only — an app whose KPI
     * endpoints answer in a shape the default reader does not recognise wraps
     * `kpi` here. Layered over the app's own override; see AP3 §3.2.
     */
    resources?: ResourceOverride<(typeof dashboardResource)['ops']>;
    options?: DashboardPageOptions;
}>();

const msg = useSaMessages('dashboard');
const common = useSaMessages('common');
const { locale, intlLocale } = useSuperAdminI18n();

// Provided by createSuperAdminApp({ manifestGuard: { getManifest } }) — lets
// the page work as a plain route component without a wrapper.
const injectedManifest = inject(SUPER_ADMIN_MANIFEST_KEY, null);
// Every KPI request goes through the resource, which goes through the client
// the app registered. There is no path on which a card could reach the network
// without the app's auth — a bare `fetch()` here used to silently drop it.
const dashboard = useResource('dashboard', props.resources);
const opts = computed<DashboardPageOptions>(() => props.options ?? {});

const manifestRef = ref<AdminManifest | null>(props.manifest ?? injectedManifest?.() ?? null);
const cards = reactive<KpiCardState[]>([]);
const loading = ref(false);
const error = ref<Error | null>(null);

// Two stops of the brand accent rather than two fixed blues: a host that sets
// its own `$primary` had a brand-coloured admin with platform-blue KPI bars.
const defaultBarColor =
    'linear-gradient(90deg, var(--sa-color-accent), var(--sa-color-accent-strong))';

watch(
    () => props.manifest,
    (m) => {
        if (m) {
            manifestRef.value = m;
            void buildAndFetch();
        }
    },
);

onMounted(() => {
    // No else: without a manifest there are no cards to fetch, and the shell's
    // guard is what produces one. A page that fetched its own would be racing
    // the boot it is already downstream of.
    if (manifestRef.value) void buildAndFetch();
});

const resolvedShortcuts = computed<ShortcutDef[]>(() => {
    if (opts.value.shortcuts === 'none') return [];
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
    let list: ShortcutDef[];
    if (Array.isArray(opts.value.shortcuts)) {
        list = [...opts.value.shortcuts];
    } else if (!manifestRef.value) {
        list = [];
    } else {
        const routes = buildRoutes(manifestRef.value, { locale: locale.value });
        list = routes.map((r) => ({
            id: r.id,
            label: r.label,
            icon: r.icon,
            to: r.path,
            sub: opts.value.shortcutDescriptions?.[r.id],
        }));
    }
    // Do not show the current page as a shortcut — linking from the dashboard
    // to the dashboard is confusing.
    return list.filter((s) => s.to !== currentPath && s.id !== 'dashboard');
});

async function reload(): Promise<void> {
    error.value = null;
    await buildAndFetch();
}

async function buildAndFetch(): Promise<void> {
    if (!manifestRef.value) return;
    const defs = manifestRef.value.dashboard?.kpiCards ?? [];
    const sorted = [...defs].sort((a, b) => (b.slotPriority ?? 0) - (a.slotPriority ?? 0));
    cards.splice(0, cards.length);
    for (const def of sorted) {
        cards.push({
            id: def.id,
            label: def.label,
            displayHint: def.displayHint,
            endpoint: def.endpoint,
            loading: true,
            error: null,
            value: null,
        });
    }
    loading.value = false;
    await Promise.all(cards.map((c, i) => fetchOne(i)));
}

async function fetchOne(index: number): Promise<void> {
    const card = cards[index];
    if (!card) return;
    card.loading = true;
    card.error = null;
    try {
        const reading = await dashboard.kpi({
            id: card.id,
            label: card.label,
            endpoint: card.endpoint,
            displayHint: card.displayHint,
        });
        card.value = reading.value;
        card.sub = subLineFor(reading, card.displayHint.type);
    } catch (err) {
        card.error = err instanceof Error ? err : new Error(String(err));
    } finally {
        card.loading = false;
    }
}

/**
 * The sub-line under a KPI value, in the operator's locale.
 *
 * The descriptor answers with a reading — an ISO timestamp, a signed number —
 * because which field of a body carries what is knowledge about a data shape.
 * Turning either into text depends on the locale, so it happens here.
 */
function subLineFor(
    reading: KpiReading,
    hintType: KpiCardDef['displayHint']['type'],
): string | undefined {
    if (hintType === 'value+timestamp' && reading.timestamp) {
        return formatTimestamp(reading.timestamp);
    }
    if (hintType === 'value+delta' && reading.delta !== undefined) {
        const sign = reading.delta > 0 ? '+' : '';
        return formatMessage(msg.value.deltaVsPreviousPeriod, {
            delta: `${sign}${reading.delta}`,
        });
    }
    return reading.sub;
}

function formatValue(card: KpiCardState): string {
    const v = card.value;
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') return v.toLocaleString(intlLocale.value);
    if (typeof v === 'string') return v;
    return String(v);
}

function formatTimestamp(iso: string): string {
    try {
        return new Date(iso).toLocaleString(intlLocale.value, {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

function barWidth(value: number, max?: number): number {
    const m = max && max > 0 ? max : 1;
    return Math.round((value / m) * 100);
}
</script>

<style scoped>
/* Header look comes from the global .sa-page-head — only a margin tweak here. */

.sa-kpi__icon :deep(.q-icon) {
    color: var(--sa-color-accent-strong);
}

.sa-dashboard__rows {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 14px;
    align-items: start;
}
@media (max-width: 1439.98px) {
    .sa-dashboard__rows {
        grid-template-columns: 1fr;
    }
}

.sa-dashboard__count {
    background: var(--sa-color-accent-surface);
    color: var(--sa-color-accent-strong);
    font-size: var(--sa-text-xs);
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 5px;
}

.sa-dashboard__bar-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.sa-dashboard__bar-row {
    display: grid;
    grid-template-columns: 130px 1fr 50px;
    align-items: center;
    gap: 8px;
    font-size: var(--sa-text-md);
}
.sa-dashboard__bar-name {
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.sa-dashboard__bar-track {
    background: var(--sa-color-border-soft);
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
}
.sa-dashboard__bar-fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    transition: width 0.18s;
}
.sa-dashboard__bar-count {
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--sa-color-fg-secondary);
}

.sa-dashboard__shortcuts {
    margin: 0;
}
.sa-dashboard__shortcut-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
}
.sa-dashboard__shortcut {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px 14px;
    border: 1px solid var(--sa-color-border);
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
    background: var(--sa-color-bg-surface-raised);
    transition: all 0.12s;
}
.sa-dashboard__shortcut:hover {
    background: var(--sa-color-accent-surface);
    border-color: var(--sa-color-accent-border);
}
.sa-dashboard__shortcut :deep(.q-icon) {
    color: var(--sa-color-accent-strong);
    flex-shrink: 0;
}
.sa-dashboard__shortcut-title {
    font-weight: 700;
    color: var(--sa-color-fg-heading);
    font-family: var(--sa-font-head, system-ui, sans-serif);
}
.sa-dashboard__shortcut-sub {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    margin-top: 2px;
}

.sa-dashboard__loading,
.sa-dashboard__empty {
    padding: 32px 28px;
    color: var(--sa-color-fg-muted);
    display: flex;
    align-items: center;
    gap: 12px;
}
</style>
