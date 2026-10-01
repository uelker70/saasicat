// Resolving plans into what a listing actually shows — which version is on
// sale, which are scheduled, which is the open draft — and the four counts
// derived from that. Whether a version is on sale is the platform's rule
// (`versionSale`), not one of this file's own.
//
// It lives outside the components because two of them need the same answer:
// `PlanList` renders the rows, and `PlansPage` shows the counts above it. The
// alternative was the same sixty lines in both, drifting apart the first time
// a validity rule changed.
//
// Framework-free on purpose: no Vue, so the rules can be tested as plain data
// in and data out.

import { versionOnSale, versionSale, type VersionSaleDates } from './version-sale.js';

export interface PlanRowLike {
    id: string;
    planKey: string;
    label: string;
    description?: string | null;
    sortOrder: number;
}

export interface PlanVersionLike extends VersionSaleDates {
    id: string;
    version?: number;
    validFrom?: string | null;
    validUntil?: string | null;
}

export interface ResolvedPlan<P extends PlanRowLike, V extends PlanVersionLike> {
    plan: P;
    planKey: string;
    label: string;
    description: string | null;
    /** The version on sale now — the one a booking made now binds. */
    onSale: V | null;
    /** Version shown on the parent row — the one on sale where there is one. */
    primary: V | null;
    /** Versions on sale from a later day first, then drafts. */
    subRows: V[];
    hasAnyVersion: boolean;
    /** Nothing on sale, nothing scheduled, no draft: hidden from the admin listing. */
    allExpired: boolean;
    draft: V | null;
    tenantCount: number;
}

export interface ResolvePlansInput<P extends PlanRowLike, V extends PlanVersionLike> {
    plans: readonly P[];
    versionsByPlanId: Record<string, V[]>;
    tenantCountsByPlanKey: Record<string, number>;
    /** Injectable for tests; defaults to the current moment. */
    now?: Date;
}

export function resolvePlans<P extends PlanRowLike, V extends PlanVersionLike>({
    plans,
    versionsByPlanId,
    tenantCountsByPlanKey,
    now = new Date(),
}: ResolvePlansInput<P, V>): ResolvedPlan<P, V>[] {
    return [...plans]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.planKey.localeCompare(b.planKey))
        .map<ResolvedPlan<P, V>>((plan) => {
            const versions = versionsByPlanId[plan.id] ?? [];
            const drafts = versions.filter((v) => !v.publishedAt);
            const onSale = versionOnSale(versions, now);
            const scheduled = versions
                .filter((v) => versionSale(v, now).kind === 'scheduled')
                .sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? ''));

            // Parent row: the version on sale where there is one, otherwise the
            // next scheduled one, otherwise nothing — a plan with only drafts
            // still gets a row.
            const primary = onSale ?? scheduled[0] ?? null;

            const seen = new Set<string>();
            if (primary) seen.add(primary.id);
            const subRows: V[] = [];
            for (const v of [...scheduled, ...drafts]) {
                if (seen.has(v.id)) continue;
                subRows.push(v);
                seen.add(v.id);
            }

            return {
                plan,
                planKey: plan.planKey,
                label: plan.label,
                description: plan.description ?? null,
                onSale,
                primary,
                subRows,
                hasAnyVersion: versions.length > 0,
                allExpired:
                    versions.length > 0 &&
                    drafts.length === 0 &&
                    onSale === null &&
                    scheduled.length === 0,
                draft: drafts[0] ?? null,
                tenantCount: tenantCountsByPlanKey[plan.planKey] ?? 0,
            };
        });
}

export interface PlanCounts {
    plans: number;
    onSale: number;
    drafts: number;
    tenants: number;
}

export function countPlans<P extends PlanRowLike, V extends PlanVersionLike>(
    resolved: readonly ResolvedPlan<P, V>[],
): PlanCounts {
    return {
        plans: resolved.length,
        onSale: resolved.filter((p) => p.onSale !== null).length,
        drafts: resolved.filter((p) => p.draft !== null).length,
        tenants: resolved.reduce((sum, p) => sum + p.tenantCount, 0),
    };
}
