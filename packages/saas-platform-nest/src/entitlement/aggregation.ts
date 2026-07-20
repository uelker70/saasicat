// Entitlement-Aggregation — Pure Functions über PlanVersion + Bundles + Catalog.
//
// Konsumenten ziehen ihre Subscription/PlanVersion/Bundle-Daten aus der DB,
// mappen sie auf die Snapshot-Form (siehe `types.ts`) und rufen
// `aggregateLimits()` für die effektiven Limits.

import type {
    ContractLineItemRecord,
    FeatureKey,
    PlanCatalog,
    QuotaKey,
} from '@saasicat/types';
import { isFeaturePlannedOnly } from '../billing/plan-helpers.js';
import type {
    BusinessTypeVersionSnapshot,
    CustomLimitsShape,
    EffectiveLimits,
    EffectiveLimitsSnapshot,
    SubscriptionBundleSnapshot,
    SubscriptionLimitsInput,
} from './types.js';

/**
 * Aggregiert die Quotas einer BusinessTypeVersion: Σ(Bundle-Quotas) pro
 * QuotaKey, dann Override durch `quotaOverrides[k]` falls gesetzt.
 *
 * `-1` (unbegrenzt) wird wie folgt behandelt:
 * - In Σ-Summation: -1 dominiert (wenn ein Bundle -1 für einen Key hat,
 *   ist die Σ ebenfalls -1 für diesen Key — unabhängig der anderen Werte).
 * - In Overrides: wenn der Override -1 ist, ersetzt er die Summe komplett.
 *
 * Spec: GESCHAEFTSTYP_SPEC §6.2.
 */
export function aggregateBusinessTypeQuotas(
    snapshot: BusinessTypeVersionSnapshot,
): Record<QuotaKey, number> {
    const sums: Record<QuotaKey, number> = {};
    for (const bundle of snapshot.bundles) {
        for (const [key, value] of Object.entries(bundle.quotas)) {
            if (sums[key] === -1 || value === -1) {
                sums[key] = -1;
            } else {
                sums[key] = (sums[key] ?? 0) + value;
            }
        }
    }
    // Overrides anwenden — Key gesetzt = ersetzt Σ.
    for (const [key, value] of Object.entries(snapshot.quotaOverrides)) {
        if (value !== undefined) {
            sums[key] = value;
        }
    }
    return sums;
}

/**
 * Filtert SubscriptionBundle-Buchungen auf solche, die zum gegebenen
 * Zeitpunkt aktiv sind. Aktiv = `canceledEffectiveAt === null` oder
 * `canceledEffectiveAt > now`.
 *
 * Spec: SPEC_V2 §11.1 M6 Pack 2e + P11.7.3.
 */
export function filterActiveSubscriptionBundles(
    bundles: readonly SubscriptionBundleSnapshot[],
    now: Date,
): SubscriptionBundleSnapshot[] {
    return bundles.filter((b) => b.canceledEffectiveAt === null || b.canceledEffectiveAt > now);
}

/**
 * Aggregiert die Quotas aller aktiven SubscriptionBundle-Buchungen:
 * Σ pro QuotaKey, `-1` (unbegrenzt) dominiert. Bundle-Features +
 * Bundle-Quotas sind **additiv** zur PlanVersion (nicht ersetzend).
 */
export function aggregateSubscriptionBundleQuotas(
    bundles: readonly SubscriptionBundleSnapshot[],
): Record<QuotaKey, number> {
    const sums: Record<QuotaKey, number> = {};
    for (const bundle of bundles) {
        for (const [key, value] of Object.entries(bundle.quotas)) {
            if (sums[key] === -1 || value === -1) {
                sums[key] = -1;
            } else {
                sums[key] = (sums[key] ?? 0) + value;
            }
        }
    }
    return sums;
}

/**
 * Sammelt alle Feature-Keys aus aktiven SubscriptionBundle-Buchungen
 * (Set-Union; doppelte Features werden einmal aufgenommen).
 */
export function collectSubscriptionBundleFeatures(
    bundles: readonly SubscriptionBundleSnapshot[],
): FeatureKey[] {
    const set = new Set<FeatureKey>();
    for (const bundle of bundles) {
        for (const f of bundle.features) set.add(f);
    }
    return Array.from(set);
}

/**
 * V3-Aggregation direkt aus eingefrorenen ContractLineItems. Diese Funktion
 * benutzt keine Katalog-Lookups: `featuresSnapshot` und
 * `quotaEffectsSnapshot` sind die vertragliche Wahrheit.
 */
export function aggregateContractLineItemEntitlements(
    lineItems: readonly Pick<
        ContractLineItemRecord,
        'kind' | 'sourceKey' | 'featuresSnapshot' | 'quotaEffectsSnapshot'
    >[],
    fallbackPlan = 'UNKNOWN',
): EffectiveLimits {
    const planItem = lineItems.find((item) => item.kind === 'plan');
    const plan = planItem?.sourceKey ?? fallbackPlan;
    const quotas: Record<QuotaKey, number> = {};
    const features = new Set<FeatureKey>();

    for (const item of lineItems) {
        for (const feature of item.featuresSnapshot) {
            features.add(feature);
        }
        for (const [key, value] of Object.entries(item.quotaEffectsSnapshot)) {
            if (quotas[key] === -1 || value === -1) {
                quotas[key] = -1;
            } else {
                quotas[key] = (quotas[key] ?? 0) + value;
            }
        }
    }

    return { plan, quotas, features };
}

/**
 * Sammelt alle Feature-Keys aus allen Bundles einer BusinessTypeVersion
 * (Set-Union; doppelte Features werden einmal aufgenommen).
 *
 * Spec: GESCHAEFTSTYP_SPEC §6.3.
 */
