// buildPlanCatalogFromSnapshot — pure function (DI-free) that assembles a
// `PlanCatalog` snapshot from DB reads.
//
// Inputs:
//  - The settings of `config/saas.yaml` — every block that is not the
//    catalogue, handed on whole.
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
    PlanCatalogSettings,
    PlanDef,
    PlanVersionRow,
    QuotaKey,
} from '@saasicat/core';

/**
 * The settings a database catalogue runs on. The database carries plans and
 * features, never the settings, so they can only come from the file — every
 * block of it, which is why this is the settings type rather than a list.
 */
export type PlanCatalogBuildSettings = PlanCatalogSettings;

export function buildPlanCatalogFromSnapshot(
    settings: PlanCatalogBuildSettings,
    snapshot: PlanCatalogReadSnapshot,
): PlanCatalog {
    // Index live PlanVersions by planKey for O(1) lookup
    const liveByPlanKey = new Map(snapshot.livePlanVersions.map((v) => [v.planId, v]));

    const plans: PlanDef[] = snapshot.plans
        .filter((p) => p.deletedAt === null)
        .sort((a, b) => a.sortOrder - b.sortOrder || byKey(a.planKey, b.planKey))
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
            return planDefFromVersion(
                { id: stem.planKey, name: stem.label, tagline: stem.description ?? undefined },
                live,
            );
        });

    const features: FeatureDef[] = snapshot.featureEntries
        .filter((f) => f.deletedAt === null)
        .sort((a, b) => a.sortOrder - b.sortOrder || byKey(a.featureKey, b.featureKey))
        .map((row) => ({
            key: row.featureKey as FeatureKey,
            label: row.label,
            icon: row.icon ?? undefined,
            tier: row.tier ?? undefined,
            plannedOnly: row.plannedOnly,
        }));

    // A block left out stays out, rather than arriving as a member that holds
    // `undefined` — the file loader never produces one.
    const given = Object.fromEntries(
        Object.entries(settings).filter(([, value]) => value !== undefined),
    ) as PlanCatalogSettings;
    return { schemaVersion: 1, ...given, features, plans };
}

/**
 * A plan as the catalogue describes it: its identity, and what one version of
 * it costs and includes. The catalogue builds it from the live version; the
 * contract freeze from the version a subscription is bound to.
 */
export function planDefFromVersion(
    identity: Pick<PlanDef, 'id' | 'name' | 'tagline'>,
    version: PlanVersionRow,
): PlanDef {
    return {
        ...identity,
        marketed: version.marketed,
        monthlyNet: priceOf(version.monthlyNet),
        yearlyNet: priceOf(version.yearlyNet),
        features: version.features as FeatureKey[],
        quotas: (version.quotas ?? {}) as Record<QuotaKey, number>,
    };
}

/**
 * A price as the row carries it. An installation's own schema may leave the
 * column nullable, and a row mapped from it then carries no number here: that
 * is a plan not sold in the rhythm, which the callers refuse — never `NaN`,
 * which every comparison would wave through.
 */
function priceOf(value: string | null | undefined): number | null {
    const price = Number.parseFloat(String(value));
    return Number.isFinite(price) ? price : null;
}

/**
 * The second key for rows that share a `sortOrder`. A database returns such a
 * tie in whatever order it likes, and the catalogue is read for every
 * operation, so without it two requests could see two plans in different
 * orders — and disagree on which of them a change to the other is an upgrade
 * to, or on the manifest's hash. Here rather than in each read sink, so that
 * no adapter has to remember it.
 */
function byKey(a: string, b: string): number {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}
