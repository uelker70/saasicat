// useApiList — generic reactive list composable with filter + pagination.
//
// The untyped escape hatch, for an app's own list endpoints: it takes the URL
// per call site, so nothing needs to know the endpoint in advance.
// `useResourceList` is the typed default over the platform's own endpoints,
// which the resource registry already knows the base of.
//
// What both send is one decision and lives in `list-resource.ts` — the query
// string, the page bounds, and how an answer is read. Only the state around it
// differs, and it differs on purpose: this one keeps the last known `total`
// when an answer omits it, and has no guard against a superseded load.

import { ref, watch, type Ref } from 'vue';
import {
    LIST_FIRST_PAGE,
    LIST_PAGE_SIZE_DEFAULT,
    clampListPage,
    clampListPageSize,
    listUrl,
    readListPage,
    type ResourceListPage,
} from '../client/resources/list-resource.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

/**
 * The envelope a list endpoint may answer with.
 *
 * @deprecated Use `ResourceListPage`, which is this shape under the name the
 * resource layer works with. Kept as an alias so an app that typed its own
 * endpoint against it keeps compiling; one shape, one definition.
 */
export type ApiListResponse<T> = ResourceListPage<T>;

export interface UseApiListOptions<TFilter> {
    endpoint: string;
    /**
     * Reactive filter object. The composable serializes it into `?key=value`
     * pairs (with URL encoding); empty/null values are omitted.
     */
    filter?: Ref<TFilter>;
    http?: HttpClient;
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
    const page = ref(LIST_FIRST_PAGE);
    const pageSize = ref(LIST_PAGE_SIZE_DEFAULT);
    const total = ref(0);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    function buildUrl(): string {
        return listUrl(options.endpoint, {
            page: page.value,
            pageSize: pageSize.value,
            filter: options.filter?.value,
        });
    }

    async function load() {
        loading.value = true;
        error.value = null;
        try {
            const headers: Record<string, string> = {};
            const res = await http(buildUrl(), { method: 'GET', headers });
            if (res.status !== 200) {
                throw new Error(`Endpoint ${options.endpoint} → HTTP ${res.status}`);
            }
            // Apps deliver different shapes for list endpoints — a raw array or
            // the `{ items, total, page, pageSize }` envelope — and `readListPage`
            // accepts both, so a correctly delivered array is not shown as an
            // empty list.
            //
            // What the answer did not state is left alone rather than reset: an
            // envelope without `total` keeps the count from the last one that
            // carried it, which is what this composable has always done.
            const body = readListPage<T>(await res.json());
            items.value = body.items;
            if (typeof body.page === 'number') page.value = body.page;
            if (typeof body.pageSize === 'number') pageSize.value = body.pageSize;
            if (typeof body.total === 'number') total.value = body.total;
        } catch (err) {
            error.value = err instanceof Error ? err : new Error(String(err));
            items.value = [];
            total.value = 0;
        } finally {
            loading.value = false;
        }
    }

    async function goToPage(p: number) {
        page.value = clampListPage(p);
        await load();
    }

    async function setPageSize(size: number) {
        pageSize.value = clampListPageSize(size);
        page.value = LIST_FIRST_PAGE;
        await load();
    }

    if (options.filter) {
        watch(
            options.filter,
            () => {
                page.value = LIST_FIRST_PAGE;
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
