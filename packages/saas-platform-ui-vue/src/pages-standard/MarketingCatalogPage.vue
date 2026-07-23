<!--
  MarketingCatalogPage — marketing catalog for SuperAdmin (SPEC_V2 §11.1 M3).

  Public marketing projection per plan: filtered view for website,
  pricing page and checkout. Two tabs:
    · Public catalog preview   — browser mockup of the pricing page.
    · Marketing administration — visibility, badge, priority, highlight,
                                 teaser, trial & top features per plan.

  Live-data sources:
    · usePlans                 — plan master records.
    · /catalog/plans/:id/versions — live PlanVersion (pricing + features).
    · useMarketingProjections  — MarketingProjection per (PLAN, live version,
                                 locale). Edits go live immediately.

  Self-sufficient page (like PlansPage): consumers only pass through
  `adminEndpoint` + `projectKey`, the wrapper stays thin.
-->
<template>
    <div class="mc">
        <MarketingCatalogHeader
            v-model:locale-picker-open="localePickerOpen"
            :active-locale-set="activeLocaleSet"
            :active-locale="activeLocale"
            :default-locale="defaultLocale"
            :addable-locales="addableLocales"
            :busy="busy"
            @locale-change="onLocaleChange"
            @remove-locale="removeLocale"
            @add-locale="addLocale"
            @reload="reloadAll"
        />

        <div v-if="pageError" class="mc-banner mc-banner--error" role="alert">
            <strong>{{ common.error }}:</strong> {{ pageError }}
            <button class="mc-banner-x" type="button" @click="pageError = null">×</button>
        </div>

        <MarketingCatalogToolbar
            v-model:tab="tab"
            :active-promo-count="activePromoCount"
            :catalog-version="catalogVersion"
            :active-locale="activeLocale"
        />

        <div v-if="loading" class="mc-loading">{{ msg.page.loading }}</div>

        <!-- ─── Tab: Promotions ─── -->
        <MarketingPromotionsTab
            v-else-if="tab === 'promos'"
            :promotions="promotions"
            :plans="promoPlanOptions"
            :active-locales="activeLocaleSet"
            :busy="busy"
            :project-key="projectKey"
            :create="promotionsApi.create"
            :update="promotionsApi.update"
            :remove="promotionsApi.remove"
        />

        <div v-else-if="rows.length === 0" class="mc-banner mc-banner--info">
            {{ msg.page.emptyPlansBefore }} <strong>{{ msg.page.emptyPlansLink }}</strong>
            {{ msg.page.emptyPlansAfter }}
        </div>

        <MarketingCatalogPreview
            v-else-if="tab === 'preview'"
            :visible-rows="visibleRows"
            :preview-url="previewUrl"
            :monthly-of="monthlyOf"
            :yearly-of="yearlyOf"
            :format-euro="formatEuro"
            :promo-of="promoOf"
            :promo-result-of="promoResultOf"
            :promo-badge-of="promoBadgeOf"
            :promo-fineprint-of="promoFineprintOf"
            :promo-color-of="promoColorOf"
            :cta-text="ctaText"
            :show-trial-note="showTrialNote"
            :top-feature-label="topFeatureLabel"
        />

        <MarketingCatalogAdmin
            v-else
            :admin-rows="adminRows"
            :busy="busy"
            :expanded-key="expandedKey"
            :active-locale="activeLocale"
            :default-locale="defaultLocale"
            :edit-features="editFeatures"
            :format-version-title="formatVersionTitle"
            :format-version-tab="formatVersionTab"
            :auto-cta-text="autoCtaText"
            :cta-value="ctaValue"
            :resolve-component-label="resolveComponentLabel"
            :suggestions-for="suggestionsFor"
            @select-version="selectVersion"
            @patch="patch"
            @patch-display-label="patchDisplayLabel"
            @toggle-expand="toggleExpand"
            @update-feature-label="updateFeatureLabel"
            @update-feature-strong="updateFeatureStrong"
            @persist-features="persistFeatures"
            @move-feature="moveFeature"
            @remove-feature="removeFeature"
            @add-feature="addFeature"
            @add-suggestion="addSuggestion"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
    applyPromo,
    pickActivePromo,
    promoStatus,
    type MarketingProjectionRow,
    type MarketingTopFeature,
    type PlanRow,
    type PlanVersionRow,
    type PromotionResult,
    type PromotionRow,
} from '@saasicat/types';
import { usePlans } from '../vue/use-plans.js';
import { useMarketingProjections } from '../vue/use-marketing-projections.js';
import { usePromotions } from '../vue/use-promotions.js';
import { useCatalogEntries } from '../vue/use-catalog-entries.js';
import { formatCurrency } from '../client/i18n/currency.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import { formatMessage } from '../client/i18n/format.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';
import MarketingPromotionsTab from '../components/MarketingPromotionsTab.vue';
import MarketingCatalogAdmin from './marketing-catalog/MarketingCatalogAdmin.vue';
import MarketingCatalogHeader from './marketing-catalog/MarketingCatalogHeader.vue';
import MarketingCatalogPreview from './marketing-catalog/MarketingCatalogPreview.vue';
import MarketingCatalogToolbar from './marketing-catalog/MarketingCatalogToolbar.vue';
import type {
    FeatureSuggestion,
    MarketingCatalogTab,
    MarketingRow,
    ResolvedMarketing,
} from './marketing-catalog/types.js';

const DEFAULT_ACCENT = '#64748b';

const props = defineProps<{
    adminEndpoint: string;
    projectKey: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** Available locales — the first one is the default. Defaults to `['de']`. */
    availableLocales?: string[];
    /** Feature-label map for top-feature suggestions (key → label). */
    featureRegistry?: Record<string, { label?: string }>;
    /** Quota label/unit map for top-feature suggestions. */
    quotaRegistry?: Record<string, { label?: string; unit?: string }>;
    /** Accent color per plan key for the plan mark in the administration view. */
    planAccents?: Record<string, string>;
}>();

