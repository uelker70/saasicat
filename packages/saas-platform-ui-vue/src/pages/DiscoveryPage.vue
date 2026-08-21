<template>
    <AdminPage class="sa-discovery">
        <AdminHero :title="msg.title">
            <template #subtitle>
                {{ msg.subtitleLead }} <b>{{ msg.subtitleEmphasis }}</b> {{ msg.subtitleTail }}
            </template>
            <template #actions>
                <AdminRefreshBtn :loading="loading" @refresh="onRunDiscovery" />
            </template>
        </AdminHero>

        <AdminBody>
            <DiscoveryMetaBanner
                :app-label="appLabel"
                :app-key="appKey"
                :app-version="appVersion"
                :scan-label="scanLabel"
            />
            <q-banner v-if="error" class="sa-discovery__error" rounded>
                <template #avatar><q-icon name="warning" color="negative" /></template>
                {{ common.error }}: {{ errorText }}
            </q-banner>

            <AdminSection class="q-mt-lg">
                <DiscoveryKpis
                    :features-count="features.length"
                    :capabilities-count="capabilities.length"
                    :approved-count="approvedCount"
                    :pending-count="pendingCount"
                    :outdated-count="outdatedCount"
                    :obsolete-count="obsoleteCount"
                    :orphan-count="orphanCaps.length"
                />
            </AdminSection>

            <AdminSection class="sa-discovery__panels">
                <q-tabs v-model="activeTab" align="left" dense class="sa-discovery__tabs">
                    <q-tab name="features" :label="featuresTabLabel" />
                    <q-tab name="quotas" :label="quotasTabLabel" />
                </q-tabs>
                <q-tab-panels v-model="activeTab" animated>
                    <q-tab-panel name="features" class="sa-discovery__panel">
                        <AdminFilters class="q-mb-md">
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
                        </AdminFilters>

                        <AdminSection
                            v-for="group in featureGroups"
                            :key="group.label"
                            :title="group.label"
                            class="sa-discovery__group"
                        >
                            <template #actions>
                                <span class="sa-discovery__group-count">{{
                                    group.features.length
                                }}</span>
                            </template>
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
                        </AdminSection>

                        <div v-if="filteredFeatures.length === 0" class="sa-discovery__empty-row">
                            {{ msg.noFeaturesMatchFilters }}
                        </div>

                        <AdminSection
                            v-if="orphanCaps.length"
                            :title="msg.orphansTitle"
                            class="sa-discovery__group sa-discovery__group--orphan"
                        >
                            <template #actions>
                                <span class="sa-discovery__group-count">{{
                                    orphanCaps.length
                                }}</span>
                            </template>
                            <p class="sa-discovery__orphan-hint">
                                {{ msg.orphanHint.before }} <code>feature:</code
                                >{{ msg.orphanHint.middle }} <code>@ImplementsCapability</code
                                >{{ msg.orphanHint.after }}
                            </p>
                            <DiscoveryCapList
                                :capabilities="orphanCaps"
                                :declared-at-by-key="declaredAtByKey"
                            />
                        </AdminSection>
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
            </AdminSection>
        </AdminBody>
    </AdminPage>
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
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import DiscoveryCapList from '../internal/discovery-page/DiscoveryCapList.vue';
import DiscoveryFeatureCard from '../internal/discovery-page/DiscoveryFeatureCard.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminFilters from '../ui/page/AdminFilters.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import DiscoveryKpis from '../internal/discovery-page/DiscoveryKpis.vue';
import DiscoveryMetaBanner from '../internal/discovery-page/DiscoveryMetaBanner.vue';
import DiscoveryQuotaCard from '../internal/discovery-page/DiscoveryQuotaCard.vue';
import { adminErrorMessage } from '../client/admin-error.js';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import { statusLabel } from '../internal/discovery-page/discovery-ui.js';

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
// `clearable` emits null, not '' — see Quasar's use-field clearValue().
const featureQuery = ref<string | null>('');
const statusFilter = ref<DiscoveryStatus | 'all'>('all');
const expandedFeature = ref<string | null>(null);
const expandedQuota = ref<string | null>(null);

const msg = useSaMessages('discovery');
const common = useSaMessages('common');
const errors = useSaMessages('errors');
const { intlLocale } = useSuperAdminI18n();

// The banner shows what the failing side said, or the catalog's sentence for
// what happened — never the error's own `message`, which is an English
// diagnostic for the log and was reaching this screen verbatim.
const errorText = computed(() => (props.error ? adminErrorMessage(props.error, errors.value) : ''));

const statusFilterOptions = computed<Array<{ label: string; value: DiscoveryStatus | 'all' }>>(
    () => [
        { label: msg.value.statusFilterAll, value: 'all' },
        ...(['pending', 'approved', 'outdated', 'obsolete'] as const).map((status) => ({
            label: statusLabel(status, msg.value),
            value: status,
        })),
    ],
);

