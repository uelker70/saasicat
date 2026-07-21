// buildPlanCatalogFromSnapshot — pure function (DI-free) that assembles a
// `PlanCatalog` snapshot from DB reads (SPEC_V2 §11.1 M6 Pack 2c).
//
// Inputs:
//  - App-global settings (projectKey, currency, vatRate) —
//    build-time identity, provided statically by the AppModule.
//  - DB snapshot with Plans + live PlanVersions + FeatureCatalogEntries.
//
// Output: `PlanCatalog` (same wire format as the YAML loader).
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
    /** App identity (branding + version) from `config/saas.yaml#app`. Optional. */
    app?: PlanCatalog['app'];
    currency: string;
    vatRate: number;
    /** App-wide marketing configuration (SPEC_V2 §6.5). Optional. */
    marketing?: PlanCatalog['marketing'];
}

export function buildPlanCatalogFromSnapshot(
    settings: PlanCatalogBuildSettings,
    snapshot: PlanCatalogReadSnapshot,
): PlanCatalog {
    // Index live PlanVersions by planKey for O(1) lookup
    const liveByPlanKey = new Map(snapshot.livePlanVersions.map((v) => [v.planId, v]));

    const plans: PlanDef[] = snapshot.plans
        .filter((p) => p.deletedAt === null)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((stem) => {
            const live = liveByPlanKey.get(stem.planKey);
            if (!live) {
                // Plan without a live version — minimal stub so the catalog
                // is structurally complete (getPlan() still finds it).
                // marketed: false, otherwise unpublished plans appear
                // as "on request" in self-service lists (getMarketedPlans
                // only filters `!== false`).
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