const msg = useSaMessages('marketing');
const common = useSaMessages('common');
const { locale, intlLocale } = useSuperAdminI18n();

const availableLocales = computed(() =>
    props.availableLocales && props.availableLocales.length > 0 ? props.availableLocales : ['de'],
);

const tab = ref<MarketingCatalogTab>('preview');
const expandedKey = ref<string | null>(null);
const activeLocale = ref<string>(availableLocales.value[0]);

// LocaleManager — `availableLocales` is the allowed pool (app config,
// SPEC_V2 §6.5), `activeLocaleSet` the runtime-activated subset.
// Persisted via `/admin/catalog/marketing-settings` (MarketingSettings).
const defaultLocale = computed(() => availableLocales.value[0]);
const activeLocaleSet = ref<string[]>([...availableLocales.value]);
const localePickerOpen = ref(false);
const addableLocales = computed(() =>
    availableLocales.value.filter((l) => !activeLocaleSet.value.includes(l)),
);

/** Loads the persisted activeLocales subset (fallback: full pool). */
async function loadMarketingSettings(): Promise<void> {
    try {
        const res = await httpClient(
            `${props.adminEndpoint}/catalog/marketing-settings?projectKey=${encodeURIComponent(props.projectKey)}`,
            { headers: authHeaders() },
        );
        if (res.status !== 200) return;
        const body = (await res.json().catch(() => null)) as {
            activeLocales?: string[];
        } | null;
        if (body && Array.isArray(body.activeLocales) && body.activeLocales.length > 0) {
            // Restrict to the valid pool; the default locale stays active.
            const pool = availableLocales.value;
            const next = body.activeLocales.filter((l) => pool.includes(l));
            if (!next.includes(defaultLocale.value)) next.unshift(defaultLocale.value);
            activeLocaleSet.value = next;
        }
    } catch {
        // Network error — stays with the pool default.
    }
}

/** Persists the current activeLocales selection (best-effort). */
async function persistActiveLocales(): Promise<void> {
    try {
        await httpClient(`${props.adminEndpoint}/catalog/marketing-settings`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
                projectKey: props.projectKey,
                activeLocales: activeLocaleSet.value,
            }),
        });
    } catch {
        // best-effort — the UI state is preserved.
    }
}

function addLocale(loc: string): void {
    if (!activeLocaleSet.value.includes(loc)) {
        activeLocaleSet.value = [...activeLocaleSet.value, loc];
        void persistActiveLocales();
    }
    localePickerOpen.value = false;
}
function removeLocale(loc: string): void {
    if (loc === defaultLocale.value) return;
    activeLocaleSet.value = activeLocaleSet.value.filter((l) => l !== loc);
    if (activeLocale.value === loc) void onLocaleChange(defaultLocale.value);
    void persistActiveLocales();
}
const busy = ref(false);
const pageError = ref<string | null>(null);
const versionsByPlanId = ref<Record<string, PlanVersionRow[]>>({});

/** Local editing copy of the top features of the currently expanded row. */
const editFeatures = ref<MarketingTopFeature[]>([]);

const plansApi = usePlans({
    adminEndpoint: props.adminEndpoint,
    projectKey: props.projectKey,
    http: props.http,
    getAuthToken: props.getAuthToken,
});

const projectionsApi = useMarketingProjections({
    adminEndpoint: props.adminEndpoint,
    http: props.http,
    getAuthToken: props.getAuthToken,
    filter: { projectKey: props.projectKey, targetType: 'PLAN', locale: activeLocale.value },
});

const promotionsApi = usePromotions({
    adminEndpoint: props.adminEndpoint,
    projectKey: props.projectKey,
    http: props.http,
    getAuthToken: props.getAuthToken,
});

// Catalog entries (features + quotas with i18n) — provides the translated
// labels for the top-features editor (SPEC_V2 §6.3 + §6.5).
const catalogEntriesApi = useCatalogEntries({
    adminEndpoint: props.adminEndpoint,
    projectKey: props.projectKey,
    http: props.http,
    getAuthToken: props.getAuthToken,
});

const loading = computed(() => plansApi.loading.value || projectionsApi.loading.value);

/**
 * Translated label of a feature/quota key for the editing locale.
 * Order: catalog-entry i18n → catalog-entry label → static
 * registry prop → key as last fallback.
 */
function resolveComponentLabel(key: string): string {
    const loc = activeLocale.value;
    const f = catalogEntriesApi.features.value.find((x) => x.featureKey === key);
    if (f) {
        const translated = f.i18n?.[loc]?.label;
        if (translated && translated.trim()) return translated;
        if (f.label && f.label !== key) return f.label;
    }
    const q = catalogEntriesApi.quotas.value.find((x) => x.quotaKey === key);
    if (q) {
        const translated = q.i18n?.[loc]?.label;
        if (translated && translated.trim()) return translated;
        if (q.label && q.label !== key) return q.label;
    }
    return props.featureRegistry?.[key]?.label ?? props.quotaRegistry?.[key]?.label ?? key;
}
/** Translated quota unit for the editing locale. */
function resolveQuotaUnit(key: string): string {
    const loc = activeLocale.value;
    const q = catalogEntriesApi.quotas.value.find((x) => x.quotaKey === key);
    if (q) {
        const translated = q.i18n?.[loc]?.unit;
        if (translated && translated.trim()) return translated;
        if (q.unit) return q.unit;
    }
    return props.quotaRegistry?.[key]?.unit ?? '';
}
/** Effective top-feature label: the `label` override wins, otherwise key resolution. */
function topFeatureLabel(f: MarketingTopFeature): string {
    let key = f.key;
    let label = (f.label ?? '').trim();
    // Migration: legacy entry whose `label` is a known key.
    if (!key && label && knownComponentKeys.value.has(label)) {
        key = label;
        label = '';
    }
    if (label) return label;
    return key ? resolveComponentLabel(key) : '';
}
/** Set of all known feature/quota keys — for migrating legacy entries. */
const knownComponentKeys = computed(() => {
    const s = new Set<string>();
    for (const f of catalogEntriesApi.features.value) s.add(f.featureKey);
    for (const q of catalogEntriesApi.quotas.value) s.add(q.quotaKey);
    return s;
});

