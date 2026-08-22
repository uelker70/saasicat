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
            <AdminErrorBanner :error="error" />

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
                                    :active-locales="locales"
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
                                :active-locales="locales"
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
import { useSuperAdminManifest } from '../vue/use-super-admin-context.js';
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { catalogResource } from '../client/resources/catalog.resource.js';
import type { discoveryResource } from '../client/resources/discovery.resource.js';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import type {
    CapabilityCatalogEntryRow,
    CatalogEntryI18n,
    CatalogEntryI18nFields,
    DiscoverySnapshot,
    DiscoveryStatus,
    FeatureCatalogEntryRow,
    QuotaCatalogEntryRow,
    UpdateCatalogEntryBaseData,
} from '@saasicat/core';
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
    /**
     * Locales a catalog entry may be written in.
     *
     * Defaults to the manifest's `project.availableLocales`, which is where
     * the shell already has it — an app only passes this when it wants a
     * narrower pool than its own configuration declares.
     */
    activeLocales?: string[];
    /**
     * Override the catalog or discovery resource for this page only. Layered
     * over the app's own override; see AP3 §3.2.
     */
    resources?: {
        catalog?: ResourceOverride<(typeof catalogResource)['ops']>;
        discovery?: ResourceOverride<(typeof discoveryResource)['ops']>;
    };
}>();

// The data layer, reached by name. This page used to take fourteen props —
// four lists, a loading flag, an error and seven callbacks — and every consumer
// wired `useDiscovery` and `useCatalogEntries` by hand to produce them. Both
// read the same endpoints these resources declare.
// The pool this project declares, unless the app narrows it. See BundlesPage.
const manifest = useSuperAdminManifest();
const locales = computed(
    () => props.activeLocales ?? manifest?.project?.availableLocales ?? ['de'],
);

const catalog = useResource('catalog', props.resources?.catalog);
const discoveryOps = useResource('discovery', props.resources?.discovery);

const snapshot = ref<DiscoverySnapshot | null>(null);
const capabilities = ref<CapabilityCatalogEntryRow[]>([]);
const features = ref<FeatureCatalogEntryRow[]>([]);
const quotas = ref<QuotaCatalogEntryRow[]>([]);
const loading = ref(false);
const error = ref<unknown>(null);

/** The three catalog lists, in one round trip each. */
async function loadEntries(): Promise<void> {
    const [caps, feats, qs] = await Promise.all([
        catalog.capabilities(),
        catalog.features(),
        catalog.quotas(),
    ]);
    capabilities.value = caps;
    features.value = feats;
    quotas.value = qs;
}

/** The snapshot. A 304 means what we hold is still current. */
async function loadSnapshot(): Promise<void> {
    const read = await discoveryOps.read(null);
    if (read.status === 'loaded') snapshot.value = read.snapshot;
}

async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        await Promise.all([loadEntries(), loadSnapshot()]);
    } catch (err) {
        error.value = err;
    } finally {
        loading.value = false;
    }
}

const activeTab = ref<'features' | 'quotas'>('features');

const featuresTabLabel = computed(() =>
    formatMessage(msg.value.tabFeatures, { count: features.value.length }),
);
const quotasTabLabel = computed(() =>
    formatMessage(msg.value.tabQuotas, { count: quotas.value.length }),
);
// `clearable` emits null, not '' — see Quasar's use-field clearValue().
const featureQuery = ref<string | null>('');
const statusFilter = ref<DiscoveryStatus | 'all'>('all');
const expandedFeature = ref<string | null>(null);
const expandedQuota = ref<string | null>(null);

const msg = useSaMessages('discovery');
const { intlLocale } = useSuperAdminI18n();

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
    const key = snapshot.value?.app?.key;
    return typeof key === 'string' ? key : '';
});
const appKey = computed(() => appKeyText.value || '—');
const appLabel = computed(() => {
    const k = appKeyText.value;
    return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Discovery';
});
const appVersion = computed(() => {
    const version = snapshot.value?.app?.version;
    return typeof version === 'string' && version ? version : '0.0.0';
});
const scanLabel = computed(() => {
    const scannedAt = snapshot.value?.scannedAt;
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
    const capabilities = snapshot.value?.capabilities;
    if (!Array.isArray(capabilities)) return map;
    for (const c of capabilities) {
        if (c && typeof c.capabilityKey === 'string') map[c.capabilityKey] = c.declaredAt;
    }
    return map;
});

