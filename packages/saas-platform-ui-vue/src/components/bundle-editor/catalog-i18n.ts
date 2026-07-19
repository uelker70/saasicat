// catalog-i18n — reine Resolver, die aus den Catalog-Entries (Feature-/Quota-
// Catalog inkl. `i18n`) die anzuzeigenden Labels/Units für eine gewählte
// Anzeige-Locale ableiten. Single-Source-of-Truth der Übersetzungen bleibt
// der Discovery-Übersetzungs-Tab (`FeatureCatalogEntryRow.i18n` /
// `QuotaCatalogEntryRow.i18n`); hier wird nur projiziert.
//
// Auflösungskette pro Eintrag: `i18n[locale]` → Default-Locale-Feld (DE) →
// (im Editor) Discovery-Fallback bzw. der nackte Key. Die Default-Locale wird
// per Konvention NICHT in `i18n` gehalten, deshalb greift für DE direkt das
// Basis-Feld.

import type {
    CatalogEntryI18n,
    FeatureCatalogEntryRow,
    QuotaCatalogEntryRow,
} from '@saasicat/types';

export const CATALOG_DEFAULT_LOCALE = 'de';

/** Anzeige-Mapping pro Feature-Key (kompatibel zu `FeatureMeta`). */
export interface FeatureRegistryEntry {
    label?: string;
    group?: string;
    core?: boolean;
}

/** Anzeige-Mapping pro Quota-Key. */
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
 * Baut das `featureRegistry` für die Bundle-Editoren aus den Feature-Catalog-
 * Entries. Keys ohne auflösbares Label werden ausgelassen — der Editor fällt
 * dann auf den Feature-Key zurück.
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
 * Baut das `quotaRegistry` für die Bundle-Editoren aus den Quota-Catalog-
 * Entries. Label und Unit werden unabhängig aufgelöst; fehlt eine Übersetzung,
 * fällt der Editor auf den Discovery-Wert bzw. den Quota-Key zurück.
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