/** Plan list (key + label) for the promotions `appliesTo` selection. */
const promoPlanOptions = computed(() =>
    plansApi.plans.value.map((p) => ({
        key: p.planKey,
        label: p.label || p.planKey,
    })),
);

/** Promotions list + count of currently active promotions (for the tab badge). */
const promotions = computed(() => promotionsApi.promotions.value);
const activePromoCount = computed(
    () => promotions.value.filter((p) => promoStatus(p) === 'active').length,
);

const httpClient: HttpClient = props.http ?? defaultHttpClient();

function authHeaders(): Record<string, string> {
    const token = props.getAuthToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function reloadVersions(): Promise<void> {
    const results = await Promise.all(
        plansApi.plans.value.map(async (p) => {
            const res = await httpClient(`${props.adminEndpoint}/catalog/plans/${p.id}/versions`, {
                headers: authHeaders(),
            });
            if (res.status !== 200) return [p.id, [] as PlanVersionRow[]] as const;
            const body = (await res.json().catch(() => [])) as PlanVersionRow[];
            return [p.id, Array.isArray(body) ? body : []] as const;
        }),
    );
    const next: Record<string, PlanVersionRow[]> = {};
    for (const [id, vs] of results) next[id] = vs;
    versionsByPlanId.value = next;
}

async function reloadAll(): Promise<void> {
    busy.value = true;
    pageError.value = null;
    try {
        await Promise.all([
            plansApi.load(),
            projectionsApi.load(),
            promotionsApi.load(),
            catalogEntriesApi.load(),
            loadMarketingSettings(),
        ]);
        await reloadVersions();
    } catch (err) {
        pageError.value = err instanceof Error ? err.message : String(err);
    } finally {
        busy.value = false;
    }
}

onMounted(() => {
    void reloadAll();
});

/**
 * All published versions of a plan, sorted by `validFrom` ascending.
 * Serves as the tab list in the marketing-catalog administration.
 */
function publishedVersionsOf(plan: PlanRow): PlanVersionRow[] {
    const versions = versionsByPlanId.value[plan.id] ?? [];
    return versions
        .filter((v) => v.publishedAt !== null)
        .sort((a, b) => {
            const fa = a.validFrom ? new Date(a.validFrom).getTime() : 0;
            const fb = b.validFrom ? new Date(b.validFrom).getTime() : 0;
            if (fa !== fb) return fa - fb;
            return a.version - b.version;
        });
}

/**
 * Version active as of `asOf` (SPEC_V2 §4.2): `validFrom <= asOf` and
 * (`validUntil == null OR validUntil > asOf`). Default is the version
 * active today. Fallback when no `validFrom` data is maintained:
 * highest version.
 */
function activeVersionOf(plan: PlanRow, asOf: Date = new Date()): PlanVersionRow | null {
    const published = publishedVersionsOf(plan);
    if (published.length === 0) {
        // Effective version = live ?? draft (same principle as the
        // plan matrix): otherwise initial-seed drafts are not
        // curatable and provide no top-feature suggestions.
        const drafts = (versionsByPlanId.value[plan.id] ?? []).filter((v) => !v.publishedAt);
        return drafts.sort((a, b) => b.version - a.version)[0] ?? null;
    }
    const t = asOf.getTime();
    const active = published.filter((v) => {
        if (!v.validFrom) return false;
        const from = new Date(v.validFrom).getTime();
        if (Number.isNaN(from) || from > t) return false;
        if (v.validUntil) {
            const until = new Date(v.validUntil).getTime();
            if (!Number.isNaN(until) && until <= t) return false;
        }
        return true;
    });
    if (active.length > 0) {
        // Highest validFrom wins (= "most recent active").
        return active[active.length - 1];
    }
    // No match (validFrom all in the future OR all expired)
    // → fall back to the last non-superseded version.
    return (
        [...published].reverse().find((v) => v.supersededAt === null) ??
        published[published.length - 1]
    );
}

/** Per-plan state: which version is currently selected in the UI (tab). */
const selectedVersionByPlanId = ref<Record<string, string>>({});

function selectedVersionOf(plan: PlanRow): PlanVersionRow | null {
    const explicit = selectedVersionByPlanId.value[plan.id];
    if (explicit) {
        const found = (versionsByPlanId.value[plan.id] ?? []).find((v) => v.id === explicit);
        if (found) return found;
    }
    return activeVersionOf(plan);
}

function selectVersion(plan: PlanRow, versionId: string): void {
    selectedVersionByPlanId.value = {
        ...selectedVersionByPlanId.value,
        [plan.id]: versionId,
    };
}

function formatVersionTab(v: PlanVersionRow): string {
    const from = v.validFrom ? formatDateShort(v.validFrom) : '?';
    const until = v.validUntil ? formatDateShort(v.validUntil) : '∞';
    return `v${v.version} · ${from}–${until}`;
}

function formatVersionTitle(v: PlanVersionRow): string {
    const from = v.validFrom
        ? formatDateLong(v.validFrom)
        : msg.value.admin.versionValidFromUnknown;
    const until = v.validUntil ? formatDateLong(v.validUntil) : common.value.unlimited;
    const changeNote = v.changeNote ? ` — ${v.changeNote}` : '';
    return formatMessage(msg.value.admin.versionTitle, {
        version: v.version,
        from,
        until,
        changeNote,
    });
}

function formatDateShort(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(intlLocale.value, {
            day: '2-digit',
            month: '2-digit',
        });
    } catch {
        return iso.slice(0, 10);
    }
}