// ─── Feature-centric aggregation ────────────────────────────────────────────

const capsByFeature = computed<Map<string, CapabilityCatalogEntryRow[]>>(() => {
    const map = new Map<string, CapabilityCatalogEntryRow[]>();
    for (const c of capabilities.value) {
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
    capabilities.value.filter((c) => !c.featureKey && c.codeStatus !== 'retired'),
);

const approvedCount = computed(
    () => features.value.filter((f) => f.discoveryStatus === 'approved').length,
);
const pendingCount = computed(
    () => features.value.filter((f) => f.discoveryStatus === 'pending').length,
);
const outdatedCount = computed(
    () => features.value.filter((f) => f.discoveryStatus === 'outdated').length,
);
const obsoleteCount = computed(
    () => features.value.filter((f) => f.discoveryStatus === 'obsolete').length,
);

const filteredFeatures = computed(() => {
    const q = (featureQuery.value ?? '').trim().toLowerCase();
    return features.value.filter((f) => {
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

/**
 * Rescan, hand the result to the catalog, then re-read what the catalog made
 * of it. The sync is skipped when the scan produced nothing — posting a null
 * snapshot would retire every entry the previous scan had found.
 */
async function onRunDiscovery(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        const scanned = await discoveryOps.rescan();
        if (scanned.snapshot) {
            snapshot.value = scanned.snapshot;
            await catalog.syncDiscovery(scanned.snapshot);
        }
        await loadEntries();
    } catch (err) {
        error.value = err;
    } finally {
        loading.value = false;
    }
}

function onFeatureReview(key: string, target: DiscoveryStatus): void {
    persist('feature', key, catalog.reviewFeature(key, { discoveryStatus: target }));
}
function onQuotaReview(key: string, target: DiscoveryStatus): void {
    persist('quota', key, catalog.reviewQuota(key, { discoveryStatus: target }));
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
/**
 * Saves, and writes the row the server answered with back into the page.
 *
 * The next payload is built from the page's row: a locale save sends the
 * WHOLE `i18n` object, so a second edit assembled from a row the first save
 * never updated would send the first edit's absence — and the server would
 * take that as a deletion.
 */
function persist(kind: 'feature' | 'quota', key: string, p: Promise<unknown>): void {
    p.then(
        (saved) => {
            if (!saved || typeof saved !== 'object') return;
            const rows = kind === 'feature' ? features.value : quotas.value;
            const idKey = kind === 'feature' ? 'featureKey' : 'quotaKey';
            const index = (rows as Array<Record<string, unknown>>).findIndex(
                (r) => r[idKey] === key,
            );
            if (index >= 0) (rows as unknown[])[index] = saved;
        },
        (err) => {
            // Auth renewal/redirect is handled by the HTTP client; here just log
            // so a failed save stays visible.
            console.error('Failed to save catalog entry', err);
        },
    );
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
            kind,
            key,
            kind === 'feature'
                ? catalog.setFeatureBase(key, data)
                : catalog.setQuotaBase(key, data),
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
            kind === 'feature' ? features.value : quotas.value;
        const idKey = kind === 'feature' ? 'featureKey' : 'quotaKey';
        const row = (rows as Array<Record<string, unknown>>).find((r) => r[idKey] === key);
        const next: CatalogEntryI18n = { ...((row?.i18n as CatalogEntryI18n) ?? {}) };
        const localeFields = { ...(next[locale] ?? {}) } as Record<string, string>;
        for (const [field, value] of Object.entries(data)) {
            withField(localeFields, field, String(value ?? ''));
        }
        next[locale] = localeFields;
        persist(
            kind,
            key,
            kind === 'feature'
                ? catalog.setFeatureI18n(key, next)
                : catalog.setQuotaI18n(key, next),
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

// A first visit to a project that was never scanned shows nothing at all, and
// nothing on the page says why. One scan on that state is the difference
// between an empty page and a page that explains itself.
onMounted(async () => {
    await reload();
    if (capabilities.value.length === 0 && !loading.value && error.value === null) {
        await onRunDiscovery();
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
