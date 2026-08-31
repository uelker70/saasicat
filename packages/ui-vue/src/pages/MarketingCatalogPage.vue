<!--
  MarketingCatalogPage — marketing catalog for SuperAdmin.

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

  Self-sufficient page (like PlansPage): the wrapper stays thin.
-->
<template>
    <AdminPage class="sa-marketing">
        <AdminHero :title="msg.header.title" :subtitle="msg.header.subtitle">
            <template #actions>
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
            </template>
        </AdminHero>

        <AdminBody>
            <AdminSection>
                <div
                    v-if="pageError"
                    class="sa-marketing-banner sa-marketing-banner--error"
                    role="alert"
                >
                    <strong>{{ common.error }}:</strong> {{ pageError }}
                    <q-btn
                        class="sa-marketing-banner-x"
                        flat
                        dense
                        size="sm"
                        icon="close"
                        @click="pageError = null"
                    />
                </div>

                <MarketingCatalogToolbar
                    v-model:tab="tab"
                    :active-promo-count="activePromoCount"
                    :catalog-version="catalogVersion"
                    :active-locale="activeLocale"
                />
            </AdminSection>
            <AdminSection>
                <div v-if="loading" class="sa-marketing-loading">{{ msg.page.loading }}</div>

                <!-- ─── Tab: Promotions ─── -->
                <MarketingPromotionsTab
                    v-else-if="tab === 'promos'"
                    :promotions="promotions"
                    :plans="promoPlanOptions"
                    :active-locales="activeLocaleSet"
                    :busy="busy"
                    :create="promotionsApi.create"
                    :update="promotionsApi.update"
                    :remove="promotionsApi.remove"
                />

                <div
                    v-else-if="rows.length === 0"
                    class="sa-marketing-banner sa-marketing-banner--info"
                >
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
                    @reorder="reorderRows"
                    @move-feature="moveFeature"
                    @remove-feature="removeFeature"
                    @add-feature="addFeature"
                    @add-suggestion="addSuggestion"
                />
            </AdminSection>
        </AdminBody>
    </AdminPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
    useSuperAdminEndpoints,
    useSuperAdminHttp,
    useSuperAdminManifest,
} from '../vue/use-super-admin-context.js';
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { marketingResource } from '../client/resources/marketing.resource.js';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminSection from '../ui/page/AdminSection.vue';
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
} from '@saasicat/core';
import { reorderedPriorities } from '../client/reorder-priorities.js';
import { usePlans } from '../vue/use-plans.js';
import { useMarketingProjections } from '../vue/use-marketing-projections.js';
import { usePromotions } from '../vue/use-promotions.js';
import { useCatalogEntries } from '../vue/use-catalog-entries.js';
import { adminErrorMessage } from '../client/admin-error.js';
import { formatCurrency } from '../client/i18n/currency.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import { formatMessage } from '../client/i18n/format.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';
import MarketingPromotionsTab from '../features/marketing/MarketingPromotionsTab.vue';
import MarketingCatalogAdmin from '../internal/marketing-catalog-page/MarketingCatalogAdmin.vue';
import MarketingCatalogHeader from '../internal/marketing-catalog-page/MarketingCatalogHeader.vue';
import MarketingCatalogPreview from '../internal/marketing-catalog-page/MarketingCatalogPreview.vue';
import MarketingCatalogToolbar from '../internal/marketing-catalog-page/MarketingCatalogToolbar.vue';
import type {
    FeatureSuggestion,
    MarketingCatalogTab,
    MarketingRow,
    ResolvedMarketing,
} from '../internal/marketing-catalog-page/types.js';

import { IDENTITY_NEUTRAL, identityAccentAt } from '../client/identity-accents.js';

const DEFAULT_ACCENT = IDENTITY_NEUTRAL;