function formatDateLong(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(intlLocale.value, {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return iso.slice(0, 10);
    }
}

function resolveMarketing(
    plan: PlanRow,
    projection: MarketingProjectionRow | null,
): ResolvedMarketing {
    if (projection) {
        // `displayLabel == plan.label` ⇒ effectively "no translation", because the
        // public-catalog service falls back to `plan.label` anyway. We then show
        // the field empty (override = nothing) so the DE fallback stays
        // visible.
        const labelOverride =
            projection.displayLabel && projection.displayLabel !== plan.label
                ? projection.displayLabel
                : '';
        return {
            displayLabel: labelOverride,
            visible: projection.visible,
            highlight: projection.highlight,
            badge: projection.badge,
            priority: projection.priority,
            description: projection.description,
            trialEnabled: projection.trialEnabled,
            trialDays: projection.trialDays,
            ctaLabel: projection.ctaLabel,
            topFeatures: projection.topFeatures,
            priceTag: projection.priceTag,
        };
    }
    return {
        displayLabel: '',
        visible: true,
        highlight: false,
        badge: '',
        priority: 0,
        description: plan.description ?? '',
        trialEnabled: false,
        trialDays: 30,
        ctaLabel: null,
        topFeatures: [],
        priceTag: null,
    };
}

const rows = computed<MarketingRow[]>(() =>
    [...plansApi.plans.value]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((plan) => {
            // `liveVersion` is now the version selected in the UI
            // (default = today's active, otherwise switched by tab click).
            // Existing bindings (`row.liveVersion` disable states) stay
            // unchanged — a version without pricing does not count as
            // "editable".
            const liveVersion = selectedVersionOf(plan);
            const projection = liveVersion
                ? (projectionsApi.projections.value.find(
                      (p) => p.targetVersionId === liveVersion.id,
                  ) ?? null)
                : null;
            return {
                plan,
                accent: props.planAccents?.[plan.planKey] ?? DEFAULT_ACCENT,
                liveVersion,
                publishedVersions: publishedVersionsOf(plan),
                projection,
                m: resolveMarketing(plan, projection),
            };
        }),
);

/** Administration: priority DESC, then plan sortOrder. */
const adminRows = computed<MarketingRow[]>(() =>
    [...rows.value].sort(
        (a, b) => b.m.priority - a.m.priority || a.plan.sortOrder - b.plan.sortOrder,
    ),
);

/** Preview: only visible plans, priority DESC. */
const visibleRows = computed<MarketingRow[]>(() => adminRows.value.filter((r) => r.m.visible));

const catalogVersion = computed<string>(() => {
    const stamps = projectionsApi.projections.value.map((p) => p.updatedAt);
    if (stamps.length === 0) return new Date().toISOString().slice(0, 10);
    return stamps.sort().slice(-1)[0].slice(0, 10);
});

const previewUrl = computed(() => `${props.projectKey}.de/preise`);

// ─── Pricing ───
function monthlyOf(row: MarketingRow): number {
    return row.liveVersion ? Number.parseFloat(row.liveVersion.monthlyNet) || 0 : 0;
}
function yearlyOf(row: MarketingRow): number {
    return row.liveVersion ? Number.parseFloat(row.liveVersion.yearlyNet) || 0 : 0;
}
function formatEuro(value: number): string {
    return formatCurrency(Math.round(value * 100) / 100, locale.value);
}

// ─── Promo application in the preview (SPEC_V2 §9a) ───
const promoToday = new Date();
function promoOf(row: MarketingRow): PromotionRow | null {
    return pickActivePromo(
        promotions.value,
        row.plan.planKey,
        activeLocale.value,
        'monthly',
        promoToday,
    );
}
function promoResultOf(row: MarketingRow): PromotionResult | null {
    const promo = promoOf(row);
    if (!promo || !row.liveVersion) return null;
    return applyPromo(promo, monthlyOf(row));
}
function promoBadgeOf(row: MarketingRow): string {
    const promo = promoOf(row);
    if (!promo) return '';
    return (
        promo.i18n?.[activeLocale.value]?.badge ||
        promo.i18n?.de?.badge ||
        msg.value.preview.promoBadgeFallback
    );
}
function promoFineprintOf(row: MarketingRow): string {
    const promo = promoOf(row);
    if (!promo) return '';
    return promo.i18n?.[activeLocale.value]?.fineprint || promo.i18n?.de?.fineprint || '';
}
function promoColorOf(row: MarketingRow): string {
    return promoOf(row)?.color ?? '#10b981';
}

// ─── CTA ───
function autoCtaText(row: MarketingRow): string {
    if (!row.liveVersion) return msg.value.cta.contact;
    if (row.m.trialEnabled) return formatMessage(msg.value.cta.trial, { days: row.m.trialDays });
    return msg.value.cta.choosePlan;
}
function ctaText(row: MarketingRow): string {
    return row.m.ctaLabel && row.m.ctaLabel.length > 0 ? row.m.ctaLabel : autoCtaText(row);
}
function showTrialNote(row: MarketingRow): boolean {
    return Boolean(row.liveVersion) && row.m.trialEnabled && !row.m.ctaLabel;
}
/** Persist an empty CTA text as `null` (= auto text). */
function ctaValue(raw: string): string | null {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// ─── Top-feature suggestions from the plan components ───
function suggestionsFor(row: MarketingRow): FeatureSuggestion[] {
    if (!row.liveVersion) return [];
    const usedKeys = new Set(editFeatures.value.map((f) => f.key).filter((k): k is string => !!k));
    const fromFeatures: FeatureSuggestion[] = row.liveVersion.features.map((key) => ({
        key,
        label: resolveComponentLabel(key),
        strong: '',
    }));
    const quotas = row.liveVersion.quotas ?? {};
    const fromQuotas: FeatureSuggestion[] = Object.entries(quotas).map(([key, value]) => {
        const unit = resolveQuotaUnit(key);
        return {
            key,
            label: resolveComponentLabel(key),
            strong: `${value}${unit ? ` ${unit}` : ''}`,
        };
    });
    // Offer all components of the version (no cap of 6) — only hide keys
    // that are already used.
    return [...fromFeatures, ...fromQuotas].filter((s) => !usedKeys.has(s.key));
}

// ─── Persistence ───
function fallbackText(row: MarketingRow): string {
    return row.plan.description ?? row.plan.label;
}

/**
 * Persists a partial against the MarketingProjection of the live version.
 * If the projection does not exist yet, it is created from the resolved
 * values + partial. Plans without a live version are not marketable.
 */
/**
 * Sets the plan name in the current locale.
 * Empty input = explicit "no translation" → persists `plan.label`,
 * the public-catalog service then renders the DE name anyway.
 */
async function patchDisplayLabel(row: MarketingRow, value: string): Promise<void> {
    const trimmed = value.trim();
    const displayLabel = trimmed || row.plan.label;
    await patch(row, { displayLabel });
}

async function patch(row: MarketingRow, partial: Partial<ResolvedMarketing>): Promise<void> {
    if (!row.liveVersion) return;
    busy.value = true;
    pageError.value = null;
    try {
        if (row.projection) {
            await projectionsApi.update(row.projection.id, partial);
        } else {
            const merged: ResolvedMarketing = { ...row.m, ...partial };
            await projectionsApi.create({
                projectKey: props.projectKey,
                targetType: 'PLAN',
                targetVersionId: row.liveVersion.id,
                locale: activeLocale.value,
                displayLabel: merged.displayLabel.trim() || row.plan.label,
                description: merged.description.trim() || fallbackText(row),
                visible: merged.visible,
                badge: merged.badge,
                topFeatures: merged.topFeatures,
                trialEnabled: merged.trialEnabled,
                trialDays: merged.trialDays,
                ctaLabel: merged.ctaLabel,
                priority: merged.priority,
                highlight: merged.highlight,
            });
        }
    } catch (err) {
        pageError.value = err instanceof Error ? err.message : String(err);
        await projectionsApi.load();
    } finally {
        busy.value = false;
    }
}

// ─── Expand / top-feature editor ───
function toggleExpand(row: MarketingRow): void {
    if (expandedKey.value === row.plan.planKey) {
        expandedKey.value = null;
        editFeatures.value = [];
        return;
    }
    expandedKey.value = row.plan.planKey;
    // Migration: legacy entries whose `label` is a known feature/quota
    // key become key-referenced (auto-translated) entries.
    editFeatures.value = row.m.topFeatures.map((f) => {
        if (!f.key && f.label && knownComponentKeys.value.has(f.label)) {
            return { key: f.label, label: '', strong: f.strong };
        }
        return { ...f };
    });
}

/**
 * Persists the local editing copy. Entries without `key` AND without `label`
 * are dropped; key-referenced entries remain (label is resolved).
 */
async function persistFeatures(row: MarketingRow): Promise<void> {
    const cleaned: MarketingTopFeature[] = editFeatures.value
        .filter((f) => (f.key && f.key.trim().length > 0) || f.label.trim().length > 0)
        .map((f) => ({
            ...(f.key && f.key.trim() ? { key: f.key.trim() } : {}),
            label: f.label.trim(),
            strong: f.strong.trim(),
        }));
    await patch(row, { topFeatures: cleaned });
}

function addFeature(row: MarketingRow): void {
    void row;
    editFeatures.value.push({ label: '', strong: '' });
}

function updateFeatureLabel(index: number, value: string): void {
    const item = editFeatures.value[index];
    if (item) item.label = value;
}

function updateFeatureStrong(index: number, value: string): void {
    const item = editFeatures.value[index];
    if (item) item.strong = value;
}

async function addSuggestion(row: MarketingRow, s: FeatureSuggestion): Promise<void> {
    // `label` empty → the label is resolved from `key` depending on the locale.
    editFeatures.value.push({ key: s.key, label: '', strong: s.strong });
    await persistFeatures(row);
}

async function removeFeature(row: MarketingRow, idx: number): Promise<void> {
    editFeatures.value.splice(idx, 1);
    await persistFeatures(row);
}

async function moveFeature(row: MarketingRow, idx: number, dir: -1 | 1): Promise<void> {
    const j = idx + dir;
    if (j < 0 || j >= editFeatures.value.length) return;
    const list = editFeatures.value;
    [list[idx], list[j]] = [list[j], list[idx]];
    await persistFeatures(row);
}

async function onLocaleChange(loc: string): Promise<void> {
    if (loc === activeLocale.value) return;
    activeLocale.value = loc;
    expandedKey.value = null;
    editFeatures.value = [];
    busy.value = true;
    try {
        await projectionsApi.setFilter({
            projectKey: props.projectKey,
            targetType: 'PLAN',
            locale: loc,
        });
    } catch (err) {
        pageError.value = err instanceof Error ? err.message : String(err);
    } finally {
        busy.value = false;
    }
}
</script>

<style>
.mc {
    --mc-bg: #f6f7f9;
    --mc-surface: #ffffff;
    --mc-surface-2: #f8fafc;
    --mc-border: #e5e7eb;
    --mc-border-strong: #d1d5db;
    --mc-text: #0f172a;
    --mc-text-2: #475569;
    --mc-text-3: #94a3b8;
    --mc-primary: #2563eb;
    --mc-primary-700: #1d4ed8;
    --mc-primary-50: #eff6ff;
    --mc-font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --mc-font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

    padding: 22px 26px;
    background: var(--mc-bg);
    color: var(--mc-text);
    font-family: var(--mc-font-sans);
    min-height: 100%;
    box-sizing: border-box;
}
.mc * {
    box-sizing: border-box;
}

.mc-page-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 14px;
}
.mc-h-title {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0;
}
.mc-h-sub {
    font-size: 12.5px;
    color: var(--mc-text-2);
    margin: 3px 0 0;
}
.mc-head-actions {
    display: flex;
    align-items: center;
    gap: 10px;
}

.mc-locale-switch {
    display: inline-flex;
    gap: 2px;
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: 8px;
    padding: 3px;
}
.mc-locale-btn {
    padding: 5px 10px;
    border: 0;
    background: transparent;
    border-radius: 6px;
    font: 500 12px var(--mc-font-mono);
    color: var(--mc-text-2);
    cursor: pointer;
}
.mc-locale-btn.active {
    background: var(--mc-primary-50);
    color: var(--mc-primary-700);
    font-weight: 600;
}
.mc-locale-mgr {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
}
.mc-locale-mgr-label {
    font-size: 11px;
    color: var(--mc-text-3);
}
.mc-locale-pill {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--mc-border);
    border-radius: 7px;
    overflow: hidden;
}
.mc-locale-pill.active {
    border-color: var(--mc-primary-700);
    background: var(--mc-primary-50);
}
.mc-locale-pill-btn {
    border: 0;
    background: transparent;
    padding: 4px 8px;
    font: 600 11px var(--mc-font-mono);
    color: var(--mc-text-2);
    cursor: pointer;
}
.mc-locale-pill.active .mc-locale-pill-btn {
    color: var(--mc-primary-700);
}
.mc-locale-x {
    border: 0;
    background: transparent;
    padding: 4px 7px;
    color: var(--mc-text-3);
    cursor: pointer;
    font-size: 13px;
}
.mc-locale-x:hover {
    color: #dc2626;
}
.mc-locale-add-wrap {
    position: relative;
}
.mc-locale-add {
    border: 1px dashed var(--mc-border);
    background: transparent;
    border-radius: 7px;
    padding: 4px 9px;
    font-size: 11px;
    color: var(--mc-text-2);
    cursor: pointer;
}
.mc-locale-add:disabled {
    opacity: 0.4;
    cursor: default;
}
.mc-locale-picker {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 20;
    min-width: 80px;
}
.mc-locale-picker-row {
    border: 0;
    background: transparent;
    padding: 6px 10px;
    text-align: left;
    border-radius: 6px;
    font: 600 11px var(--mc-font-mono);
    cursor: pointer;
}
.mc-locale-picker-row:hover {
    background: var(--mc-primary-50);
}

