// buildPlanCatalogFromSnapshot — Pure-Function (DI-frei), die einen
// `PlanCatalog`-Snapshot aus DB-Reads zusammenbaut (SPEC_V2 §11.1 M6 Pack 2c).
//
// Eingaben:
//  - App-globale Settings (projectKey, currency, vatRate) —
//    Build-Time-Identity, kommen vom AppModule statisch.
//  - DB-Snapshot mit Plans + live PlanVersions + FeatureCatalogEntries.
//
// Ausgabe: `PlanCatalog` (gleiches Wire-Format wie der YAML-Loader).
//
// Mapping:
//  - PlanDef ← Plan + matching live PlanVersion (via planKey === planId)
//  - FeatureDef ← FeatureCatalogEntry

import type {
    FeatureDef,
    FeatureKey,
    PlanCatalog,
    PlanCatalogReadSnapshot,
    PlanDef,
    QuotaKey,
} from '@saasicat/types';

export interface PlanCatalogBuildSettings {
    projectKey: string;
    /** App-Identity (Branding + Version) aus `config/saas.yaml#app`. Optional. */
    app?: PlanCatalog['app'];
    currency: string;
    vatRate: number;
    /** App-weite Marketing-Konfiguration (SPEC_V2 §6.5). Optional. */
    marketing?: PlanCatalog['marketing'];
}

export function buildPlanCatalogFromSnapshot(
    settings: PlanCatalogBuildSettings,
    snapshot: PlanCatalogReadSnapshot,
): PlanCatalog {
    // Index live PlanVersions by planKey für O(1)-Lookup
    const liveByPlanKey = new Map(snapshot.livePlanVersions.map((v) => [v.planId, v]));

    const plans: PlanDef[] = snapshot.plans
        .filter((p) => p.deletedAt === null)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((stem) => {
            const live = liveByPlanKey.get(stem.planKey);
            if (!live) {
                // Plan ohne live-Version — minimaler Stub, damit der Catalog
                // strukturell vollständig ist (getPlan() findet ihn weiter).
                // marketed: false, sonst erscheinen unveröffentlichte Pläne
                // als „auf Anfrage" in Self-Service-Listen (getMarketedPlans
                // filtert nur `!== false`).
                return {
                    id: stem.planKey,
                    name: stem.label,
                    tagline: stem.description ?? undefined,
                    marketed: false,
                    monthlyNet: null,
                    yearlyNet: null,
                    features: [],
                    quotas: {} as Record<QuotaKey, number>,
                };
            }
            return {
                id: stem.planKey,
                name: stem.label,
                tagline: stem.description ?? undefined,
                marketed: live.marketed,
                monthlyNet: parseFloat(live.monthlyNet),
                yearlyNet: parseFloat(live.yearlyNet),
                features: live.features as FeatureKey[],
                quotas: (live.quotas ?? {}) as Record<QuotaKey, number>,
            };
        });

    const features: FeatureDef[] = snapshot.featureEntries
        .filter((f) => f.deletedAt === null)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((row) => ({
            key: row.featureKey as FeatureKey,
            label: row.label,
            icon: row.icon ?? undefined,
            tier: row.tier ?? undefined,
            plannedOnly: row.plannedOnly,
        }));

    return {
        schemaVersion: 1,
        projectKey: settings.projectKey,
        ...(settings.app ? { app: settings.app } : {}),
        currency: settings.currency,
        vatRate: settings.vatRate,
        ...(settings.marketing ? { marketing: settings.marketing } : {}),
        features,
        plans,
    };
}