const props = defineProps<{
    /**
     * Override the marketing resource for this page only — a different host, or
     * one operation wrapped. Layered over the app's own override; see AP3 §3.2.
     */
    resources?: ResourceOverride<(typeof marketingResource)['ops']>;
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
const errors = useSaMessages('errors');
const { locale, intlLocale } = useSuperAdminI18n();

/**
 * What to put in the page banner for a caught failure: what the failing side
 * said, or the catalog's sentence for what happened. Never `err.message` — for
 * this page's own composables that is an English diagnostic for the log.
 */
function bannerText(err: unknown): string {
    return adminErrorMessage(err, errors.value);
}

// The pool this project declares, unless the app narrows it. Read from the
// manifest the shell already holds, so a consumer does not have to pass back
// what the platform gave it.
const manifest = useSuperAdminManifest();
const availableLocales = computed<string[]>(() => {
    if (props.availableLocales && props.availableLocales.length > 0) return props.availableLocales;
    const pool = manifest?.project?.availableLocales;
    return pool && pool.length > 0 ? pool : ['de'];
});

const tab = ref<MarketingCatalogTab>('preview');
const expandedKey = ref<string | null>(null);
const activeLocale = ref<string>(availableLocales.value[0]);

// LocaleManager — `availableLocales` is the allowed pool (app config),
// `activeLocaleSet` the runtime-activated subset.
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
        const body = await marketing.settings();
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
        await marketing.saveSettings(activeLocaleSet.value);
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

// Transport and project from the shell, not from props. `SuperAdminEndpoints`
// says why in its own doc: the project is app-wide and constant, and a page
// that takes it as a prop lets a consumer hand this page a different one than
// its siblings read from. The http client is the shell's, so every request
// carries the app's auth without the page being told how.
const { apiBase } = useSuperAdminEndpoints();
const shellHttpClient = useSuperAdminHttp();

// The marketing resource, reached by name. Replaces two hand-built calls to
// `/catalog/marketing-settings` that spelled the project key into the query
// string themselves.
const marketing = useResource('marketing', props.resources);

const plansApi = usePlans({
    adminEndpoint: apiBase,
    http: shellHttpClient,
});

const projectionsApi = useMarketingProjections({
    adminEndpoint: apiBase,
    http: shellHttpClient,
    filter: { targetType: 'PLAN', locale: activeLocale.value },
});

const promotionsApi = usePromotions({
    adminEndpoint: apiBase,
    http: shellHttpClient,
});

// Catalog entries (features + quotas with i18n) — provides the translated
// labels for the top-features editor.
const catalogEntriesApi = useCatalogEntries({
    adminEndpoint: apiBase,
    http: shellHttpClient,
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

const httpClient: HttpClient = shellHttpClient ?? defaultHttpClient();

async function reloadVersions(): Promise<void> {
    const results = await Promise.all(
        plansApi.plans.value.map(async (p) => {
            const res = await httpClient(`${apiBase}/catalog/plans/${p.id}/versions`);
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
        pageError.value = bannerText(err);
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
 * Version active as of `asOf`: `validFrom <= asOf` and
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

// Decorative browser chrome above the preview. The application names itself
// in one place, so the mock domain is built from that rather than from a
// second identifier kept for the purpose.
const previewUrl = computed(() => `${slugOf(manifest?.project?.displayName ?? 'app')}.com/pricing`);

// Split-and-join rather than a trim regex: `/^-+|-+$/` is a quantifier that
// can match one input several ways, which is the shape that turns a long
// display name into quadratic work (`regexp/no-super-linear-move`).
function slugOf(name: string): string {
    const slug = name
        .toLowerCase()
        .split(/[^a-z0-9]/)
        .filter((part) => part !== '')
        .join('-');
    return slug || 'app';
}

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

// ─── Promo application in the preview ───
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
    return promoOf(row)?.color ?? identityAccentAt(0);
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
        pageError.value = bannerText(err);
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

/**
 * Turns "this row belongs here" into the priorities that say so.
 *
 * The positions are indices into the DRAGGABLE rows — those with a live
 * version — and not into `adminRows`, because a plan without one cannot hold a
 * marketing projection and `patch` returns early for it. The arithmetic assigns
 * a value to every position it is given, so a row nobody can write would take
 * one of those values with it and the stored order would not be the dragged
 * one. `MarketingCatalogAdmin` builds the same subset for the handles.
 *
 * Only the rows whose value actually changes are written, and they are written
 * one at a time because that is the shape of the endpoint: there is no bulk
 * reorder, and inventing one client-side would only hide that a failure in the
 * middle leaves the order half-applied. It does not, visibly — the list is
 * re-read from the projections either way, so what the operator sees after an
 * error is what was actually stored.
 */
async function reorderRows(from: number, to: number): Promise<void> {
    const rows = adminRows.value.filter((row) => row.liveVersion);
    const updates = reorderedPriorities(
        rows.map((row) => row.m.priority),
        from,
        to,
    );
    for (const [index, priority] of updates.entries()) {
        if (priority === null) continue;
        await patch(rows[index]!, { priority });
        if (pageError.value) return;
    }
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
            targetType: 'PLAN',
            locale: loc,
        });
    } catch (err) {
        pageError.value = bannerText(err);
    } finally {
        busy.value = false;
    }
}
</script>

<style>
.sa-marketing-head-actions {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
}

.sa-marketing-locale-mgr {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    flex-wrap: wrap;
}
.sa-marketing-locale-mgr-label {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}
.sa-marketing-locale-pill {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-control);
    overflow: hidden;
}
.sa-marketing-locale-pill.active {
    border-color: var(--sa-color-accent-strong);
    background: var(--sa-color-accent-surface-strong);
}
.sa-marketing-locale-pill-btn {
    border: 0;
    background: transparent;
    padding: var(--sa-space-2) var(--sa-space-3);
    font: 600 var(--sa-text-xs) var(--sa-font-mono);
    color: var(--sa-color-fg-secondary);
    cursor: pointer;
}
.sa-marketing-locale-pill.active .sa-marketing-locale-pill-btn {
    color: var(--sa-color-accent-strong);
}
.sa-marketing-locale-x {
    border: 0;
    background: transparent;
    padding: var(--sa-space-2) var(--sa-space-3);
    color: var(--sa-color-fg-subtle);
    cursor: pointer;
    font-size: var(--sa-text-md);
}
.sa-marketing-locale-x:hover {
    color: var(--sa-color-negative);
}
.sa-marketing-locale-add-wrap {
    position: relative;
}
.sa-marketing-locale-add {
    border: 1px dashed var(--sa-color-border);
    background: transparent;
    border-radius: var(--sa-radius-control);
    padding: var(--sa-space-2) var(--sa-space-3);
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-secondary);
    cursor: pointer;
}
.sa-marketing-locale-add:disabled {
    opacity: 0.4;
    cursor: default;
}
.sa-marketing-locale-picker {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: var(--sa-space-2);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    box-shadow: 0 8px 24px var(--sa-shadow-tint-3);
    padding: var(--sa-space-2);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-1);
    z-index: 20;
    min-width: 80px;
}
.sa-marketing-locale-picker-row {
    border: 0;
    background: transparent;
    padding: var(--sa-space-2) var(--sa-space-3);
    text-align: left;
    border-radius: var(--sa-radius-badge);
    font: 600 var(--sa-text-xs) var(--sa-font-mono);
    cursor: pointer;
}
.sa-marketing-locale-picker-row:hover {
    background: var(--sa-color-accent-surface-strong);
}

.sa-marketing-banner {
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-3) var(--sa-space-4);
    font-size: var(--sa-text-md);
    margin-bottom: var(--sa-space-4);
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
}
.sa-marketing-banner--error {
    background: var(--sa-color-negative-surface);
    color: var(--sa-color-negative-fg);
    border: 1px solid var(--sa-color-negative-border);
}
.sa-marketing-banner--info {
    background: var(--sa-color-accent-surface-strong);
    color: var(--sa-color-info-fg);
    border: 1px solid var(--sa-color-info-border);
}
.sa-marketing-banner-x {
    margin-left: auto;
    background: transparent;
    border: 0;
    cursor: pointer;
    font-size: var(--sa-text-xl);
    line-height: 1;
    color: inherit;
}
.sa-marketing-loading {
    padding: var(--sa-space-9);
    text-align: center;
    color: var(--sa-color-fg-subtle);
    font-size: var(--sa-text-md);
}

