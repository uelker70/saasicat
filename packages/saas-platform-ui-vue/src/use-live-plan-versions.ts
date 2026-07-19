// useLivePlanVersions — lädt pro Plan-Stamm die aktuell „live" Plan-Version
// (publishedAt != null && supersededAt == null && latest by validFrom) und
// baut ein Mapping `planKey → PlanVersionRow | null`. Wird von der
// BundlesPage (Plan↔Bundle-Overlap-Check im Compat-Picker) konsumiert.
//
// Implementierung: 1 + N HTTP-Requests (PlanListe + pro Plan versions/).
// Für SuperAdmin-Setups mit wenigen Plänen (3-10) akzeptabel; eine
// Backend-Optimierung über `GET /admin/catalog/plans?include=liveVersion`
// kann später additiv kommen.

import { ref, watch, type Ref } from 'vue';
import type { PlanRow, PlanVersionRow } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface UseLivePlanVersionsOptions {
    adminEndpoint: string;
    /** Reactive Liste der Plan-Stämme — Watcher lädt neu, wenn sich die Liste ändert. */
    plans: Ref<PlanRow[]>;
    http?: HttpClient;
    getAuthToken?: () => string | null;
}

export interface UseLivePlanVersionsResult {
    /** `planKey → live PlanVersion` (oder null, wenn der Plan keine live Version hat). */
    livePlanVersions: Ref<Record<string, PlanVersionRow | null>>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Erzwingt Neuladen aller Live-Versionen. */
    refresh: () => Promise<void>;
}

export function useLivePlanVersions(
    options: UseLivePlanVersionsOptions,
): UseLivePlanVersionsResult {
    if (!options?.adminEndpoint) {
        throw new Error('useLivePlanVersions: `adminEndpoint` ist Pflicht.');
    }
    if (!options?.plans) {
        throw new Error('useLivePlanVersions: `plans` ist Pflicht.');
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
            throw new Error(`HTTP ${res.status} beim Laden der Versionen für Plan '${planId}'`);
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
                        // Per-Plan-Fehler nicht aufaddieren — die anderen Pläne
                        // sollen weiter funktionieren; nur Mapping-Eintrag null.
                        console.warn(
                            `useLivePlanVersions: Plan '${plan.planKey}' Versions-Load failed`,
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

    // Auto-Refresh, wenn sich die Plan-Liste ändert (z. B. nach Anlage
    // eines neuen Plans). Erstes Laden geschieht beim ersten Plan-Eintrag.
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
 * Liefert die aktuell „live" PlanVersion einer Versions-Liste:
 *   - publishedAt != null
 *   - supersededAt == null
 *   - höchstes validFrom (= zuletzt aktivierte)
 *
 * Wenn keine published-Version existiert oder alle superseded sind: null.
 * Ignoriert validUntil bewusst — die UI braucht hier den „neuesten
 * Vertrags-Inhalt" für Overlap-Berechnungen, nicht den asOf-now-Check.
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