.mc-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px;
    border-radius: 7px;
    font: 500 13px var(--mc-font-sans);
    cursor: pointer;
    border: 1px solid var(--mc-border-strong);
    background: var(--mc-surface);
    color: var(--mc-text);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.mc-btn:hover:not(:disabled) {
    background: #f8fafc;
}
.mc-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.mc-btn--sm {
    padding: 5px 9px;
    font-size: 12px;
    gap: 5px;
}

.mc-banner {
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 12.5px;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
}
.mc-banner--error {
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fca5a5;
}
.mc-banner--info {
    background: var(--mc-primary-50);
    color: #1e40af;
    border: 1px solid #bfdbfe;
}
.mc-banner-x {
    margin-left: auto;
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    color: inherit;
}
.mc-loading {
    padding: 40px;
    text-align: center;
    color: var(--mc-text-3);
    font-size: 13px;
}

.mc-toolbar {
    display: flex;
    gap: 12px;
    align-items: center;
    margin: 4px 0 16px;
}
.mc-tabbar {
    display: inline-flex;
    gap: 2px;
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: 8px;
    padding: 3px;
}
.mc-tab {
    padding: 6px 14px;
    border-radius: 6px;
    font: 500 13px var(--mc-font-sans);
    color: var(--mc-text-2);
    background: transparent;
    border: 0;
    cursor: pointer;
    transition:
        background 0.12s,
        color 0.12s;
}
.mc-tab:hover {
    color: var(--mc-text);
}
.mc-tab.active {
    background: var(--mc-primary-50);
    color: var(--mc-primary-700);
    font-weight: 600;
}
.mc-tab-count {
    display: inline-block;
    margin-left: 5px;
    background: #10b981;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
}
.mc-meta {
    margin-left: auto;
    font-size: 12px;
    color: var(--mc-text-2);
    display: flex;
    align-items: center;
    gap: 8px;
}
.mc-meta code {
    font: 500 11px var(--mc-font-mono);
    background: #f1f5f9;
    color: #475569;
    padding: 2px 7px;
    border-radius: 4px;
}