export function collectBusinessTypeFeatures(snapshot: BusinessTypeVersionSnapshot): FeatureKey[] {
    const set = new Set<FeatureKey>();
    for (const bundle of snapshot.bundles) {
        for (const f of bundle.features) {
            set.add(f);
        }
    }
    return Array.from(set);
}

/**
 * Filtert `plannedOnly`-Features konsequent aus — egal ob sie aus dem Plan,
 * einem Bundle oder customLimits stammen. `plannedOnly` heißt: Feature ist im
 * Catalog deklariert, aber noch nicht produktiv ausgerollt.
 */
export function filterPlannedOnlyFeatures(
    features: ReadonlySet<FeatureKey>,
    catalog: PlanCatalog,
): Set<FeatureKey> {
    const out = new Set<FeatureKey>();
    for (const f of features) {
        if (!isFeaturePlannedOnly(catalog, f)) {
            out.add(f);
        }
    }
    return out;
}

/**
 * Wendet `customLimits` (ENTERPRISE-Sondervertrag, Pilot) feldweise auf die
 * Plan-Default-Limits an. `quotas[k]` überschreibt; `features[]` ergänzt.
 * Nicht gesetzte Felder im Override fallen auf den Default zurück.
 */
export function applyCustomLimits(
    base: EffectiveLimits,
    custom: CustomLimitsShape | null | undefined,
): EffectiveLimits {
    if (!custom) return base;
    const quotas = { ...base.quotas };
    if (custom.quotas) {
        for (const [k, v] of Object.entries(custom.quotas)) {
            quotas[k] = v;
        }
    }
    const features = new Set(base.features);
    if (custom.features) {
        for (const f of custom.features) features.add(f);
    }
    return { plan: base.plan, quotas, features };
}

/**
 * Hauptaggregator — ergibt die effektiven Limits aus PlanVersion + optionaler
 * BusinessTypeVersion + aktiven Bundle-Buchungen + Catalog + optionalem
 * CustomLimits-Override.
 *
 * Reihenfolge (SPEC_V2 §11.1 M5 + GESCHAEFTSTYP_SPEC §6):
 *   1. Aktive Bundle-Buchungen filtern (canceledEffectiveAt).
 *   2. Plan-Quotas + (BusinessType-Quotas mit Override-Logik) + Bundle-Quotas
 *      pro `quotaKey` summieren. -1 (unbegrenzt) dominiert.
 *   3. Plan-Features ∪ BusinessType-Features ∪ Bundle-Features sammeln
 *      (Set-Union, deduplikziert).
 *   4. CustomLimits anwenden (Quotas überschreiben, Features ergänzen).
 *   5. plannedOnly-Features konsequent ausblenden.
 */
export function aggregateLimits(
    input: SubscriptionLimitsInput,
    catalog: PlanCatalog,
    now: Date,
): EffectiveLimits {
    const businessTypeQuotas = input.businessTypeVersion
        ? aggregateBusinessTypeQuotas(input.businessTypeVersion)
        : {};
    const businessTypeFeatures = input.businessTypeVersion
        ? collectBusinessTypeFeatures(input.businessTypeVersion)
        : [];

    const activeBundles = filterActiveSubscriptionBundles(input.subscriptionBundles ?? [], now);
    const subBundleQuotas = aggregateSubscriptionBundleQuotas(activeBundles);
    const subBundleFeatures = collectSubscriptionBundleFeatures(activeBundles);

    const quotas: Record<QuotaKey, number> = {};
    // Plan-Defaults als Basis.
    for (const [k, v] of Object.entries(input.planVersion.quotas)) {
        quotas[k] = v;
    }
    // BusinessType-Anteil dazu (mit -1-Dominanz).
    for (const [k, v] of Object.entries(businessTypeQuotas)) {
        if (quotas[k] === -1 || v === -1) {
            quotas[k] = -1;
        } else {
            quotas[k] = (quotas[k] ?? 0) + v;
        }
    }
    // SubscriptionBundle-Quotas dazu (mit -1-Dominanz). Eigenständig
    // gebuchte Bundles addieren ihre Quotas zu Plan + BusinessType.
    for (const [k, v] of Object.entries(subBundleQuotas)) {
        if (quotas[k] === -1 || v === -1) {
            quotas[k] = -1;
        } else {
            quotas[k] = (quotas[k] ?? 0) + v;
        }
    }

    const features = new Set<FeatureKey>([
        ...input.planVersion.features,
        ...businessTypeFeatures,
        ...subBundleFeatures,
    ]);

    const withCustom = applyCustomLimits(
        { plan: input.plan, quotas, features },
        input.customLimits,
    );
    const filteredFeatures = filterPlannedOnlyFeatures(withCustom.features, catalog);

    return { plan: withCustom.plan, quotas: withCustom.quotas, features: filteredFeatures };
}

/**
 * Prüft, ob ein Feature in den effektiven Limits enthalten ist.
 */
export function hasFeature(limits: EffectiveLimits, feature: FeatureKey): boolean {
    return limits.features.has(feature);
}

/**
 * Prüft, ob mindestens eines der gegebenen Features in den effektiven Limits
 * enthalten ist. Empty-Liste ergibt `false`.
 */
export function hasAnyFeature(limits: EffectiveLimits, features: readonly FeatureKey[]): boolean {
    return features.some((f) => limits.features.has(f));
}

/**
 * Wandelt EffectiveLimits in eine JSON-serialisierbare Form (Set → sortiertes
 * Array). Verwendung z. B. in `Invoice.entitlementSnapshot`.
 */
export function toEffectiveLimitsSnapshot(limits: EffectiveLimits): EffectiveLimitsSnapshot {
    return {
        plan: limits.plan,
        quotas: { ...limits.quotas },
        features: Array.from(limits.features).sort(),
    };
}
