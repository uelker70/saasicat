<template>
    <div class="sa-discovery">
        <DiscoveryHeader :loading="loading" @run-discovery="onRunDiscovery" />

        <DiscoveryMetaBanner
            :app-label="appLabel"
            :app-key="appKey"
            :app-version="appVersion"
            :scan-label="scanLabel"
        />

        <q-banner v-if="error" class="sa-discovery__error" rounded>
            <template #avatar><q-icon name="warning" color="negative" /></template>
            {{ common.error }}: {{ error.message }}
        </q-banner>

        <DiscoveryKpis
            :features-count="features.length"
            :capabilities-count="capabilities.length"
            :approved-count="approvedCount"
            :pending-count="pendingCount"
            :outdated-count="outdatedCount"
            :obsolete-count="obsoleteCount"
            :orphan-count="orphanCaps.length"
        />

        <q-tabs v-model="activeTab" align="left" dense class="sa-discovery__tabs">
            <q-tab name="features" :label="featuresTabLabel" />
            <q-tab name="quotas" :label="quotasTabLabel" />
        </q-tabs>

        <q-tab-panels v-model="activeTab" animated class="sa-discovery__panels">
            <q-tab-panel name="features" class="sa-discovery__panel">
                <div class="sa-discovery__toolbar">
                    <q-input
                        v-model="featureQuery"
                        dense
                        outlined
                        clearable
                        :placeholder="msg.searchPlaceholder"
                        class="sa-discovery__search"
                    >
                        <template #prepend><q-icon name="search" /></template>
                    </q-input>
                    <q-select
                        v-model="statusFilter"
                        dense
                        outlined
                        emit-value
                        map-options
                        :options="statusFilterOptions"
                        class="sa-discovery__filter"
                    />
                </div>

                <div v-for="group in featureGroups" :key="group.label" class="sa-discovery__group">
                    <div class="sa-discovery__group-head">
                        <span class="sa-discovery__group-title">{{ group.label }}</span>
                        <span class="sa-discovery__group-count">{{ group.features.length }}</span>
                    </div>
                    <div class="sa-discovery__cardlist">
                        <DiscoveryFeatureCard
                            v-for="f in group.features"
                            :key="f.featureKey"
                            :feature="f"
                            :capabilities="capsByFeature.get(f.featureKey) ?? []"
                            :owners="ownersByFeature.get(f.featureKey) ?? []"
                            :declared-at-by-key="declaredAtByKey"
                            :active-locales="activeLocales"
                            :expanded="expandedFeature === f.featureKey"
                            @toggle="toggleFeature(f.featureKey)"
                            @review="onFeatureReview"
                            @feature-base="onFeatureBase"
                            @feature-locale="onFeatureLocale"
                        />
                    </div>
                </div>
                <div v-if="filteredFeatures.length === 0" class="sa-discovery__empty-row">
                    {{ msg.noFeaturesMatchFilters }}
                </div>

                <div v-if="orphanCaps.length" class="sa-discovery__group">
                    <div class="sa-discovery__group-head">
                        <span class="sa-discovery__group-title sa-discovery__group-title--orphan">
                            <q-icon name="warning" size="14px" />
                            {{ msg.orphansTitle }}
                        </span>
                        <span class="sa-discovery__group-count">{{ orphanCaps.length }}</span>
                    </div>
                    <p class="sa-discovery__orphan-hint">
                        {{ msg.orphanHint.before }} <code>feature:</code>{{ msg.orphanHint.middle }}
                        <code>@ImplementsCapability</code>{{ msg.orphanHint.after }}
                    </p>
                    <DiscoveryCapList
                        :capabilities="orphanCaps"
                        :declared-at-by-key="declaredAtByKey"
                    />
                </div>
            </q-tab-panel>

            <q-tab-panel name="quotas" class="sa-discovery__panel">
                <div class="sa-discovery__cardlist">
                    <DiscoveryQuotaCard
                        v-for="q in quotas"
                        :key="q.quotaKey"
                        :quota="q"
                        :active-locales="activeLocales"
                        :expanded="expandedQuota === q.quotaKey"
                        @toggle="toggleQuota(q.quotaKey)"
                        @review="onQuotaReview"
                        @quota-base="onQuotaBase"
                        @quota-locale="onQuotaLocale"
                    />
                    <div v-if="quotas.length === 0" class="sa-discovery__empty-row">
                        {{ msg.noQuotasDeclared }}
                    </div>
                </div>
            </q-tab-panel>
        </q-tab-panels>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type {
    CapabilityCatalogEntryRow,
    CatalogEntryI18n,
    CatalogEntryI18nFields,
    DiscoverySnapshot,
    DiscoveryStatus,
    FeatureCatalogEntryRow,
    QuotaCatalogEntryRow,
    ReviewCatalogEntryData,
    UpdateCatalogEntryBaseData,
} from '@saasicat/types';
import DiscoveryCapList from './discovery-page/DiscoveryCapList.vue';
import DiscoveryFeatureCard from './discovery-page/DiscoveryFeatureCard.vue';
import DiscoveryHeader from './discovery-page/DiscoveryHeader.vue';
import DiscoveryKpis from './discovery-page/DiscoveryKpis.vue';
import DiscoveryMetaBanner from './discovery-page/DiscoveryMetaBanner.vue';
import DiscoveryQuotaCard from './discovery-page/DiscoveryQuotaCard.vue';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import { statusLabel } from './discovery-page/discovery-ui.js';