/* ── Public catalog preview ── */
.mc-window {
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: 12px;
    overflow: hidden;
}
.mc-chrome {
    height: 36px;
    background: #f1f5f9;
    border-bottom: 1px solid var(--mc-border);
    display: flex;
    align-items: center;
    padding: 0 14px;
    gap: 6px;
}
.mc-chrome-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
}
.mc-chrome-url {
    margin-left: 18px;
    flex: 1;
    background: var(--mc-surface);
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 4px 10px;
    font: 500 11.5px var(--mc-font-mono);
    color: #475569;
    max-width: 380px;
}
.mc-canvas {
    background: linear-gradient(180deg, #fbfbfd 0%, #fff 100%);
    padding: 36px 32px 28px;
}
.mc-eyebrow {
    font: 700 11px var(--mc-font-sans);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--mc-primary);
    text-align: center;
}
.mc-hero {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.025em;
    color: var(--mc-text);
    text-align: center;
    margin: 10px 0 6px;
}
.mc-sub {
    font-size: 14px;
    color: var(--mc-text-2);
    text-align: center;
    max-width: 540px;
    margin: 0 auto 26px;
}
.mc-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
}
.mc-card {
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: 12px;
    padding: 22px 20px 20px;
    display: flex;
    flex-direction: column;
    position: relative;
    transition:
        transform 0.15s,
        box-shadow 0.15s,
        border-color 0.15s;
}
.mc-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}
.mc-card.featured {
    border-color: #bfdbfe;
    box-shadow: 0 10px 32px rgba(37, 99, 235, 0.1);
}
.mc-card-badge {
    position: absolute;
    top: -10px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--mc-primary);
    color: #fff;
    font: 700 10.5px var(--mc-font-sans);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 4px 12px;
    border-radius: 999px;
    white-space: nowrap;
}
.mc-card-key {
    font: 700 10.5px var(--mc-font-mono);
    letter-spacing: 0.08em;
    color: var(--mc-text-3);
    text-transform: uppercase;
}
.mc-card-name {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--mc-text);
    margin: 2px 0 4px;
}
.mc-card-desc {
    font-size: 12.5px;
    color: var(--mc-text-2);
    line-height: 1.4;
    min-height: 36px;
}
.mc-card-price {
    margin: 18px 0 4px;
    display: flex;
    align-items: baseline;
    gap: 6px;
}
.mc-card-price-big {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--mc-text);
}
.mc-card-price-unit {
    font-size: 13px;
    color: var(--mc-text-3);
}
.mc-card-price-y {
    font-size: 11.5px;
    color: var(--mc-text-3);
    margin-bottom: 12px;
}
.mc-card-cta {
    width: 100%;
    margin-top: 14px;
    padding: 9px 12px;
    border-radius: 8px;
    border: 1px solid var(--mc-border);
    background: var(--mc-surface);
    color: var(--mc-text);
    font: 600 13px var(--mc-font-sans);
    cursor: pointer;
    transition:
        background 0.12s,
        border-color 0.12s;
}
.mc-card-cta:hover {
    background: #f8fafc;
}
.mc-card.featured .mc-card-cta {
    background: var(--mc-primary);
    border-color: var(--mc-primary);
    color: #fff;
}
.mc-card.featured .mc-card-cta:hover {
    background: var(--mc-primary-700);
}
.mc-card-trialnote {
    font-size: 11px;
    color: var(--mc-text-3);
    text-align: center;
    margin-top: 6px;
}
.mc-card.has-promo {
    border-color: #10b981;
}
.mc-promo-ribbon {
    position: absolute;
    top: 12px;
    right: -2px;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 12px 3px 10px;
    border-radius: 4px 0 0 4px;
}
.mc-card-price-strike {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-top: 2px;
}
.mc-card-price-strike s {
    color: var(--mc-text-3);
    font-size: 14px;
}
.mc-price-regular {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--mc-text-3);
}
.mc-card-fineprint {
    font-size: 10px;
    color: #059669;
    text-align: center;
    margin-top: 6px;
}
.mc-card-includes {
    margin-top: 18px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--mc-text-3);
    font-weight: 700;
}
.mc-card-features {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
    font-size: 12.5px;
    color: #334155;
}
.mc-card-features li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    line-height: 1.35;
}
.mc-card-features .mc-tick {
    color: #10b981;
    flex: 0 0 14px;
    margin-top: 1px;
}
.mc-card-features b {
    color: var(--mc-text);
    font-weight: 700;
}
.mc-card-features-empty {
    margin-top: 8px;
    font-size: 12px;
    color: var(--mc-text-3);
}

