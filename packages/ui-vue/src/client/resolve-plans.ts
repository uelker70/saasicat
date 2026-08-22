// Resolving plans into what a listing actually shows — which version is live,
// which are scheduled, which is the open draft — and the four counts derived
// from that.
//
// It lives outside the components because two of them need the same answer:
// `PlanList` renders the rows, and `PlansPage` shows the counts above it. The
// alternative was the same sixty lines in both, drifting apart the first time
// a validity rule changed.
//
// Framework-free on purpose: no Vue, so the rules can be tested as plain data
// in and data out.

export interface PlanRowLike {
    id: string;
    planKey: string;
    label: string;
    description?: string | null;
    sortOrder: number;
}

export interface PlanVersionLike {
    id: string;
    publishedAt?: string | null;
    validFrom?: string | null;
    validUntil?: string | null;
}

export interface ResolvedPlan<P extends PlanRowLike, V extends PlanVersionLike> {
    plan: P;
    planKey: string;
    label: string;
    description: string | null;
    /** Version currently active for new bookings. */
    currentLive: V | null;
    /** Version shown on the parent row — the live one where there is one. */
    primary: V | null;
    /** Future-published versions first, then drafts. */
    subRows: V[];
    hasAnyVersion: boolean;
    /** Every version has run out: hidden from the admin listing. */
    allExpired: boolean;
    draft: V | null;
    tenantCount: number;
}

export function todayIsoDate(): string {
    return new Date().toISOString().slice(0, 10);
}

export function isCurrentlyValid(v: PlanVersionLike, today: string): boolean {
    if (!v.publishedAt) return false;
    if (v.validFrom && v.validFrom.slice(0, 10) > today) return false;
    if (v.validUntil && v.validUntil.slice(0, 10) < today) return false;
    return true;
}

export function isFutureScheduled(v: PlanVersionLike, today: string): boolean {
    if (!v.publishedAt) return false;
    if (!v.validFrom) return false;
    return v.validFrom.slice(0, 10) > today;
}

export function isExpired(v: PlanVersionLike, today: string): boolean {
    if (!v.publishedAt) return false;
    if (!v.validUntil) return false;
    return v.validUntil.slice(0, 10) < today;
}

export interface ResolvePlansInput<P extends PlanRowLike, V extends PlanVersionLike> {
    plans: readonly P[];
    versionsByPlanId: Record<string, V[]>;
    tenantCountsByPlanKey: Record<string, number>;
    /** Injectable for tests; defaults to today. */
    today?: string;
}

export function resolvePlans<P extends PlanRowLike, V extends PlanVersionLike>({
    plans,
    versionsByPlanId,
    tenantCountsByPlanKey,
    today = todayIsoDate(),
}: ResolvePlansInput<P, V>): ResolvedPlan<P, V>[] {
    return [...plans]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.planKey.localeCompare(b.planKey))
        .map<ResolvedPlan<P, V>>((plan) => {
            const versions = versionsByPlanId[plan.id] ?? [];
            const drafts = versions.filter((v) => !v.publishedAt);
            const published = versions.filter((v) => Boolean(v.publishedAt));
            const currentLive = published.find((v) => isCurrentlyValid(v, today)) ?? null;
            const futureScheduled = published
                .filter((v) => isFutureScheduled(v, today))
                .sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? ''));

            // Parent row: the live version where there is one, otherwise the
            // next scheduled one, otherwise nothing — a plan with only drafts
            // still gets a row.
            const primary = currentLive ?? futureScheduled[0] ?? null;

            const seen = new Set<string>();
            if (primary) seen.add(primary.id);
            const subRows: V[] = [];
            for (const v of [...futureScheduled, ...drafts]) {
                if (seen.has(v.id)) continue;
                subRows.push(v);
                seen.add(v.id);
            }

            return {
                plan,
                planKey: plan.planKey,
                label: plan.label,
                description: plan.description ?? null,
                currentLive,
                primary,
                subRows,
                hasAnyVersion: versions.length > 0,
                allExpired:
                    versions.length > 0 &&
                    drafts.length === 0 &&
                    futureScheduled.length === 0 &&
                    published.every((v) => isExpired(v, today)),
                draft: drafts[0] ?? null,
                tenantCount: tenantCountsByPlanKey[plan.planKey] ?? 0,
            };
        });
}

export interface PlanCounts {
    plans: number;
    live: number;
    drafts: number;
    tenants: number;
}

export function countPlans<P extends PlanRowLike, V extends PlanVersionLike>(
    resolved: readonly ResolvedPlan<P, V>[],
): PlanCounts {
    return {
        plans: resolved.length,
        live: resolved.filter((p) => p.currentLive !== null).length,
        drafts: resolved.filter((p) => p.draft !== null).length,
        tenants: resolved.reduce((sum, p) => sum + p.tenantCount, 0),
    };
}