.sa-marketing-toolbar {
    display: flex;
    /* The tab bar and the meta line do not fit side by side below ~672px, and
     * without this they simply pushed the page off its own right edge — at every
     * viewport narrower than that, not just the smallest. Nothing measured it
     * until the overflow guard started asking at each breakpoint band. */
    flex-wrap: wrap;
    gap: var(--sa-space-4);
    align-items: center;
    margin: var(--sa-space-0);
}
.sa-marketing-tabbar {
    display: inline-flex;
    /* Scrolls rather than wraps: a row of tabs broken across two lines reads as
     * two groups. It fits every band except the narrowest phone, where the four
     * tabs need 389px. */
    overflow-x: auto;
    max-width: 100%;
    gap: var(--sa-space-1);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-1);
}
.sa-marketing-tab {
    padding: var(--sa-space-2) var(--sa-space-4);
    border-radius: var(--sa-radius-badge);
    font: 500 var(--sa-text-md) var(--sa-font-body);
    color: var(--sa-color-fg-secondary);
    background: transparent;
    border: 0;
    cursor: pointer;
    transition:
        background 0.12s,
        color 0.12s;
}
.sa-marketing-tab:hover {
    color: var(--sa-color-fg-heading);
}
.sa-marketing-tab.active {
    background: var(--sa-color-accent-surface-strong);
    color: var(--sa-color-accent-strong);
    font-weight: 600;
}
.sa-marketing-tab-count {
    display: inline-block;
    margin-left: var(--sa-space-2);
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    padding: var(--sa-space-0) var(--sa-space-2);
    border-radius: var(--sa-radius-pill);
}
.sa-marketing-meta {
    margin-left: auto;
    /* Its own contents wrap too: `catalogVersion <code> · locale <code>` is
     * wider than a phone on its own, so wrapping only the toolbar would move
     * the overflow one level down instead of removing it. */
    flex-wrap: wrap;
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
}
.sa-marketing-meta code {
    font: 500 var(--sa-text-xs) var(--sa-font-mono);
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-badge);
}

