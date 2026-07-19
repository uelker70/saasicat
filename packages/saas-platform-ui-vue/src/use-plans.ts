// usePlans + usePlanVersions — Vue-3-Composables für die SuperAdmin-
// Plan-Verwaltung. SPEC_V2 §11.1 M6:
//   Pack 1 → usePlans (Stamm-CRUD)
//   Pack 2a → usePlanVersions (Draft-/Publish-Lifecycle)

import { ref, type Ref } from 'vue';
import type {
    CreatePlanData,
    CreatePlanVersionDraftData,
    PlanRow,
    PlanVersionMutationResult,
    PlanVersionRow,
    UpdatePlanData,
    UpdatePlanVersionDraftData,
} from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface UsePlansOptions {
    /**
     * Voll-qualifizierter Admin-Endpoint-Prefix inkl. App-globalPrefix
     * (`/api/admin`, `/api/v1/admin`, …). Pflicht.
     */
    adminEndpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** Pflicht: projectKey, gegen den die Liste gefiltert wird. */
    projectKey: string;
    /** Bei `true` wird beim Composable-Init geladen. Default `false`. */
    autoLoad?: boolean;
}

export class PlansApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = 'PlansApiError';
    }
}

export interface UsePlansResult {
    plans: Ref<PlanRow[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /**
     * planKey → Anzahl aktiver (ACTIVE/TRIAL) Subscriptions, versions- und
     * tenant-übergreifend. Pläne ohne Abo fehlen in der Map (Default 0 beim
     * Lesen). Befüllt durch `loadTenantCounts()`.
     */
    tenantCountsByPlanKey: Ref<Record<string, number>>;

    load: () => Promise<void>;
    /**
     * Lädt die plattformweiten Tenant-Zähler
     * (`GET /admin/catalog/plans/tenant-counts?projectKey=…`) und schreibt sie
     * nach `tenantCountsByPlanKey`. Best-effort: Fehler werden geschluckt
     * (leere Map), da die Zähler nur dekorativ in der Plan-Übersicht sind.
     */
    loadTenantCounts: () => Promise<void>;
    create: (data: CreatePlanData) => Promise<PlanRow>;
    update: (planId: string, data: UpdatePlanData) => Promise<PlanRow>;
    softDelete: (planId: string) => Promise<void>;
    /**
     * Hartes Löschen (`DELETE /admin/catalog/plans/:id/purge`). Nur erlaubt
     * für Pläne ohne PlanVersionen — Backend antwortet sonst mit 422
     * `PLAN_HAS_VERSIONS`. Entfernt den Plan auch aus `plans`.
     */
    hardDelete: (planId: string) => Promise<void>;
}

export function usePlans(options: UsePlansOptions): UsePlansResult {
    if (!options?.adminEndpoint) {
        throw new Error(
            'usePlans: `adminEndpoint` ist Pflicht (z. B. "/api/admin" oder ' + '"/api/v1/admin").',
        );
    }
    if (!options?.projectKey) {
        throw new Error('usePlans: `projectKey` ist Pflicht.');
    }

    const http = options.http ?? defaultHttpClient();
    const plans = ref<PlanRow[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);
    const tenantCountsByPlanKey = ref<Record<string, number>>({});

    const baseUrl = `${options.adminEndpoint}/catalog/plans`;

    function authHeaders(): Record<string, string> {
        const token = options.getAuthToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function fetchJson<T>(url: string, init?: Parameters<HttpClient>[1]): Promise<T | null> {
        const res = await http(url, {
            method: init?.method ?? 'GET',
            headers: {
                'content-type': 'application/json',
                ...authHeaders(),
                ...init?.headers,
            },
            body: init?.body,
        });
        if (res.status === 204) return null;
        const body = await res.json().catch(() => null);
        if (res.status >= 400) {
            throw new PlansApiError(
                res.status,
                body,
                `Plans-API antwortete mit HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchJson<PlanRow[]>(
                `${baseUrl}?projectKey=${encodeURIComponent(options.projectKey)}`,
            );
            plans.value = data ?? [];
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function loadTenantCounts(): Promise<void> {
        try {
            const data = await fetchJson<Record<string, number>>(
                `${baseUrl}/tenant-counts?projectKey=${encodeURIComponent(options.projectKey)}`,
            );
            tenantCountsByPlanKey.value = data ?? {};
        } catch {
            // Best-effort: Zähler sind dekorativ — kein Block des Plan-Ladens.
            tenantCountsByPlanKey.value = {};
        }
    }

    async function create(data: CreatePlanData): Promise<PlanRow> {
        const created = await fetchJson<PlanRow>(baseUrl, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!created) throw new PlansApiError(0, null, 'Create gab keinen Body zurück');
        plans.value = [...plans.value, created];
        return created;
    }

    async function update(planId: string, data: UpdatePlanData): Promise<PlanRow> {
        const updated = await fetchJson<PlanRow>(`${baseUrl}/${planId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
        if (!updated) throw new PlansApiError(0, null, 'Update gab keinen Body zurück');
        plans.value = plans.value.map((p) => (p.id === planId ? updated : p));
        return updated;
    }

    async function softDelete(planId: string): Promise<void> {
        await fetchJson<null>(`${baseUrl}/${planId}`, { method: 'DELETE' });
        plans.value = plans.value.filter((p) => p.id !== planId);
    }

    async function hardDelete(planId: string): Promise<void> {
        await fetchJson<null>(`${baseUrl}/${planId}/purge`, { method: 'DELETE' });
        plans.value = plans.value.filter((p) => p.id !== planId);
    }

    if (options.autoLoad) {
        void load();
    }

    return {
        plans,
        loading,
        error,
        tenantCountsByPlanKey,
        load,
        loadTenantCounts,
        create,
        update,
        softDelete,
        hardDelete,
    };
}

// =============================================================================
// usePlanVersions — Lifecycle-Operations für eine konkrete Plan-ID
// (SPEC_V2 §11.1 M6 Pack 2a).
// =============================================================================

export interface UsePlanVersionsOptions {
    adminEndpoint: string;
    /** UUID des Plan-Stamms (Plan.id), nicht der planKey. */
    planId: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    autoLoad?: boolean;
}

export interface UsePlanVersionsResult {
    versions: Ref<PlanVersionRow[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;

    load: () => Promise<void>;
    /**
     * `data.planId` braucht der Caller nicht zu setzen — kommt aus den
     * Composable-Options (`adminEndpoint/catalog/plans/:id/versions`).
     */
    createDraft: (
        data: Omit<CreatePlanVersionDraftData, 'planId'>,
    ) => Promise<PlanVersionMutationResult>;
    updateDraft: (
        versionId: string,
        data: UpdatePlanVersionDraftData,
    ) => Promise<PlanVersionMutationResult>;
    publish: (
        versionId: string,
        opts?: {
            forceRegressive?: boolean;
            allowZeroPrice?: boolean;
            validFrom?: string | null;
            validUntil?: string | null;
        },
    ) => Promise<PlanVersionMutationResult>;
    /**
     * Verwirft einen Draft (`DELETE /admin/catalog/plan-versions/:id`).
     * Published Versions können nicht verworfen werden — die API antwortet
     * mit 422 und Code `PLAN_VERSION_ALREADY_PUBLISHED`.
     */
    discardDraft: (versionId: string) => Promise<void>;
    /**
     * Terminiert eine live PlanVersion mit `endsAt` (ohne Nachfolge-Version).
     * Idempotent — zweiter Aufruf mit anderem Datum überschreibt.
     */
    terminateVersion: (versionId: string, endsAt: string) => Promise<PlanVersionRow>;
}

export function usePlanVersions(options: UsePlanVersionsOptions): UsePlanVersionsResult {
    if (!options?.adminEndpoint) {
        throw new Error('usePlanVersions: `adminEndpoint` ist Pflicht.');
    }
    if (!options?.planId) {
        throw new Error('usePlanVersions: `planId` ist Pflicht.');
    }

    const http = options.http ?? defaultHttpClient();
    const versions = ref<PlanVersionRow[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const planVersionsUrl = `${options.adminEndpoint}/catalog/plans/${options.planId}/versions`;
    const versionUrlBase = `${options.adminEndpoint}/catalog/plan-versions`;

    function authHeaders(): Record<string, string> {
        const token = options.getAuthToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function fetchJson<T>(url: string, init?: Parameters<HttpClient>[1]): Promise<T | null> {
        const res = await http(url, {
            method: init?.method ?? 'GET',
            headers: {
                'content-type': 'application/json',
                ...authHeaders(),
                ...init?.headers,
            },
            body: init?.body,
        });
        if (res.status === 204) return null;
        const body = await res.json().catch(() => null);
        if (res.status >= 400) {
            throw new PlansApiError(
                res.status,
                body,
                `PlanVersions-API antwortete mit HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchJson<PlanVersionRow[]>(planVersionsUrl);
            versions.value = data ?? [];
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function createDraft(
        data: Omit<CreatePlanVersionDraftData, 'planId'>,
    ): Promise<PlanVersionMutationResult> {
        const result = await fetchJson<PlanVersionMutationResult>(planVersionsUrl, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!result) throw new PlansApiError(0, null, 'CreateDraft gab keinen Body zurück');
        versions.value = [...versions.value, result.planVersion];
        return result;
    }

    async function updateDraft(
        versionId: string,
        data: UpdatePlanVersionDraftData,
    ): Promise<PlanVersionMutationResult> {
        const result = await fetchJson<PlanVersionMutationResult>(
            `${versionUrlBase}/${versionId}`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!result) throw new PlansApiError(0, null, 'UpdateDraft gab keinen Body zurück');
        versions.value = versions.value.map((v) => (v.id === versionId ? result.planVersion : v));
        return result;
    }

    async function publish(
        versionId: string,
        opts: {
            forceRegressive?: boolean;
            allowZeroPrice?: boolean;
            validFrom?: string | null;
            validUntil?: string | null;
        } = {},
    ): Promise<PlanVersionMutationResult> {
        const result = await fetchJson<PlanVersionMutationResult>(
            `${versionUrlBase}/${versionId}/publish`,
            { method: 'POST', body: JSON.stringify(opts) },
        );
        if (!result) throw new PlansApiError(0, null, 'Publish gab keinen Body zurück');
        versions.value = versions.value.map((v) => (v.id === versionId ? result.planVersion : v));
        return result;
    }

    async function discardDraft(versionId: string): Promise<void> {
        await fetchJson<null>(`${versionUrlBase}/${versionId}`, { method: 'DELETE' });
        versions.value = versions.value.filter((v) => v.id !== versionId);
    }

    async function terminateVersion(versionId: string, endsAt: string): Promise<PlanVersionRow> {
        const updated = await fetchJson<PlanVersionRow>(
            `${versionUrlBase}/${versionId}/terminate`,
            { method: 'POST', body: JSON.stringify({ endsAt }) },
        );
        if (!updated) throw new PlansApiError(0, null, 'Terminate gab keinen Body zurück');
        versions.value = versions.value.map((v) => (v.id === versionId ? updated : v));
        return updated;
    }

    if (options.autoLoad) {
        void load();
    }

    return {
        versions,
        loading,
        error,
        load,
        createDraft,
        updateDraft,
        publish,
        discardDraft,
        terminateVersion,
    };
}
