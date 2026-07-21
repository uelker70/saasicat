// useApiList — generic reactive list composable with filter + pagination.
//
// Consumer components ($-table, $-list, …) consume the typed wrappers
// (`useTenants`, `useAuditEntries`, …), which are based on `useApiList`.
// Direct use is also allowed for custom endpoints.

import { ref, watch, type Ref } from 'vue';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface ApiListResponse<T> {
    items: T[];
    page?: number;
    pageSize?: number;
    total?: number;
}

export interface UseApiListOptions<TFilter> {
    endpoint: string;
    /**
     * Reactive filter object. The composable serializes it into `?key=value`
     * pairs (with URL encoding); empty/null values are omitted.
     */
    filter?: Ref<TFilter>;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /**
     * When `true`, loads automatically on mount. Defaults to `true`.
     * Set to `false` when the consumer wants to trigger the first load
     * explicitly (e.g. after auth-state init).
     */
    autoLoad?: boolean;
}

export interface UseApiListResult<T> {
    items: Ref<T[]>;
    page: Ref<number>;
    pageSize: Ref<number>;
    total: Ref<number>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** Reloads fresh (e.g. after a mutation). */
    reload: () => Promise<void>;
    /** Jumps to a specific page (1-based) and loads. */
    goToPage: (page: number) => Promise<void>;
    /** Changes the page size and jumps to page 1. */
    setPageSize: (size: number) => Promise<void>;
}

export function useApiList<T, TFilter extends Record<string, unknown> = Record<string, unknown>>(
    options: UseApiListOptions<TFilter>,
): UseApiListResult<T> {
    const http = options.http ?? defaultHttpClient();
    const items = ref<T[]>([]) as Ref<T[]>;
    const page = ref(1);
    const pageSize = ref(50);
    const total = ref(0);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    function buildUrl(): string {
        const params = new URLSearchParams();
        params.set('page', String(page.value));
        params.set('pageSize', String(pageSize.value));
        const f = options.filter?.value ?? ({} as TFilter);
        for (const [k, v] of Object.entries(f)) {
            if (v === undefined || v === null || v === '') continue;
            params.set(k, String(v));
        }
        const sep = options.endpoint.includes('?') ? '&' : '?';
        return `${options.endpoint}${sep}${params.toString()}`;
    }

    async function load() {
        loading.value = true;
        error.value = null;
        try {
            const headers: Record<string, string> = {};
            const token = options.getAuthToken?.();
            if (token) headers.Authorization = `Bearer ${token}`;
            const res = await http(buildUrl(), { method: 'GET', headers });
            if (res.status !== 200) {
                throw new Error(`Endpoint ${options.endpoint} → HTTP ${res.status}`);
            }
            // Apps deliver different shapes for list endpoints:
            //   - raw array `[{...}, …]` (no wrapper).
            //   - paginated: `{ items, total, page, pageSize }`.
            // The platform composable accepts both — otherwise correctly
            // delivered array responses would be shown as an empty list.
            const raw = (await res.json()) as unknown;
            if (Array.isArray(raw)) {
                items.value = raw as T[];
                total.value = raw.length;
            } else if (raw !== null && typeof raw === 'object') {
                const body = raw as ApiListResponse<T>;
                items.value = body.items ?? [];
                if (typeof body.page === 'number') page.value = body.page;
                if (typeof body.pageSize === 'number') pageSize.value = body.pageSize;
                if (typeof body.total === 'number') total.value = body.total;
            } else {
                items.value = [];
                total.value = 0;
            }
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
            items.value = [];
            total.value = 0;
        } finally {
            loading.value = false;
        }
    }

    async function goToPage(p: number) {
        page.value = Math.max(1, Math.floor(p));
        await load();
    }

    async function setPageSize(size: number) {
        pageSize.value = Math.max(1, Math.floor(size));
        page.value = 1;
        await load();
    }

    if (options.filter) {
        watch(
            options.filter,
            () => {
                page.value = 1;
                void load();
            },
            { deep: true },
        );
    }

    if (options.autoLoad !== false) {
        // One microtask later, so the composable does not block `setup()`
        // during the initial sync phase.
        Promise.resolve().then(() => void load());
    }

    return {
        items,
        page,
        pageSize,
        total,
        loading,
        error,
        reload: load,
        goToPage,
        setPageSize,
    };
}