/* ── Public catalog preview ── */
.sa-marketing-window {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-card);
    overflow: hidden;
}
.sa-marketing-chrome {
    height: 36px;
    background: var(--sa-color-border-soft);
    border-bottom: 1px solid var(--sa-color-border);
    display: flex;
    align-items: center;
    padding: 0 var(--sa-space-4);
    gap: var(--sa-space-2);
}
.sa-marketing-chrome-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
}
.sa-marketing-chrome-url {
    margin-left: var(--sa-space-5);
    flex: 1;
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-badge);
    padding: var(--sa-space-2) var(--sa-space-3);
    font: 500 var(--sa-text-sm) var(--sa-font-mono);
    color: var(--sa-color-fg-secondary);
    max-width: 380px;
}
.sa-marketing-canvas {
    background: linear-gradient(
        180deg,
        var(--sa-color-bg-surface-raised) 0%,
        var(--sa-color-bg-surface) 100%
    );
    padding: var(--sa-space-8) var(--sa-space-8) var(--sa-space-7);
}
.sa-marketing-eyebrow {
    font: 700 var(--sa-text-xs) var(--sa-font-body);
    letter-spacing: var(--sa-tracking-wider);
    text-transform: uppercase;
    color: var(--sa-color-accent);
    text-align: center;
}
.sa-marketing-hero {
    font-size: var(--sa-text-4xl);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-tight);
    color: var(--sa-color-fg-heading);
    text-align: center;
    margin: var(--sa-space-3) 0 var(--sa-space-2);
}
.sa-marketing-sub {
    font-size: var(--sa-text-lg);
    color: var(--sa-color-fg-secondary);
    text-align: center;
    max-width: 540px;
    margin: 0 auto var(--sa-space-7);
}
.sa-marketing-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--sa-space-5);
}
.sa-marketing-card {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-card);
    padding: var(--sa-space-6) var(--sa-space-6) var(--sa-space-6);
    display: flex;
    flex-direction: column;
    position: relative;
    transition:
        transform 0.15s,
        box-shadow 0.15s,
        border-color 0.15s;
}
.sa-marketing-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px var(--sa-shadow-tint-1);
}
.sa-marketing-card.featured {
    border-color: var(--sa-color-info-border);
    box-shadow: 0 10px 32px var(--sa-shadow-tint-2);
}
.sa-marketing-card-badge {
    position: absolute;
    top: calc(-1 * var(--sa-space-3));
    left: 50%;
    transform: translateX(-50%);
    background: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
    font: 700 var(--sa-text-xs) var(--sa-font-body);
    letter-spacing: var(--sa-tracking-wider);
    text-transform: uppercase;
    padding: var(--sa-space-2) var(--sa-space-4);
    border-radius: var(--sa-radius-pill);
    white-space: nowrap;
}
.sa-marketing-card-key {
    font: 700 var(--sa-text-xs) var(--sa-font-mono);
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-subtle);
    text-transform: uppercase;
}
.sa-marketing-card-name {
    font-size: var(--sa-text-2xl);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-tight);
    color: var(--sa-color-fg-heading);
    margin: var(--sa-space-1) 0 var(--sa-space-2);
}
.sa-marketing-card-desc {
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
    line-height: 1.4;
    min-height: 36px;
}
.sa-marketing-card-price {
    margin: var(--sa-space-5) 0 var(--sa-space-2);
    display: flex;
    align-items: baseline;
    gap: var(--sa-space-2);
}
.sa-marketing-card-price-big {
    font-size: var(--sa-text-4xl);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-tight);
    color: var(--sa-color-fg-heading);
}
.sa-marketing-card-price-unit {
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-subtle);
}
.sa-marketing-card-price-y {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-subtle);
    margin-bottom: var(--sa-space-4);
}
.sa-marketing-card-cta {
    width: 100%;
    margin-top: var(--sa-space-4);
    padding: var(--sa-space-3) var(--sa-space-4);
    border-radius: var(--sa-radius-field);
    border: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-fg-heading);
    font: 600 var(--sa-text-md) var(--sa-font-body);
    cursor: pointer;
    transition:
        background 0.12s,
        border-color 0.12s;
}
.sa-marketing-card-cta:hover {
    background: var(--sa-color-bg-sunken);
}
.sa-marketing-card.featured .sa-marketing-card-cta {
    background: var(--sa-color-accent);
    border-color: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
}
.sa-marketing-card.featured .sa-marketing-card-cta:hover {
    background: var(--sa-color-accent-strong);
}
.sa-marketing-card-trialnote {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    text-align: center;
    margin-top: var(--sa-space-2);
}
.sa-marketing-card.has-promo {
    border-color: var(--sa-color-positive-strong);
}
.sa-marketing-promo-ribbon {
    position: absolute;
    top: var(--sa-space-4);
    right: calc(-1 * var(--sa-space-1));
    color: var(--sa-color-fg-on-accent);
    font-size: var(--sa-text-xs);
    font-weight: 700;
    padding: var(--sa-space-1) var(--sa-space-4) var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-badge) 0 0 var(--sa-radius-badge);
}
.sa-marketing-card-price-strike {
    display: flex;
    gap: var(--sa-space-3);
    align-items: baseline;
    margin-top: var(--sa-space-1);
}
.sa-marketing-card-price-strike s {
    color: var(--sa-color-fg-subtle);
    font-size: var(--sa-text-lg);
}
.sa-marketing-price-regular {
    font-size: var(--sa-text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wide);
    color: var(--sa-color-fg-subtle);
}
.sa-marketing-card-fineprint {
    font-size: var(--sa-text-2xs);
    color: var(--sa-color-positive);
    text-align: center;
    margin-top: var(--sa-space-2);
}
.sa-marketing-card-includes {
    margin-top: var(--sa-space-5);
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-subtle);
    font-weight: 700;
}
.sa-marketing-card-features {
    list-style: none;
    padding: 0;
    margin: var(--sa-space-3) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-body);
}
.sa-marketing-card-features li {
    display: flex;
    align-items: flex-start;
    gap: var(--sa-space-3);
    line-height: 1.35;
}
.sa-marketing-card-features .sa-marketing-tick {
    color: var(--sa-color-positive-strong);
    flex: 0 0 14px;
    margin-top: var(--sa-space-0);
}
.sa-marketing-card-features b {
    color: var(--sa-color-fg-heading);
    font-weight: 700;
}
.sa-marketing-card-features-empty {
    margin-top: var(--sa-space-3);
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-subtle);
}