// `?.app?.` rather than `?.app.` — the optional chain has to survive the whole
// path, not just its first step. `useDiscovery` assigns the response body with
// an unchecked `as DiscoverySnapshot`, so a 200 whose body is not a snapshot
// (an older backend, a proxy's JSON error page, a partial response) reaches
// here as a non-null value without `app`. The guard then stopped one step short
// and the page threw during a computed — which white-screens the route rather
// than showing the dash these fallbacks exist for.
// Narrowed to a string, not merely to "present". The type says `key` is a
// string; the runtime value is whatever the server sent, because `useDiscovery`
// assigns the body with an unchecked `as DiscoverySnapshot`. A truthy non-string
// — `{"app":{"key":1}}` — passes an existence check and then throws on
// `.charAt`, which is the same white-screen one step further in. Guarding
// presence without guarding type only moves the crash.
const appKeyText = computed(() => {
    const key = props.snapshot?.app?.key;
    return typeof key === 'string' ? key : '';
});
const appKey = computed(() => appKeyText.value || '—');
const appLabel = computed(() => {
    const k = appKeyText.value;
    return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Discovery';
});
const appVersion = computed(() => {
    const version = props.snapshot?.app?.version;
    return typeof version === 'string' && version ? version : '0.0.0';
});
const scanLabel = computed(() => {
    const scannedAt = props.snapshot?.scannedAt;
    // Same reasoning: the catch below covers a bad DATE, not a bad type — the
    // fallback `return scannedAt` would hand the template a non-string.
    if (typeof scannedAt !== 'string' || !scannedAt) return msg.value.notScannedYet;
    try {
        return new Date(scannedAt).toLocaleString(intlLocale.value);
    } catch {
        return scannedAt;
    }
});

const declaredAtByKey = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    // `Array.isArray`, not `?? []`. The nullish fallback only covers `null` and
    // `undefined`; anything else present goes straight into `for…of`, and a
    // JSON object or a number is not iterable — `for (const c of {})` throws,
    // which takes the route down exactly like the string methods above did.
    //
    // A string would have slipped through both: it IS iterable, so the loop
    // walks its characters and silently builds nonsense. That is why the case
    // covering this in the test suite had to be an object rather than a string —
    // the first version used a string and passed without exercising anything.
    const capabilities = props.snapshot?.capabilities;
    if (!Array.isArray(capabilities)) return map;
    for (const c of capabilities) {
        if (c && typeof c.capabilityKey === 'string') map[c.capabilityKey] = c.declaredAt;
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
    const q = (featureQuery.value ?? '').trim().toLowerCase();
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
.sa-discovery__panel {
    display: flex;
    flex-direction: column;
    background-color: var(--sa-color-bg-surface);
    padding: 16px 0 0;
}
.sa-discovery__banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--sa-color-inverse-bg);
    color: var(--sa-color-inverse-fg-muted);
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
    font-size: var(--sa-text-lg);
}
.sa-discovery__banner-meta {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}
.sa-discovery__banner-time {
    text-align: right;
}
.sa-discovery__banner-time-lbl {
    font-size: var(--sa-text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--sa-color-fg-subtle);
}
.sa-discovery__banner-time-val {
    font-size: var(--sa-text-md);
    font-weight: 600;
}
.sa-discovery__error {
    border-left: 4px solid var(--sa-color-negative);
}
.sa-discovery__tabs {
    border-bottom: 1px solid var(--sa-color-border);
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
.sa-discovery__group--orphan .sa-section__title {
    color: var(--sa-color-warning-fg);
}
.sa-discovery__group-count {
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    background: var(--sa-color-border);
    color: var(--sa-color-fg-secondary);
    padding: 1px 7px;
    border-radius: 8px;
}
.sa-discovery__orphan-hint {
    margin: 0 0 8px;
    font-size: var(--sa-text-xs);
    color: var(--sa-color-warning-fg);
}
.sa-discovery__orphan-hint code {
    font-size: var(--sa-text-2xs);
    background: var(--sa-color-warning-surface);
    padding: 1px 4px;
    border-radius: 4px;
}
.sa-discovery__empty-row {
    padding: 36px;
    text-align: center;
    color: var(--sa-color-fg-subtle);
    font-size: var(--sa-text-md);
    border: 1px dashed var(--sa-color-border-strong);
    border-radius: 12px;
}
.sa-muted {
    color: var(--sa-color-fg-subtle);
    margin-right: 3px;
}
/* Status badge (review lifecycle) — shared by feature and quota card. */
.sa-review {
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
    flex-shrink: 0;
}
.sa-review--pending {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
.sa-review--approved {
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
}
.sa-review--outdated {
    background: var(--sa-color-negative-surface-strong);
    color: var(--sa-color-negative-fg);
}
.sa-review--obsolete {
    background: var(--sa-color-border);
    color: var(--sa-color-fg-muted);
}
.sa-chip {
    font-size: var(--sa-text-2xs);
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 6px;
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
}
/* i18n coverage pill — shared by feature and quota card. */
.sa-cov-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 8px;
    border: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-sunken);
    color: var(--sa-color-fg-secondary);
}
.sa-cov-pill.complete {
    border-color: var(--sa-color-positive-border);
    background: var(--sa-color-positive-surface);
    color: var(--sa-color-positive-fg);
}
.sa-cov-pill.warn {
    border-color: var(--sa-color-warning-border);
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
}
.sa-cov-pill.low {
    border-color: var(--sa-color-negative-border);
    background: var(--sa-color-negative-surface);
    color: var(--sa-color-negative-fg);
}
</style>
