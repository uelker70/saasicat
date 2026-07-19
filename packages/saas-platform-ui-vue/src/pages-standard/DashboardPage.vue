<template>
    <div class="sa-dashboard">
        <header class="sa-page-head sa-dashboard__head">
            <div>
                <h1 class="sa-page-head__title">Dashboard</h1>
                <p v-if="subtitle" class="sa-page-head__sub">{{ subtitle }}</p>
            </div>
            <div class="sa-page-head__actions">
                <q-btn
                    flat
                    dense
                    icon="refresh"
                    :loading="loading"
                    aria-label="Neu laden"
                    @click="reload"
                />
            </div>
        </header>

        <q-banner v-if="error" class="bg-red-1 text-red-9 q-mb-md" rounded>
            <strong>Fehler:</strong> {{ error.message }}
        </q-banner>

        <div v-if="loading && !cards.length" class="sa-dashboard__loading">
            <q-spinner size="32px" /> Daten werden geladen…
        </div>

        <div v-else-if="!cards.length" class="sa-dashboard__empty">
            Keine KPI-Cards im Manifest deklariert.
        </div>

        <div v-else class="sa-dashboard__strip">
            <article v-for="card in cards" :key="card.id" class="sa-kpi" :data-card-id="card.id">
                <div class="sa-kpi__icon" v-if="card.displayHint?.icon">
                    <q-icon :name="card.displayHint.icon" size="20px" />
                </div>
                <div class="sa-kpi__body">
                    <div class="sa-kpi__label">{{ card.label }}</div>
                    <div class="sa-kpi__value">
                        <q-spinner v-if="card.loading" size="18px" />
                        <span v-else-if="card.error" class="sa-kpi__error">—</span>
                        <span v-else>{{ formatValue(card) }}</span>
                    </div>
                    <div v-if="card.sub" class="sa-kpi__sub">{{ card.sub }}</div>
                </div>
            </article>
        </div>

        <div v-if="distributions && distributions.length > 0" class="sa-dashboard__rows">
            <section
                v-for="dist in distributions"
                :key="dist.id"
                class="sa-dashboard__card sa-dashboard__row-card"
            >
                <header class="sa-dashboard__row-head">
                    <h2>{{ dist.label }}</h2>
                    <span v-if="dist.total" class="sa-dashboard__count">{{ dist.total }}</span>
                </header>
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
            </section>
        </div>

        <section
            v-if="resolvedShortcuts.length > 0"
            class="sa-dashboard__card sa-dashboard__shortcuts"
        >
            <header class="sa-dashboard__row-head">
                <h2>Shortcuts</h2>
            </header>
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
        </section>

        <slot name="after-kpis" />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import type { AdminManifest, KpiCardDef } from '@saasicat/types';
import type { HttpClient } from '../types.js';
import { buildRoutes } from '../nav-builder.js';

// Plattform-Standard-Page: Dashboard.
//
// Liest die KPI-Cards aus dem Admin-Manifest (`dashboard.kpiCards`) und holt
// für jede Card den deklarierten `endpoint`. App-spezifische Response-Shapes
// werden vom optionalen `formatKpi`-Prop in `{ value, sub }` projiziert.
//
// Zusätzlich:
//   - `distributions` : Liste von Bar-Charts (z. B. Subscriptions je Plan,
//     Promo-Status). Apps reichen die Daten direkt durch — die Plattform
//     rendert das Bar-Chart-Layout.
//   - `shortcuts`     : Liste von Shortcut-Cards. Default `'auto'` leitet sie
//     aus `manifest.navigation.standardPages` + `projectPages` ab. Apps
//     dürfen einen expliziten Override setzen.
//
// Slots:
//   - `#after-kpis`   : zusätzliche freie Sektionen unter den Strukturen.

export interface KpiFormatted {
    value: string | number;
    sub?: string;
}

export interface DistributionEntry {
    label: string;
    value: number;
    /** Optionale Override-Farbe pro Eintrag (sonst Distribution-Default). */
    color?: string;
}

export interface DistributionDef {
    id: string;
    label: string;
    entries: readonly DistributionEntry[];
    /** Optional: Gesamtsumme für Header-Badge. */
    total?: number | string;
    /** Default-Farbe der Bar-Fills (kann pro Eintrag überschrieben werden). */
    barColor?: string;
    /** Maximalwert für die Skalierung; default = max(entries.value, 1). */
    maxValue?: number;
}