/* ── Marketing administration ── */
.sa-marketing-admin {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-tile);
}
.sa-marketing-admin-head {
    padding: var(--sa-space-4) var(--sa-space-5);
    border-bottom: 1px solid var(--sa-color-border-soft);
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
}
.sa-marketing-admin-title {
    font-size: var(--sa-text-lg);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-normal);
    color: var(--sa-color-fg-heading);
}
.sa-marketing-admin-sub {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
}
.sa-marketing-admin-grid {
    display: grid;
    grid-template-columns: 40px 1.6fr 1fr 1.4fr 1fr;
    align-items: stretch;
}
.sa-marketing-admin-thead {
    display: contents;
}
.sa-marketing-admin-thead > div {
    background: var(--sa-color-bg-surface-raised);
    padding: var(--sa-space-3) var(--sa-space-4);
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-secondary);
    font-weight: 700;
    border-bottom: 1px solid var(--sa-color-border);
}
.sa-marketing-admin-row {
    display: contents;
}
/* The row opens the editor, so it feeds back like something that does — but it
 * is `display: contents` and has no box to paint, so the feedback goes on its
 * cells. `:hover` still matches here: the element stays in the tree for hit
 * testing even without a box of its own. */
.sa-marketing-admin-row:not(.sa-marketing-admin-row--disabled) > div {
    cursor: pointer;
}
.sa-marketing-admin-row:not(.sa-marketing-admin-row--disabled):hover > div,
.sa-marketing-admin-row--open > div {
    background: var(--sa-color-bg-sunken);
}

