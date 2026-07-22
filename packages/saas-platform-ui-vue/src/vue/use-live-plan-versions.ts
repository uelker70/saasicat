// useLivePlanVersions — loads, per plan stem, the currently "live" plan version
// (publishedAt != null && supersededAt == null && latest by validFrom) and
// builds a mapping `planKey → PlanVersionRow | null`. Consumed by the
// BundlesPage (Plan↔Bundle overlap check in the compat picker).
//
// Implementation: 1 + N HTTP requests (plan list + versions/ per plan).
// Acceptable for SuperAdmin setups with few plans (3-10); a backend
// optimization via `GET /admin/catalog/plans?include=liveVersion`
// can be added later, additively.

import { ref, watch, type Ref } from 'vue';
import type { PlanRow, PlanVersionRow } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseLivePlanVersionsOptions {
    adminEndpoint: string;
    /** Reactive list of plan stems — the watcher reloads when the list changes. */
    plans: Ref<PlanRow[]>;
    http?: HttpClient;
    getAuthToken?: () => string | null;
}

export interface UseLivePlanVersionsResult {
    /** `planKey → live PlanVersion` (or null when the plan has no live version). */
    livePlanVersions: Ref<Record<string, PlanVersionRow | null>>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Forces a reload of all live versions. */
    refresh: () => Promise<void>;
}

export function useLivePlanVersions(
    options: UseLivePlanVersionsOptions,
): UseLivePlanVersionsResult {
    if (!options?.adminEndpoint) {
        throw new Error('useLivePlanVersions: `adminEndpoint` is required.');
    }
    if (!options?.plans) {
        throw new Error('useLivePlanVersions: `plans` is required.');
    }

    const http = options.http ?? defaultHttpClient();
    const livePlanVersions = ref<Record<string, PlanVersionRow | null>>({});
    const loading = ref(false);
    const error = ref<Error | null>(null);

    function authHeaders(): Record<string, string> {
        const token = options.getAuthToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function loadForPlan(planId: string): Promise<PlanVersionRow | null> {
        const res = await http(`${options.adminEndpoint}/catalog/plans/${planId}/versions`, {
            method: 'GET',
            headers: { 'content-type': 'application/json', ...authHeaders() },
        });
        if (res.status >= 400) {
            throw new Error(`HTTP ${res.status} while loading the versions of plan '${planId}'`);
        }
        const versions = (await res.json().catch(() => null)) as PlanVersionRow[] | null;
        if (!versions || versions.length === 0) return null;
        return findLatestLive(versions);
    }

    async function refresh(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const entries = await Promise.all(
                options.plans.value.map(async (plan) => {
                    try {
                        const live = await loadForPlan(plan.id);
                        return [plan.planKey, live] as const;
                    } catch (err) {
                        // Do not aggregate per-plan errors — the other plans
                        // should keep working; just set the mapping entry to null.
                        console.warn(
                            `useLivePlanVersions: loading the versions of plan '${plan.planKey}' failed`,
                            err,
                        );
                        return [plan.planKey, null] as const;
                    }
                }),
            );
            livePlanVersions.value = Object.fromEntries(entries);
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    // Auto-refresh when the plan list changes (e.g. after creating a
    // new plan). The first load happens on the first plan entry.
    watch(
        () => options.plans.value.map((p) => p.id).join(','),
        () => {
            if (options.plans.value.length > 0) void refresh();
            else livePlanVersions.value = {};
        },
        { immediate: true },
    );

    return { livePlanVersions, loading, error, refresh };
}

/**
 * Returns the currently "live" PlanVersion from a versions list:
 *   - publishedAt != null
 *   - supersededAt == null
 *   - highest validFrom (= most recently activated)
 *
 * If no published version exists or all are superseded: null.
 * Intentionally ignores validUntil — here the UI needs the "newest
 * contract content" for overlap calculations, not the asOf-now check.
 */
function findLatestLive(versions: PlanVersionRow[]): PlanVersionRow | null {
    const candidates = versions.filter((v) => v.publishedAt !== null && v.supersededAt === null);
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => {
        const av = a.validFrom ?? '';
        const bv = b.validFrom ?? '';
        if (av === bv) return b.version - a.version;
        return bv.localeCompare(av);
    })[0];
}