export interface ShortcutDef {
    id: string;
    label: string;
    sub?: string;
    icon?: string;
    to: string;
}

interface Props {
    /** Vorgeladenes Manifest. Wenn null/undefined, wird per `loadManifest` geladen. */
    manifest?: AdminManifest | null;
    /** Custom-Loader für das Manifest (Fallback wenn `manifest` nicht gesetzt). */
    loadManifest?: () => Promise<AdminManifest>;
    /** Custom-HttpClient. Default: globaler `fetch`. */
    http?: HttpClient;
    /** Token-Provider (wenn der HttpClient-Default-fetch verwendet wird). */
    getAuthToken?: () => string | null;
    /** Optionaler Subtitle unter der H1. */
    subtitle?: string;
    /**
     * App-spezifischer Formatter für KPI-Antworten. Default extrahiert
     * `value`/`count`/`total` und nutzt `displayHint.type` für `sub`.
     */
    formatKpi?: (card: KpiCardDef, body: unknown) => KpiFormatted;
    /** Bar-Chart-Sektionen (Subscriptions/Promos/...). */
    distributions?: readonly DistributionDef[];
    /**
     * Shortcuts-Sektion.
     * - `'auto'` (Default): Aus Manifest-Navigation abgeleitet
     * - `'none'`: keine Shortcut-Sektion
     * - Liste: explizite Definitionen
     */
    shortcuts?: 'auto' | 'none' | readonly ShortcutDef[];
    /** Shortcut-Sub-Texts pro StandardPage-Key (für `shortcuts: 'auto'`). */
    shortcutDescriptions?: Partial<Record<string, string>>;
}

const props = withDefaults(defineProps<Props>(), {
    shortcuts: 'auto',
});

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

const manifestRef = ref<AdminManifest | null>(props.manifest ?? null);
const cards = reactive<KpiCardState[]>([]);
const loading = ref(false);
const error = ref<Error | null>(null);

const defaultBarColor = 'linear-gradient(90deg, #3f6bff, #1d4ed8)';

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
    if (manifestRef.value) {
        void buildAndFetch();
    } else if (props.loadManifest) {
        void reload();
    }
});

const resolvedShortcuts = computed<ShortcutDef[]>(() => {
    if (props.shortcuts === 'none') return [];
    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
    let list: ShortcutDef[];
    if (Array.isArray(props.shortcuts)) {
        list = [...props.shortcuts];
    } else if (!manifestRef.value) {
        list = [];
    } else {
        const routes = buildRoutes(manifestRef.value);
        list = routes.map((r) => ({
            id: r.id,
            label: r.label,
            icon: r.icon,
            to: r.path,
            sub: props.shortcutDescriptions?.[r.id],
        }));
    }
    // Aktuelle Seite nicht als Shortcut zeigen — vom Dashboard zum Dashboard
    // zu verlinken ist verwirrend.
    return list.filter((s) => s.to !== currentPath && s.id !== 'dashboard');
});

async function reload(): Promise<void> {
    error.value = null;
    if (!manifestRef.value && props.loadManifest) {
        loading.value = true;
        try {
            manifestRef.value = await props.loadManifest();
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
            loading.value = false;
            return;
        }
    }
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
        const resp = await callHttp(card.endpoint);
        if (resp.status >= 400) {
            throw new Error(`HTTP ${resp.status}`);
        }
        const body = await resp.json();
        const formatter = props.formatKpi ?? defaultFormat;
        const def: KpiCardDef = {
            id: card.id,
            label: card.label,
            endpoint: card.endpoint,
            displayHint: card.displayHint,
        };
        const out = formatter(def, body);
        card.value = out.value;
        card.sub = out.sub;
    } catch (err) {
        card.error = err instanceof Error ? err : new Error(String(err));
    } finally {
        card.loading = false;
    }
}

function defaultFormat(card: KpiCardDef, body: unknown): KpiFormatted {
    const obj = (body ?? {}) as Record<string, unknown>;
    const value = extractValue(obj);
    return {
        value: value ?? '—',
        sub: extractSub(obj, card.displayHint.type),
    };
}

async function callHttp(url: string): Promise<{ status: number; json: () => Promise<unknown> }> {
    if (props.http) {
        return props.http(url, { method: 'GET' });
    }
    const headers: Record<string, string> = {};
    const token = props.getAuthToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(url, { method: 'GET', headers });
    return {
        status: resp.status,
        json: () => resp.json(),
    };
}

