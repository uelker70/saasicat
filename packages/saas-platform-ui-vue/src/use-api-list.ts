// useApiList — generischer Reactive-List-Composable mit Filter + Pagination.
//
// Konsumenten-Komponenten ($-table, $-list, …) konsumieren die typisierten
// Wrapper (`useTenants`, `useAuditEntries`, …); diese basieren auf
// `useApiList`. Direkte Verwendung ist auch erlaubt für custom Endpoints.

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
     * Reaktiver Filter-Object. Composable serialisiert das in `?key=value`-
     * Pairs (mit URL-Encoding); leere/null-Werte werden weggelassen.
     */
    filter?: Ref<TFilter>;
    http?: HttpClient;
    getAuthToken?: () => string | null;
    /**
     * Bei `true` wird beim Mount automatisch geladen. Default `true`.
     * Auf `false` setzen, wenn der Konsument den ersten Load explizit
     * triggern will (z. B. nach Auth-State-Init).
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
    /** Lädt frisch (z. B. nach Mutation). */
    reload: () => Promise<void>;
    /** Springt auf eine konkrete Seite (1-basiert) und lädt. */
    goToPage: (page: number) => Promise<void>;
    /** Wechselt die Seitengröße und springt auf Seite 1. */
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
            // Apps liefern unterschiedliche Shapes für Listen-Endpoints:
            //   - rohes Array `[{...}, …]` (kein Wrapper).
            //   - paginated: `{ items, total, page, pageSize }`.
            // Plattform-Composable akzeptiert beide — sonst würden korrekt
            // gelieferte Array-Antworten als leere Liste angezeigt.
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
        // Mikrotask später, damit das Composable in `setup()` nicht
        // in der Initial-Sync-Phase blockt.
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