// Platform standard page: Discovery review, feature-centric (#20).
// Two tabs (Features + Quotas); each entry is an expandable card with
// StatusControl (approval state machine pending → approved ↔ outdated · obsolete),
// base data, translations and read-only code capabilities. Features are
// grouped by owner (rollup from the capability decorators, #14).
// Dumb component — the consumer wrapper wires up `useDiscovery` (snapshot)
// + `useCatalogEntries` (review status, translations) and passes the
// results through as props.

const props = defineProps<{
    /** Discovery snapshot — enrichment only (declaredAt, scan meta). */
    snapshot: DiscoverySnapshot | null;
    capabilities: CapabilityCatalogEntryRow[];
    features: FeatureCatalogEntryRow[];
    quotas: QuotaCatalogEntryRow[];
    loading: boolean;
    error: Error | null;
    /** Active locales from the project (incl. default locale). */
    activeLocales: string[];
    /** Reload snapshot → sync → reload catalog entries. */
    runDiscovery: () => Promise<void>;
    /** Approval transition of a feature (PATCH …/features/:key/review). */
    reviewFeature: (featureKey: string, data: ReviewCatalogEntryData) => Promise<unknown>;
    /** Approval transition of a quota (PATCH …/quotas/:key/review). */
    reviewQuota: (quotaKey: string, data: ReviewCatalogEntryData) => Promise<unknown>;
    setFeatureI18n: (featureKey: string, i18n: CatalogEntryI18n) => Promise<unknown>;
    setQuotaI18n: (quotaKey: string, i18n: CatalogEntryI18n) => Promise<unknown>;
    setFeatureBase: (featureKey: string, data: UpdateCatalogEntryBaseData) => Promise<unknown>;
    setQuotaBase: (quotaKey: string, data: UpdateCatalogEntryBaseData) => Promise<unknown>;
}>();

const activeTab = ref<'features' | 'quotas'>('features');

const featuresTabLabel = computed(() =>
    formatMessage(msg.value.tabFeatures, { count: props.features.length }),
);
const quotasTabLabel = computed(() =>
    formatMessage(msg.value.tabQuotas, { count: props.quotas.length }),
);
const featureQuery = ref('');
const statusFilter = ref<DiscoveryStatus | 'all'>('all');
const expandedFeature = ref<string | null>(null);
const expandedQuota = ref<string | null>(null);

const msg = useSaMessages('discovery');
const common = useSaMessages('common');
const { locale, intlLocale } = useSuperAdminI18n();

const statusFilterOptions = computed<Array<{ label: string; value: DiscoveryStatus | 'all' }>>(
    () => [
        { label: msg.value.statusFilterAll, value: 'all' },
        ...(['pending', 'approved', 'outdated', 'obsolete'] as const).map((status) => ({
            label: statusLabel(status, locale.value),
            value: status,
        })),
    ],
);