function extractValue(body: Record<string, unknown>): string | number | null {
    if (typeof body.value === 'number' || typeof body.value === 'string') return body.value;
    if (typeof body.count === 'number') return body.count;
    if (typeof body.total === 'number') return body.total;
    return null;
}

function extractSub(
    body: Record<string, unknown>,
    hintType: KpiCardDef['displayHint']['type'],
): string | undefined {
    if (hintType === 'value+timestamp' && typeof body.timestamp === 'string') {
        return formatTimestamp(body.timestamp);
    }
    if (hintType === 'value+delta' && typeof body.delta === 'number') {
        const sign = body.delta > 0 ? '+' : '';
        return `${sign}${body.delta} ggü. Vorperiode`;
    }
    if (typeof body.sub === 'string') return body.sub;
    return undefined;
}

function formatValue(card: KpiCardState): string {
    const v = card.value;
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') return v.toLocaleString('de-DE');
    if (typeof v === 'string') return v;
    return String(v);
}

function formatTimestamp(iso: string): string {
    try {
        return new Date(iso).toLocaleString('de-DE', {
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
.sa-dashboard {
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app, #f1f5f9);
    padding: 20px 28px 28px;
}
/* Header-Optik kommt aus der globalen .sa-page-head — hier nur Margin-Tweak. */
.sa-dashboard__head {
    margin-bottom: 4px;
}

.sa-dashboard__strip {
    display: grid;
    /* Responsiv: 4 Karten solange Platz, dann automatisch 3 → 2 → 1. */
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 14px;
}

.sa-kpi {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    transition:
        border-color 0.12s,
        box-shadow 0.12s;
}
.sa-kpi:hover {
    border-color: #94a3b8;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
}
.sa-kpi__icon {
    width: 36px;
    height: 36px;
    border-radius: 9px;
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    display: flex;
    align-items: center;
    justify-content: center;
}
.sa-kpi__icon :deep(.q-icon) {
    color: var(--sa-primary, #3f6bff);
}
.sa-kpi__body {
    flex: 1;
    min-width: 0;
}
.sa-kpi__label {
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
}
.sa-kpi__value {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 28px;
    color: var(--sa-heading, #0f172a);
    line-height: 1;
    letter-spacing: -0.02em;
    margin-top: 4px;
    min-height: 30px;
    display: flex;
    align-items: center;
}
.sa-kpi__sub {
    font-size: 11.5px;
    color: #94a3b8;
    margin-top: 4px;
}
.sa-kpi__error {
    color: var(--sa-negative, #dc2626);
}

.sa-dashboard__rows {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 14px;
    align-items: start;
}
@media (max-width: 1280px) {
    .sa-dashboard__rows {
        grid-template-columns: 1fr;
    }
}

.sa-dashboard__card {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    padding: 16px 18px;
}
.sa-dashboard__row-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
}
.sa-dashboard__row-head h2 {
    margin: 0;
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-size: 14px;
    font-weight: 700;
    color: var(--sa-heading, #0f172a);
}
.sa-dashboard__count {
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    color: var(--sa-primary, #3f6bff);
    font-size: 11px;
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
    font-size: 13px;
}
.sa-dashboard__bar-name {
    font-weight: 600;
    color: var(--sa-heading, #0f172a);
}
.sa-dashboard__bar-track {
    background: #f1f5f9;
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
    color: var(--sa-muted-dark, #475569);
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
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 10px;
    text-decoration: none;
    color: inherit;
    background: #fafbfc;
    transition: all 0.12s;
}
.sa-dashboard__shortcut:hover {
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    border-color: var(--sa-primary-border, rgba(63, 107, 255, 0.18));
}
.sa-dashboard__shortcut :deep(.q-icon) {
    color: var(--sa-primary, #3f6bff);
    flex-shrink: 0;
}
.sa-dashboard__shortcut-title {
    font-weight: 700;
    color: var(--sa-heading, #0f172a);
    font-family: var(--sa-font-head, system-ui, sans-serif);
}
.sa-dashboard__shortcut-sub {
    font-size: 12px;
    color: var(--sa-muted, #64748b);
    margin-top: 2px;
}

.sa-dashboard__loading,
.sa-dashboard__empty {
    padding: 32px 28px;
    color: var(--sa-muted, #64748b);
    display: flex;
    align-items: center;
    gap: 12px;
}
</style>