/* The drag: the row being moved recedes, and the line marks where releasing
 * would put it. Both are drawn on the cells for the same reason the hover is —
 * a `display: contents` row has no box to draw on. `box-shadow` rather than a
 * border, so the line does not add a pixel to the row's height and shift the
 * rest of the list under the pointer. */
.sa-marketing-admin-row--dragging > div {
    opacity: 0.5;
}
.sa-marketing-admin-row--drop-above > div {
    box-shadow: inset 0 2px 0 0 var(--sa-color-accent);
}
.sa-marketing-admin-row--drop-below > div {
    box-shadow: inset 0 -2px 0 0 var(--sa-color-accent);
}

.sa-marketing-grip-cell {
    padding-right: 0 !important;
    justify-content: center;
}
.sa-marketing-grip {
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    padding: var(--sa-space-1);
    border-radius: var(--sa-radius-field);
    color: var(--sa-color-fg-subtle);
    cursor: grab;
    /* Without this the browser scrolls the page instead of letting the handle
     * have the gesture — on a touch device the drag would never start. */
    touch-action: none;
}
.sa-marketing-grip:hover:not(:disabled) {
    color: var(--sa-color-fg-body);
    background: var(--sa-color-border-soft);
}
.sa-marketing-grip:disabled {
    cursor: default;
    opacity: 0.4;
}
.sa-marketing-grip--dragging {
    cursor: grabbing;
    color: var(--sa-color-accent);
}
.sa-marketing-admin-row > div {
    padding: var(--sa-space-4) var(--sa-space-4);
    border-bottom: 1px solid var(--sa-color-border-soft);
    display: flex;
    align-items: center;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
}
.sa-marketing-admin-row--disabled > div {
    background: var(--sa-color-bg-surface-raised);
}
/* The identity block is the row's keyboard path into the editor. It is a
 * `<button>`, and it must not look like one: the row already reports that it is
 * clickable, and a framed control in the first cell would read as an action
 * rather than as the row's name. What it keeps is the focus ring — the one
 * piece of button chrome a keyboard user cannot do without. */