const appKey = computed(() => props.snapshot?.app.key ?? '—');
const appLabel = computed(() => {
    const k = props.snapshot?.app.key ?? '';
    return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Discovery';
});
const appVersion = computed(() => props.snapshot?.app.version ?? '0.0.0');
const scanLabel = computed(() => {
    if (!props.snapshot?.scannedAt) return msg.value.notScannedYet;
    try {
        return new Date(props.snapshot.scannedAt).toLocaleString(intlLocale.value);
    } catch {
        return props.snapshot.scannedAt;
    }
});

const declaredAtByKey = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const c of props.snapshot?.capabilities ?? []) {
        map[c.capabilityKey] = c.declaredAt;
    }
    return map;
});

// ─── Feature-centric aggregation ────────────────────────────────────────────

const capsByFeature = computed<Map<string, CapabilityCatalogEntryRow[]>>(() => {
    const map = new Map<string, CapabilityCatalogEntryRow[]>();
    for (const c of props.capabilities) {
        if (!c.featureKey) continue;
        const list = map.get(c.featureKey);
        if (list) list.push(c);
        else map.set(c.featureKey, [c]);
    }
    return map;
});

/** Owner rollup per feature (#14): owners of the capabilities, most frequent first. */
const ownersByFeature = computed<Map<string, string[]>>(() => {
    const map = new Map<string, string[]>();
    for (const [featureKey, caps] of capsByFeature.value) {
        const counts = new Map<string, number>();
        for (const c of caps) {
            if (c.owner) counts.set(c.owner, (counts.get(c.owner) ?? 0) + 1);
        }
        map.set(
            featureKey,
            [...counts.entries()]
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([owner]) => owner),
        );
    }
    return map;
});

const orphanCaps = computed(() =>
    props.capabilities.filter((c) => !c.featureKey && c.codeStatus !== 'retired'),
);

const approvedCount = computed(
    () => props.features.filter((f) => f.discoveryStatus === 'approved').length,
);
const pendingCount = computed(
    () => props.features.filter((f) => f.discoveryStatus === 'pending').length,
);
const outdatedCount = computed(
    () => props.features.filter((f) => f.discoveryStatus === 'outdated').length,
);
const obsoleteCount = computed(
    () => props.features.filter((f) => f.discoveryStatus === 'obsolete').length,
);

const filteredFeatures = computed(() => {
    const q = featureQuery.value.trim().toLowerCase();
    return props.features.filter((f) => {
        if (statusFilter.value !== 'all' && f.discoveryStatus !== statusFilter.value) {
            return false;
        }
        if (!q) return true;
        if (f.featureKey.toLowerCase().includes(q) || (f.label ?? '').toLowerCase().includes(q)) {
            return true;
        }
        const caps = capsByFeature.value.get(f.featureKey) ?? [];
        return caps.some(
            (c) =>
                c.capabilityKey.toLowerCase().includes(q) ||
                (c.label ?? '').toLowerCase().includes(q),
        );
    });
});

/** Grouping by primary owner (#14); the ownerless group goes last. */
const featureGroups = computed<Array<{ label: string; features: FeatureCatalogEntryRow[] }>>(() => {
    const groups = new Map<string, FeatureCatalogEntryRow[]>();
    for (const f of filteredFeatures.value) {
        const owner = ownersByFeature.value.get(f.featureKey)?.[0] ?? msg.value.noOwner;
        const list = groups.get(owner);
        if (list) list.push(f);
        else groups.set(owner, [f]);
    }
    return [...groups.entries()]
        .sort((a, b) => {
            if (a[0] === msg.value.noOwner) return 1;
            if (b[0] === msg.value.noOwner) return -1;
            return a[0].localeCompare(b[0]);
        })
        .map(([label, features]) => ({ label, features }));
});

function toggleFeature(key: string): void {
    expandedFeature.value = expandedFeature.value === key ? null : key;
}
function toggleQuota(key: string): void {
    expandedQuota.value = expandedQuota.value === key ? null : key;
}

async function onRunDiscovery(): Promise<void> {
    await props.runDiscovery();
}

