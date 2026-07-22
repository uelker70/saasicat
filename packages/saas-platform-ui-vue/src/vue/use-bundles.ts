// useBundles + useBundleVersions — Vue 3 composables for SuperAdmin
// bundle management (backend: BundlesController under
// /admin/catalog/bundles + /admin/catalog/bundle-versions).
//
// **The endpoint prefix is required** and is supplied by the consumer
// (e.g. `/api/admin` or `/api/v1/admin`). The composables append
// the catalog paths themselves — the consumer supplies only the admin prefix.

import { ref, type Ref } from 'vue';
import type {
    BundleRow,
    BundleVersionMutationResult,
    BundleVersionRow,
    CreateBundleData,
    CreateBundleVersionDraftData,
    UpdateBundleData,
    UpdateBundleVersionDraftData,
} from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseBundlesOptions {
    /**
     * Fully-qualified admin endpoint prefix including the app globalPrefix
     * (`/api/admin`, `/api/v1/admin`, …). Required. The composable appends
     * the catalog paths itself (`/catalog/bundles`).
     */
    adminEndpoint: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /** Required: projectKey the list is filtered against. */
    projectKey: string;
    /** When `true`, loads on composable init. Default `false`. */
    autoLoad?: boolean;
}

export class BundlesApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message: string,
    ) {
        super(message);
        this.name = 'BundlesApiError';
    }
}

export interface UseBundlesResult {
    bundles: Ref<BundleRow[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;

    load: () => Promise<void>;
    create: (data: CreateBundleData) => Promise<BundleRow>;
    update: (bundleId: string, data: UpdateBundleData) => Promise<BundleRow>;
    softDelete: (bundleId: string) => Promise<void>;
}

export function useBundles(options: UseBundlesOptions): UseBundlesResult {
    if (!options?.adminEndpoint) {
        throw new Error(
            'useBundles: `adminEndpoint` is required (e.g. "/api/admin" or ' +
                '"/api/v1/admin"). The platform has no default, because apps use ' +
                'different globalPrefix conventions.',
        );
    }
    if (!options?.projectKey) {
        throw new Error('useBundles: `projectKey` is required.');
    }

    const http = options.http ?? defaultHttpClient();
    const bundles = ref<BundleRow[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const baseUrl = `${options.adminEndpoint}/catalog/bundles`;

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
            throw new BundlesApiError(
                res.status,
                body,
                `Bundles API responded with HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchJson<BundleRow[]>(
                `${baseUrl}?projectKey=${encodeURIComponent(options.projectKey)}`,
            );
            bundles.value = data ?? [];
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function create(data: CreateBundleData): Promise<BundleRow> {
        const created = await fetchJson<BundleRow>(baseUrl, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!created) throw new BundlesApiError(0, null, 'Create returned no body');
        bundles.value = [...bundles.value, created];
        return created;
    }

    async function update(bundleId: string, data: UpdateBundleData): Promise<BundleRow> {
        const updated = await fetchJson<BundleRow>(`${baseUrl}/${bundleId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
        if (!updated) throw new BundlesApiError(0, null, 'Update returned no body');
        bundles.value = bundles.value.map((b) => (b.id === bundleId ? updated : b));
        return updated;
    }

    async function softDelete(bundleId: string): Promise<void> {
        await fetchJson<null>(`${baseUrl}/${bundleId}`, { method: 'DELETE' });
        bundles.value = bundles.value.filter((b) => b.id !== bundleId);
    }

    if (options.autoLoad) {
        void load();
    }

    return { bundles, loading, error, load, create, update, softDelete };
}

// =============================================================================
// useBundleVersions — lifecycle operations for a concrete bundle ID
// =============================================================================

export interface UseBundleVersionsOptions {
    adminEndpoint: string;
    bundleId: string;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    autoLoad?: boolean;
}

export interface UseBundleVersionsResult {
    versions: Ref<BundleVersionRow[]>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;

    load: () => Promise<void>;
    /** Returns {row, warnings} — warnings should be shown to the user as a banner. */
    createDraft: (
        data: Omit<CreateBundleVersionDraftData, 'bundleId'>,
    ) => Promise<BundleVersionMutationResult>;
    updateDraft: (
        versionId: string,
        data: UpdateBundleVersionDraftData,
    ) => Promise<BundleVersionMutationResult>;
    publish: (
        versionId: string,
        opts?: {
            forceRegressive?: boolean;
            allowZeroPrice?: boolean;
            validFrom?: string | null;
            validUntil?: string | null;
        },
    ) => Promise<BundleVersionMutationResult>;
    /**
     * Discards a draft (`DELETE /admin/catalog/bundle-versions/:id`).
     * Published versions cannot be discarded — the API responds
     * with 422 `BUNDLE_VERSION_ALREADY_PUBLISHED`.
     */
    discardDraft: (versionId: string) => Promise<void>;
}

export function useBundleVersions(options: UseBundleVersionsOptions): UseBundleVersionsResult {
    if (!options?.adminEndpoint) {
        throw new Error('useBundleVersions: `adminEndpoint` is required.');
    }
    if (!options?.bundleId) {
        throw new Error('useBundleVersions: `bundleId` is required.');
    }

    const http = options.http ?? defaultHttpClient();
    const versions = ref<BundleVersionRow[]>([]);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    const bundleVersionsUrl = `${options.adminEndpoint}/catalog/bundles/${options.bundleId}/versions`;
    const versionUrlBase = `${options.adminEndpoint}/catalog/bundle-versions`;

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
            throw new BundlesApiError(
                res.status,
                body,
                `BundleVersions API responded with HTTP ${res.status}`,
            );
        }
        return body as T;
    }

    async function load(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const data = await fetchJson<BundleVersionRow[]>(bundleVersionsUrl);
            versions.value = data ?? [];
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    async function createDraft(
        data: Omit<CreateBundleVersionDraftData, 'bundleId'>,
    ): Promise<BundleVersionMutationResult> {
        const result = await fetchJson<BundleVersionMutationResult>(bundleVersionsUrl, {
            method: 'POST',
            body: JSON.stringify(data),
        });
        if (!result) throw new BundlesApiError(0, null, 'CreateDraft returned no body');
        versions.value = [...versions.value, result.bundleVersion];
        return result;
    }

    async function updateDraft(
        versionId: string,
        data: UpdateBundleVersionDraftData,
    ): Promise<BundleVersionMutationResult> {
        const result = await fetchJson<BundleVersionMutationResult>(
            `${versionUrlBase}/${versionId}`,
            { method: 'PATCH', body: JSON.stringify(data) },
        );
        if (!result) throw new BundlesApiError(0, null, 'UpdateDraft returned no body');
        versions.value = versions.value.map((v) => (v.id === versionId ? result.bundleVersion : v));
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
    ): Promise<BundleVersionMutationResult> {
        const result = await fetchJson<BundleVersionMutationResult>(
            `${versionUrlBase}/${versionId}/publish`,
            { method: 'POST', body: JSON.stringify(opts) },
        );
        if (!result) throw new BundlesApiError(0, null, 'Publish returned no body');
        // Reload versions, because publishing may mark another version as
        // superseded — the local cache would otherwise be inconsistent.
        await load();
        return result;
    }

    async function discardDraft(versionId: string): Promise<void> {
        await fetchJson<null>(`${versionUrlBase}/${versionId}`, { method: 'DELETE' });
        versions.value = versions.value.filter((v) => v.id !== versionId);
    }

    if (options.autoLoad) {
        void load();
    }

    return { versions, loading, error, load, createDraft, updateDraft, publish, discardDraft };
}
