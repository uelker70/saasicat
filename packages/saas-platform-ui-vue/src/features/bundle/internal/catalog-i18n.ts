// catalog-i18n — pure resolvers that derive the labels/units to display for a
// chosen display locale from the catalog entries (feature/quota catalog incl.
// `i18n`). The single source of truth for translations remains the Discovery
// translation tab (`FeatureCatalogEntryRow.i18n` /
// `QuotaCatalogEntryRow.i18n`); here we only project.
//
// Resolution chain per entry: `i18n[locale]` → default-locale field (DE) →
// (in the editor) Discovery fallback or the bare key. By convention the
// default locale is NOT held in `i18n`, so for DE the base field applies
// directly.

import type {
    CatalogEntryI18n,
    FeatureCatalogEntryRow,
    QuotaCatalogEntryRow,
} from '@saasicat/types';

export const CATALOG_DEFAULT_LOCALE = 'de';

/** Display mapping per feature key (compatible with `FeatureMeta`). */
export interface FeatureRegistryEntry {
    label?: string;
    group?: string;
    core?: boolean;
}

/** Display mapping per quota key. */
export interface QuotaMeta {
    label?: string;
    unit?: string;
}

function localized(
    i18n: CatalogEntryI18n | undefined,
    locale: string,
    field: 'label' | 'unit',
): string | undefined {
    if (locale === CATALOG_DEFAULT_LOCALE) return undefined;
    const value = i18n?.[locale]?.[field];
    return value && value.trim().length > 0 ? value : undefined;
}

function resolveLabel(
    baseLabel: string | null | undefined,
    i18n: CatalogEntryI18n | undefined,
    locale: string,
): string | undefined {
    return localized(i18n, locale, 'label') ?? (baseLabel || undefined);
}

/**
 * Builds the `featureRegistry` for the bundle editors from the feature catalog
 * entries. Keys without a resolvable label are omitted — the editor then falls
 * back to the feature key.
 */
export function buildFeatureRegistry(
    featureCatalog: FeatureCatalogEntryRow[],
    locale: string,
): Record<string, FeatureRegistryEntry> {
    const registry: Record<string, FeatureRegistryEntry> = {};
    for (const feature of featureCatalog) {
        const label = resolveLabel(feature.label, feature.i18n, locale);
        if (label) registry[feature.featureKey] = { label, core: feature.core };
    }
    return registry;
}

/**
 * Builds the `quotaRegistry` for the bundle editors from the quota catalog
 * entries. Label and unit are resolved independently; if a translation is
 * missing, the editor falls back to the Discovery value or the quota key.
 */
export function buildQuotaRegistry(
    quotaCatalog: QuotaCatalogEntryRow[],
    locale: string,
): Record<string, QuotaMeta> {
    const registry: Record<string, QuotaMeta> = {};
    for (const quota of quotaCatalog) {
        registry[quota.quotaKey] = {
            label: resolveLabel(quota.label, quota.i18n, locale),
            unit: localized(quota.i18n, locale, 'unit') ?? (quota.unit || undefined),
        };
    }
    return registry;
}