function onFeatureReview(key: string, target: DiscoveryStatus): void {
    persist(props.reviewFeature(key, { discoveryStatus: target }));
}
function onQuotaReview(key: string, target: DiscoveryStatus): void {
    persist(props.reviewQuota(key, { discoveryStatus: target }));
}

// Persistence is debounced — the editor fires on every keystroke. Patches
// are accumulated per target (base or locale) so that label + description
// end up in a single request and nothing gets lost.
const I18N_DEBOUNCE_MS = 500;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
function debounced(id: string, fn: () => void): void {
    const prev = debounceTimers.get(id);
    if (prev) clearTimeout(prev);
    debounceTimers.set(
        id,
        setTimeout(() => {
            debounceTimers.delete(id);
            fn();
        }, I18N_DEBOUNCE_MS),
    );
}

const pendingBase = new Map<string, UpdateCatalogEntryBaseData>();
const pendingLocale = new Map<string, CatalogEntryI18nFields>();

/** Settle the persistence promise so no error stays unhandled. */
function persist(p: Promise<unknown>): void {
    p.catch((err) => {
        // Auth renewal/redirect is handled by the HTTP client; here just log
        // so a failed save stays visible.
        console.error('Failed to save catalog entry', err);
    });
}

/** Treats an empty field as deleted so the fallback to DE takes effect. */
function withField(target: Record<string, string>, field: string, value: string): void {
    if (value) target[field] = value;
    else delete target[field];
}

function onBaseUpdate(
    kind: 'feature' | 'quota',
    key: string,
    patch: UpdateCatalogEntryBaseData,
): void {
    const id = `${kind}-base:${key}`;
    const acc = pendingBase.get(id) ?? {};
    Object.assign(acc, patch);
    pendingBase.set(id, acc);
    debounced(id, () => {
        const data = pendingBase.get(id);
        pendingBase.delete(id);
        if (!data) return;
        persist(
            kind === 'feature' ? props.setFeatureBase(key, data) : props.setQuotaBase(key, data),
        );
    });
}

function onLocaleUpdate(
    kind: 'feature' | 'quota',
    key: string,
    locale: string,
    patch: CatalogEntryI18nFields,
): void {
    const id = `${kind}-i18n:${key}|${locale}`;
    const acc = pendingLocale.get(id) ?? {};
    Object.assign(acc, patch);
    pendingLocale.set(id, acc);
    debounced(id, () => {
        const data = pendingLocale.get(id);
        pendingLocale.delete(id);
        if (!data) return;
        const rows: Array<{ i18n?: CatalogEntryI18n }> =
            kind === 'feature' ? props.features : props.quotas;
        const idKey = kind === 'feature' ? 'featureKey' : 'quotaKey';
        const row = (rows as Array<Record<string, unknown>>).find((r) => r[idKey] === key);
        const next: CatalogEntryI18n = { ...((row?.i18n as CatalogEntryI18n) ?? {}) };
        const localeFields = { ...(next[locale] ?? {}) } as Record<string, string>;
        for (const [field, value] of Object.entries(data)) {
            withField(localeFields, field, String(value ?? ''));
        }
        next[locale] = localeFields;
        persist(
            kind === 'feature' ? props.setFeatureI18n(key, next) : props.setQuotaI18n(key, next),
        );
    });
}

function onFeatureBase(key: string, patch: UpdateCatalogEntryBaseData): void {
    onBaseUpdate('feature', key, patch);
}
function onQuotaBase(key: string, patch: UpdateCatalogEntryBaseData): void {
    onBaseUpdate('quota', key, patch);
}
function onFeatureLocale(key: string, locale: string, patch: CatalogEntryI18nFields): void {
    onLocaleUpdate('feature', key, locale, patch);
}
function onQuotaLocale(key: string, locale: string, patch: CatalogEntryI18nFields): void {
    onLocaleUpdate('quota', key, locale, patch);
}

onMounted(() => {
    if (props.capabilities.length === 0 && !props.loading) {
        void props.runDiscovery();
    }
});
</script>