.sa-marketing-plan-cell {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
    width: 100%;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    padding: var(--sa-space-2);
    margin: calc(-1 * var(--sa-space-2));
    border-radius: var(--sa-radius-field);
}

.sa-marketing-plan-cell--static {
    cursor: default;
}

.sa-marketing-plan-mark {
    width: 32px;
    height: 32px;
    border-radius: var(--sa-radius-field);
    display: grid;
    place-items: center;
    font: 700 var(--sa-text-2xs) var(--sa-font-mono);
    border: 1px solid;
}
/* Key, name and status on one line, as in the bundle list: the status belongs
 * to the plan, and a column of its own put it five cells away from the name it
 * describes. */
.sa-marketing-plan-titlerow {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    flex-wrap: wrap;
}
.sa-marketing-plan-label {
    font-size: var(--sa-text-md);
    font-weight: 700;
    color: var(--sa-color-fg-heading);
}
.sa-marketing-plan-key {
    font: 500 var(--sa-text-xs) var(--sa-font-mono);
    color: var(--sa-color-fg-subtle);
}

.sa-marketing-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
    font-size: var(--sa-text-xs);
    font-weight: 600;
    border: 1px solid;
}
.sa-marketing-chip--muted {
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
    border-color: var(--sa-color-border-strong);
}
.sa-marketing-chip--featured {
    background: var(--sa-color-accent-surface-strong);
    color: var(--sa-color-accent-strong);
    border-color: var(--sa-color-info-border);
}
.sa-marketing-chip--live {
    background: var(--sa-color-positive-surface);
    color: var(--sa-color-positive-fg);
    border-color: var(--sa-color-positive-border);
}
.sa-marketing-chip--live::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

/* The open editor is a WELL under its row, not another row.
 *
 * It used to end on a gradient whose last stop was `--sa-color-bg-surface` —
 * exactly the colour of the next row — closed by the same soft hairline that
 * separates any two rows. Nothing then said where the editor stopped, so the
 * following plan read as part of the plan being edited.
 *
 * Three things say it now, and each carries a different half of the message:
 * the surface is recessed (`bg-sunken`, which is what a well is for), an accent
 * edge on the left ties the panel to the row it belongs to, and a real border
 * closes it at the bottom instead of a hairline that means "next row". */
.sa-marketing-admin-expand {
    grid-column: 1 / -1;
    background: var(--sa-color-bg-sunken);
    border-left: 2px solid var(--sa-color-accent);
    border-bottom: 2px solid var(--sa-color-border-strong);
    padding: var(--sa-space-5) var(--sa-space-6) var(--sa-space-6);
}
.sa-marketing-expand-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
    gap: var(--sa-space-7);
}
.sa-marketing-expand-col {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-4);
}
.sa-marketing-expand-sec {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}
.sa-marketing-expand-label {
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-secondary);
    font-weight: 700;
}
.sa-marketing-expand-hint {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}
/* Widths, not looks: the look is the theme's `field.css`. */
.sa-marketing-field--badge {
    max-width: 120px;
}

/* The trial-days field: a number that is two digits wide, in a row of prose. */
.sa-marketing-field--number {
    max-width: 96px;
}

.sa-marketing-field-head {
    display: flex;
    align-items: baseline;
    gap: var(--sa-space-3);
    flex-wrap: wrap;
}
.sa-marketing-source-hint {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}
.sa-marketing-source-hint em {
    color: var(--sa-color-fg-secondary);
    font-style: normal;
}
.sa-marketing-locked-value {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-3);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-badge);
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
}
.sa-marketing-locked-hint {
    font-size: var(--sa-text-2xs);
    text-transform: uppercase;
    color: var(--sa-color-fg-subtle);
    background: var(--sa-color-bg-sunken);
    padding: var(--sa-space-0) var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
    margin-left: auto;
}
.sa-marketing-trial-row {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-3) var(--sa-space-4);
}
.sa-marketing-trial-label {
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
}
.sa-marketing-trial-days {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
}
.sa-marketing-trial-unit {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
}

