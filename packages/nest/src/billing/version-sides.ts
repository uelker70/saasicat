// A plan version as a subscriber compares it with another: its price in each
// rhythm, its quotas and its features. An offer and a retirement both put two
// versions side by side this way, so a subscriber reads a newer version offered
// and a replacement announced alike.

import type { PlanDef, PlanVersionRow, VersionOfferFields, VersionOfferSide } from '@saasicat/core';

import { planDefFromVersion } from './plan-catalog-from-snapshot.js';

/** A version row as the comparison reads it: a price the row does not carry is `null`. */
export function planOfVersion(planKey: string, row: PlanVersionRow): PlanDef {
    return planDefFromVersion({ id: planKey, name: planKey }, row);
}

/** What the classification compares of a plan. */
export function comparedFieldsOf(plan: PlanDef): VersionOfferFields {
    return {
        features: plan.features,
        quotas: plan.quotas,
        monthlyNet: plan.monthlyNet ?? null,
        yearlyNet: plan.yearlyNet ?? null,
    };
}

/** One version as a subscriber compares it. */
export function versionSideOf(row: PlanVersionRow, plan: PlanDef): VersionOfferSide {
    return {
        planVersionId: row.id,
        version: row.version,
        features: [...plan.features],
        quotas: { ...plan.quotas },
        monthlyNet: plan.monthlyNet ?? null,
        yearlyNet: plan.yearlyNet ?? null,
        validUntil: isoOrNull(row.validUntil),
        endsAt: isoOrNull(row.endsAt),
    };
}

/** A date as a store hands it over — a string, or a `Date` from a driver that parses — as ISO. */
function isoOrNull(value: string | Date | null | undefined): string | null {
    return value === null || value === undefined ? null : new Date(value).toISOString();
}