<style>
.sa-discovery {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.sa-discovery__head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
}
.sa-discovery__title {
    font-size: 20px;
    font-weight: 700;
    margin: 0;
}
.sa-discovery__sub {
    margin: 4px 0 0;
    color: #64748b;
    font-size: 12px;
    max-width: 640px;
}
.sa-discovery__banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #0f172a;
    color: #e2e8f0;
    border-radius: 12px;
    padding: 14px 18px;
}
.sa-discovery__banner-app {
    display: flex;
    align-items: center;
    gap: 12px;
}
.sa-discovery__banner-name {
    font-weight: 700;
    font-size: 14px;
}
.sa-discovery__banner-meta {
    font-size: 11px;
    color: #94a3b8;
}
.sa-discovery__banner-time {
    text-align: right;
}
.sa-discovery__banner-time-lbl {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #94a3b8;
}
.sa-discovery__banner-time-val {
    font-size: 13px;
    font-weight: 600;
}
.sa-discovery__error {
    border-left: 4px solid #dc2626;
}
.sa-discovery__kpis {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 10px;
}
.sa-discovery__kpi {
    background: #fff;
    border: 1px solid #e2e8f0;
    padding: 12px 14px;
    border-radius: 10px;
}
.sa-discovery__kpi.good {
    border-color: #a7f3d0;
}
.sa-discovery__kpi.good .sa-discovery__kpi-label,
.sa-discovery__kpi.good .sa-discovery__kpi-value {
    color: #047857;
}
.sa-discovery__kpi.warn {
    border-color: #fde68a;
    background: #fffbeb;
}
.sa-discovery__kpi.bad {
    border-color: #fecaca;
    background: #fef2f2;
}
.sa-discovery__kpi-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
}
.sa-discovery__kpi-value {
    font-size: 26px;
    font-weight: 700;
}
.sa-discovery__kpi-sub {
    font-size: 11px;
    color: #94a3b8;
}
.sa-discovery__tabs {
    border-bottom: 1px solid #e2e8f0;
}
.sa-discovery__panel {
    padding: 14px 0;
}
.sa-discovery__toolbar {
    display: flex;
    gap: 12px;
    margin-bottom: 14px;
    align-items: center;
}
.sa-discovery__search {
    flex: 1;
}
.sa-discovery__filter {
    min-width: 180px;
}
.sa-discovery__cardlist {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.sa-discovery__group {
    margin-bottom: 16px;
}
.sa-discovery__group-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}
.sa-discovery__group-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #475569;
    display: flex;
    align-items: center;
    gap: 5px;
}
.sa-discovery__group-title--orphan {
    color: #b45309;
}
.sa-discovery__group-count {
    font-size: 10px;
    font-weight: 700;
    background: #e2e8f0;
    color: #475569;
    padding: 1px 7px;
    border-radius: 8px;
}
.sa-discovery__orphan-hint {
    margin: 0 0 8px;
    font-size: 11px;
    color: #b45309;
}
.sa-discovery__orphan-hint code {
    font-size: 10px;
    background: #fffbeb;
    padding: 1px 4px;
    border-radius: 4px;
}
.sa-discovery__empty-row {
    padding: 36px;
    text-align: center;
    color: #94a3b8;
    font-size: 13px;
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
}
.sa-muted {
    color: #94a3b8;
    margin-right: 3px;
}
/* Status badge (review lifecycle) — shared by feature and quota card. */
.sa-review {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 6px;
    background: #f1f5f9;
    color: #475569;
    flex-shrink: 0;
}
.sa-review--pending {
    background: #fef3c7;
    color: #92400e;
}
.sa-review--approved {
    background: #dcfce7;
    color: #166534;
}
.sa-review--outdated {
    background: #fee2e2;
    color: #b91c1c;
}
.sa-review--obsolete {
    background: #e2e8f0;
    color: #64748b;
}
.sa-chip {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 6px;
    background: #f1f5f9;
    color: #475569;
}
/* i18n coverage pill — shared by feature and quota card. */
.sa-cov-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    color: #475569;
}
.sa-cov-pill.complete {
    border-color: #a7f3d0;
    background: #ecfdf5;
    color: #047857;
}
.sa-cov-pill.warn {
    border-color: #fde68a;
    background: #fffbeb;
    color: #b45309;
}
.sa-cov-pill.low {
    border-color: #fecaca;
    background: #fef2f2;
    color: #b91c1c;
}
</style>
