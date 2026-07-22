// useBusinessTypes + useBusinessTypeVersions — Vue 3 composables for
// SuperAdmin business-type management (backend: BusinessTypesController under
// /admin/catalog/business-types + /admin/catalog/business-type-versions).
//
// Pattern analogous to use-bundles.ts.

import { ref, type Ref } from 'vue';
import type {
    BusinessTypeRow,
    BusinessTypeVersionMutationResult,
    BusinessTypeVersionRow,
    CreateBusinessTypeData,
    CreateBusinessTypeVersionDraftData,
    UpdateBusinessTypeData,
    UpdateBusinessTypeVersionDraftData,
} from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseBusinessTypesOptions {
    adminEndpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    projectKey: string;
    autoLoad?: boolean;
}

export class BusinessTypesApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = 'BusinessTypesApiError';
    }
}

export interface UseBusinessTypesResult {
    businessTypes: Ref<BusinessTypeRow[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;

    load: () => Promise<void>;
    create: (data: CreateBusinessTypeData) => Promise<BusinessTypeRow>;
    update: (businessTypeId: string, data: UpdateBusinessTypeData) => Promise<BusinessTypeRow>;
    softDelete: (businessTypeId: string) => Promise<void>;
}

export function useBusinessTypes(options: UseBusinessTypesOptions): UseBusinessTypesResult {
    if (!options?.adminEndpoint) {
        throw new Error('useBusinessTypes: `adminEndpoint` ist Pflicht.');
    }
    if (!options?.projectKey) {
        throw new Error('useBusinessTypes: `projectKey` ist Pflicht.');
    }

    const http = options.http ?? defaultHttpClient();
    const businessTypes = ref<BusinessTypeRow[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const baseUrl = `${options.adminEndpoint}/catalog/business-types`;

    function authHeaders(): Record<string, string> {
        const token = options.getAuthToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function fetchJson<T>(url: string, init?: Parameters<HttpClient>[1]): Promise<T | null> {
        const res = await http(url, {
            method: init?.method ?? 'GET',
            headers: { 'content-type': 'application/json', ...authHeaders(), ...init?.headers },
            body: init?.body,
        });
        if (res.status === 204) return null;
        const body = await res.json().catch(() => null);
        if (res.status >= 400) {
            throw new BusinessTypesApiError(
                res.status,
                body,
                `BusinessTypes-API antwortete mit HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchJson<BusinessTypeRow[]>(
                `${baseUrl}?projectKey=${encodeURIComponent(options.projectKey)}`,
            );
            businessTypes.value = data ?? [];
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function create(data: CreateBusinessTypeData): Promise<BusinessTypeRow> {
        const created = await fetchJson<BusinessTypeRow>(baseUrl, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!created) throw new BusinessTypesApiError(0, null, 'Create gab keinen Body zurück');
        businessTypes.value = [...businessTypes.value, created];
        return created;
    }

    async function update(
        businessTypeId: string,
        data: UpdateBusinessTypeData,
    ): Promise<BusinessTypeRow> {
        const updated = await fetchJson<BusinessTypeRow>(`${baseUrl}/${businessTypeId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
        if (!updated) throw new BusinessTypesApiError(0, null, 'Update gab keinen Body zurück');
        businessTypes.value = businessTypes.value.map((b) =>
            b.id === businessTypeId ? updated : b,
        );
        return updated;
    }

    async function softDelete(businessTypeId: string): Promise<void> {
        await fetchJson<null>(`${baseUrl}/${businessTypeId}`, { method: 'DELETE' });
        businessTypes.value = businessTypes.value.filter((b) => b.id !== businessTypeId);
    }

    if (options.autoLoad) {
        void load();
    }

    return { businessTypes, loading, error, load, create, update, softDelete };
}

// =============================================================================
// useBusinessTypeVersions
// =============================================================================

export interface UseBusinessTypeVersionsOptions {
    adminEndpoint: string;
    businessTypeId: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    autoLoad?: boolean;
}

export interface UseBusinessTypeVersionsResult {
    versions: Ref<BusinessTypeVersionRow[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;

    load: () => Promise<void>;
    createDraft: (
        data: Omit<CreateBusinessTypeVersionDraftData, 'businessTypeId'>,
    ) => Promise<BusinessTypeVersionMutationResult>;
    updateDraft: (
        versionId: string,
        data: UpdateBusinessTypeVersionDraftData,
    ) => Promise<BusinessTypeVersionMutationResult>;
    publish: (
        versionId: string,
        opts?: { forceRegressive?: boolean },
    ) => Promise<BusinessTypeVersionMutationResult>;
}

export function useBusinessTypeVersions(
    options: UseBusinessTypeVersionsOptions,
): UseBusinessTypeVersionsResult {
    if (!options?.adminEndpoint) {
        throw new Error('useBusinessTypeVersions: `adminEndpoint` ist Pflicht.');
    }
    if (!options?.businessTypeId) {
        throw new Error('useBusinessTypeVersions: `businessTypeId` ist Pflicht.');
    }

    const http = options.http ?? defaultHttpClient();
    const versions = ref<BusinessTypeVersionRow[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const versionsUrl = `${options.adminEndpoint}/catalog/business-types/${options.businessTypeId}/versions`;
    const versionUrlBase = `${options.adminEndpoint}/catalog/business-type-versions`;

    function authHeaders(): Record<string, string> {
        const token = options.getAuthToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function fetchJson<T>(url: string, init?: Parameters<HttpClient>[1]): Promise<T | null> {
        const res = await http(url, {
            method: init?.method ?? 'GET',
            headers: { 'content-type': 'application/json', ...authHeaders(), ...init?.headers },
            body: init?.body,
        });
        if (res.status === 204) return null;
        const body = await res.json().catch(() => null);
        if (res.status >= 400) {
            throw new BusinessTypesApiError(
                res.status,
                body,
                `BusinessTypeVersions-API antwortete mit HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchJson<BusinessTypeVersionRow[]>(versionsUrl);
            versions.value = data ?? [];
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function createDraft(
        data: Omit<CreateBusinessTypeVersionDraftData, 'businessTypeId'>,
    ): Promise<BusinessTypeVersionMutationResult> {
        const result = await fetchJson<BusinessTypeVersionMutationResult>(versionsUrl, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!result) throw new BusinessTypesApiError(0, null, 'CreateDraft gab keinen Body zurück');
        versions.value = [...versions.value, result.businessTypeVersion];
        return result;
    }

    async function updateDraft(
        versionId: string,
        data: UpdateBusinessTypeVersionDraftData,
    ): Promise<BusinessTypeVersionMutationResult> {
        const result = await fetchJson<BusinessTypeVersionMutationResult>(
            `${versionUrlBase}/${versionId}`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!result) throw new BusinessTypesApiError(0, null, 'UpdateDraft gab keinen Body zurück');
        versions.value = versions.value.map((v) =>
            v.id === versionId ? result.businessTypeVersion : v,
        );
        return result;
    }

    async function publish(
        versionId: string,
        opts: { forceRegressive?: boolean } = {},
    ): Promise<BusinessTypeVersionMutationResult> {
        const result = await fetchJson<BusinessTypeVersionMutationResult>(
            `${versionUrlBase}/${versionId}/publish`,
            { method: 'POST', body: JSON.stringify(opts) },
        );
        if (!result) throw new BusinessTypesApiError(0, null, 'Publish gab keinen Body zurück');
        await load();
        return result;
    }

    if (options.autoLoad) {
        void load();
    }

    return { versions, loading, error, load, createDraft, updateDraft, publish };
}