/* ── Marketing administration ── */
.mc-admin {
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: 10px;
}
.mc-admin-head {
    padding: 14px 16px;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    gap: 12px;
}
.mc-admin-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--mc-text);
}
.mc-admin-sub {
    font-size: 11.5px;
    color: var(--mc-text-2);
}
.mc-admin-grid {
    display: grid;
    grid-template-columns: 1.6fr 1fr 1.4fr 1fr 1fr 150px;
    align-items: stretch;
}
.mc-admin-thead {
    display: contents;
}
.mc-admin-thead > div {
    background: #fbfbfd;
    padding: 10px 14px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--mc-text-2);
    font-weight: 700;
    border-bottom: 1px solid var(--mc-border);
}
.mc-admin-row {
    display: contents;
}
.mc-admin-row > div {
    padding: 12px 14px;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    font-size: 12.5px;
    color: var(--mc-text);
}
.mc-admin-row--disabled > div {
    background: #fcfcfd;
}
.mc-admin-row-end {
    justify-content: flex-end;
    gap: 8px;
}
.mc-plan-cell {
    display: flex;
    align-items: center;
    gap: 12px;
}
.mc-plan-mark {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    font: 700 10px var(--mc-font-mono);
    border: 1px solid;
}
.mc-plan-label {
    font-size: 13px;
    font-weight: 700;
    color: var(--mc-text);
}
.mc-plan-key {
    font: 500 11px var(--mc-font-mono);
    color: var(--mc-text-3);
}

.mc-field {
    width: 100%;
    padding: 5px 8px;
    font: 400 12px var(--mc-font-sans);
    color: var(--mc-text);
    background: var(--mc-surface);
    border: 1px solid var(--mc-border-strong);
    border-radius: 6px;
}
.mc-field:focus {
    outline: none;
    border-color: var(--mc-primary);
    box-shadow: 0 0 0 3px var(--mc-primary-50);
}
.mc-field:disabled {
    background: #f1f5f9;
    color: var(--mc-text-3);
    cursor: not-allowed;
}
.mc-field--area {
    resize: vertical;
    font-size: 12.5px;
    line-height: 1.4;
}