.sa-marketing-tf-head {
    display: flex;
    align-items: center;
}
.sa-marketing-tf-list {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}
.sa-marketing-tf-row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1.4fr) minmax(0, 1fr) auto;
    gap: var(--sa-space-3);
    align-items: center;
}
.sa-marketing-tf-num {
    font: 600 var(--sa-text-xs) var(--sa-font-mono);
    color: var(--sa-color-fg-subtle);
    text-align: center;
}
.sa-marketing-tf-actions {
    display: flex;
    gap: var(--sa-space-1);
}
.sa-marketing-iconbtn {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-badge);
    cursor: pointer;
    font: 600 var(--sa-text-2xs) var(--sa-font-body);
    color: var(--sa-color-fg-secondary);
    padding: 0;
    transition:
        background 0.12s,
        border-color 0.12s;
}
.sa-marketing-iconbtn:hover:not(:disabled) {
    background: var(--sa-color-border-soft);
    border-color: var(--sa-color-border-strong);
}
.sa-marketing-iconbtn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
}
.sa-marketing-tf-empty {
    padding: var(--sa-space-4);
    text-align: center;
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-subtle);
    background: var(--sa-color-bg-surface);
    border: 1px dashed var(--sa-color-border-strong);
    border-radius: var(--sa-radius-field);
}
.sa-marketing-tf-add {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
    margin-top: var(--sa-space-2);
}
.sa-marketing-tf-suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sa-space-2);
    align-items: center;
}
.sa-marketing-tf-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
    background: var(--sa-color-bg-surface);
    border: 1px dashed var(--sa-color-border-strong);
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
    cursor: pointer;
    transition:
        background 0.12s,
        border-color 0.12s,
        color 0.12s;
}
.sa-marketing-tf-chip em {
    /* No colour of its own — the mono face and the smaller step already set it
     * apart from the chip's label, and a colour here does not follow the chip.
     * `--sa-color-fg-subtle` stayed put when :hover moved the chip's surface to
     * a 22 % accent tint, which measured 2.92:1 in the dark theme: a foreground
     * declared without the background it will end up on is a pair nothing can
     * check, and this one was wrong in exactly the state nobody screenshots. */
    font-style: normal;
    font: 500 var(--sa-text-xs) var(--sa-font-mono);
}
.sa-marketing-tf-chip:hover:not(:disabled) {
    background: var(--sa-color-accent-surface-strong);
    border-color: var(--sa-color-info-border);
    border-style: solid;
    color: var(--sa-color-accent-strong);
}
.sa-marketing-tf-chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

@media (max-width: 1023.98px) {
    .sa-marketing-expand-grid {
        grid-template-columns: 1fr;
    }
}

/* Version tabs below the plan name — visible only when the plan
 * has multiple published versions (e.g. v2 active + v3 planned).
 * Sim pattern: small pills, active version inverted. */
.sa-marketing-version-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sa-space-2);
    margin-top: var(--sa-space-2);
}
.sa-marketing-version-tab {
    border: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-surface);
    border-radius: var(--sa-radius-badge);
    padding: var(--sa-space-1) var(--sa-space-3);
    font: 600 var(--sa-text-xs) var(--sa-font-mono, ui-monospace, monospace);
    color: var(--sa-color-fg-muted);
    cursor: pointer;
    letter-spacing: var(--sa-tracking-wide);
    transition:
        border-color 0.1s,
        background 0.1s,
        color 0.1s;
}
.sa-marketing-version-tab:hover {
    border-color: var(--sa-color-border-strong);
    background: var(--sa-color-bg-sunken);
    color: var(--sa-color-fg-secondary);
}
.sa-marketing-version-tab--active {
    border-color: var(--sa-color-accent-strong);
    background: var(--sa-color-accent-surface-strong);
    color: var(--sa-color-accent-strong);
}
</style>