.mc-toggle {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
}
.mc-toggle input {
    display: none;
}
.mc-toggle span {
    position: absolute;
    inset: 0;
    background: #cbd5e1;
    border-radius: 999px;
    transition: background 0.15s;
    cursor: pointer;
}
.mc-toggle span::before {
    content: '';
    position: absolute;
    width: 16px;
    height: 16px;
    background: #fff;
    border-radius: 50%;
    left: 2px;
    top: 2px;
    transition: transform 0.15s;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
.mc-toggle input:checked + span {
    background: var(--mc-primary);
}
.mc-toggle input:checked + span::before {
    transform: translateX(16px);
}
.mc-toggle.disabled span {
    opacity: 0.45;
    cursor: not-allowed;
}

.mc-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid;
}
.mc-chip--muted {
    background: #f1f5f9;
    color: #475569;
    border-color: #cbd5e1;
}
.mc-chip--featured {
    background: var(--mc-primary-50);
    color: var(--mc-primary-700);
    border-color: #bfdbfe;
}
.mc-chip--live {
    background: #ecfdf5;
    color: #047857;
    border-color: #a7f3d0;
}
.mc-chip--live::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

.mc-expand-btn {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    color: var(--mc-text-3);
    transition:
        background 0.12s,
        color 0.12s,
        border-color 0.12s;
}
.mc-expand-btn:hover {
    background: #f1f5f9;
    color: var(--mc-primary);
    border-color: #e2e8f0;
}
.mc-chev {
    display: inline-flex;
    transition: transform 0.15s;
}
.mc-chev.open {
    transform: rotate(90deg);
}

.mc-admin-expand {
    grid-column: 1 / -1;
    background: linear-gradient(180deg, #fbfbfd 0%, #fff 100%);
    border-bottom: 1px solid #f1f5f9;
    padding: 18px 20px 22px;
}
.mc-expand-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
    gap: 24px;
}
.mc-expand-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.mc-expand-sec {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.mc-expand-label {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--mc-text-2);
    font-weight: 700;
}
.mc-expand-hint {
    font-size: 11px;
    color: var(--mc-text-3);
}
.mc-field-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
}
.mc-source-hint {
    font-size: 11px;
    color: var(--mc-text-3);
}
.mc-source-hint em {
    color: var(--mc-text-2);
    font-style: normal;
}
.mc-locked-value {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: 6px;
    font-size: 13px;
    color: var(--mc-text-1);
}
.mc-locked-hint {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--mc-text-3);
    background: rgba(148, 163, 184, 0.15);
    padding: 1px 6px;
    border-radius: 4px;
    margin-left: auto;
}
.mc-trial-row {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: 8px;
    padding: 8px 12px;
}
.mc-trial-label {
    font-size: 13px;
    color: var(--mc-text);
}
.mc-trial-days {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
}
.mc-trial-unit {
    font-size: 12px;
    color: var(--mc-text-2);
}

.mc-tf-head {
    display: flex;
    align-items: center;
}
.mc-tf-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.mc-tf-row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1.4fr) minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
}
.mc-tf-num {
    font: 600 11px var(--mc-font-mono);
    color: var(--mc-text-3);
    text-align: center;
}
.mc-tf-actions {
    display: flex;
    gap: 2px;
}
.mc-iconbtn {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    background: var(--mc-surface);
    border: 1px solid var(--mc-border);
    border-radius: 5px;
    cursor: pointer;
    font: 600 10px var(--mc-font-sans);
    color: var(--mc-text-2);
    padding: 0;
    transition:
        background 0.12s,
        border-color 0.12s;
}
.mc-iconbtn:hover:not(:disabled) {
    background: #f1f5f9;
    border-color: #cbd5e1;
}
.mc-iconbtn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}
.mc-iconbtn--danger {
    color: #b91c1c;
}
.mc-iconbtn--danger:hover:not(:disabled) {
    background: #fef2f2;
    border-color: #fca5a5;
}
.mc-tf-empty {
    padding: 14px;
    text-align: center;
    font-size: 12px;
    color: var(--mc-text-3);
    background: var(--mc-surface);
    border: 1px dashed #cbd5e1;
    border-radius: 8px;
}
.mc-tf-add {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
}
.mc-tf-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
}
.mc-tf-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--mc-surface);
    border: 1px dashed #cbd5e1;
    font-size: 11.5px;
    color: #475569;
    cursor: pointer;
    transition:
        background 0.12s,
        border-color 0.12s,
        color 0.12s;
}
.mc-tf-chip em {
    font-style: normal;
    color: var(--mc-text-3);
    font: 500 11px var(--mc-font-mono);
}
.mc-tf-chip:hover:not(:disabled) {
    background: var(--mc-primary-50);
    border-color: #93c5fd;
    border-style: solid;
    color: var(--mc-primary-700);
}
.mc-tf-chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

@media (max-width: 980px) {
    .mc-expand-grid {
        grid-template-columns: 1fr;
    }
}

/* Version tabs below the plan name — visible only when the plan
 * has multiple published versions (e.g. v2 active + v3 planned).
 * Sim pattern: small pills, active version inverted. */
.mc-version-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
}
.mc-version-tab {
    border: 1px solid #e2e8f0;
    background: #fff;
    border-radius: 6px;
    padding: 2px 8px;
    font: 600 10.5px var(--sa-font-mono, ui-monospace, monospace);
    color: #64748b;
    cursor: pointer;
    letter-spacing: 0.02em;
    transition:
        border-color 0.1s,
        background 0.1s,
        color 0.1s;
}
.mc-version-tab:hover {
    border-color: #cbd5e1;
    background: #f8fafc;
    color: #475569;
}
.mc-version-tab--active {
    border-color: #1d4ed8;
    background: #eff6ff;
    color: #1d4ed8;
}
</style>
