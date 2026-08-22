// One page of a platform list, typed, with no endpoint to pass in.
//
// The difference from `useApiList` is where the URL comes from. `useApiList`
// takes the endpoint per call site, which is why every page built on it carries
// an `endpoint` prop and every consumer app spells the same path again — and
// why the row type is whatever the caller claims. This asks the resource
// registry, which already knows the API base, the project and the locale, and
// the row type follows from the operation rather than from an assertion.
//
// It adds exactly one thing to `useAsyncData`: the pagination — two refs and
// the two controls that move them. The in-flight flag, the error, the reset to
// `initial` on failure, and the generation guard that keeps a superseded load
// from overwriting a newer one are all `useAsyncData`'s, deliberately not
// rewritten here. That last one is not cosmetic: `useApiList` has no such
// guard, so two quick filter keystrokes there can land the loser last.
//
// `useApiList` stays as the untyped escape hatch for an app's own endpoints.

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

import { AdminError } from '../client/admin-error.js';
import type { ResourceOps } from '../client/resources/define-resource.js';
import type { PlatformResources } from '../client/resources/index.js';
import {
    LIST_FIRST_PAGE,
    LIST_PAGE_SIZE_DEFAULT,
    LIST_PAGINATION_PARAMS,
    clampListPage,
    clampListPageSize,
    isSentInQuery,
    type ListQuery,
    type ResourceListPage,
} from '../client/resources/list-resource.js';
import { useAsyncData } from './use-async-data.js';
import { useResource, type ResourceMap, type ResourceOverride } from './resource-registry.js';

/** The default operation name, and the only one the platform resources offer. */
const DEFAULT_LIST_OP = 'list';

/**
 * The state before the first load and after a failed one.
 *
 * Frozen and shared: `useAsyncData` restores this exact object, so a page that
 * pushed into it would be pushing into every other list's empty state. Frozen,
 * that is a thrown error instead of a row appearing somewhere else.
 */
const EMPTY_PAGE = Object.freeze({
    items: Object.freeze([]) as readonly never[],
    total: 0,
}) as ResourceListPage<never>;

/** The operations of a resource that answer with one page of a list. */
export type ListOpNames<TOps extends ResourceOps> = {
    [N in keyof TOps]: Awaited<ReturnType<TOps[N]>> extends ResourceListPage<unknown> ? N : never;
}[keyof TOps];

/**
 * The resources that have such an operation at all.
 *
 * Without this, `useResourceList('plans')` compiled: `plans.list` answers with
 * a plain `PlanRow[]`, the row type collapsed to `never`, and the first thing
 * to notice was `items.value` being `undefined` at runtime. Derived from the
 * operations rather than listed, so a resource that grows a list operation
 * becomes available here by being written, not by being remembered.
 */
export type ListResourceKey<TMap extends ResourceMap> = {
    [K in keyof TMap]: [ListOpNames<TMap[K]['ops']>] extends [never] ? never : K;
}[keyof TMap];

/**
 * The row type a named list operation yields — read off the operation, not
 * declared next to it. A hand-maintained map of resource to row is the same
 * defect one level up: it can be right today and silently wrong tomorrow.
 */
export type RowOf<TOps extends ResourceOps, N extends keyof TOps> =
    Awaited<ReturnType<TOps[N]>> extends ResourceListPage<infer TRow> ? TRow : never;

/** A paginated read: what a standard admin list binds its table to. */
export interface AsyncList<T> {
    /** The rows of the current page. */
    items: ComputedRef<T[]>;
    /**
     * Rows matching the filter when the endpoint reports a total, and rows on
     * this page when it does not. Several admin controllers answer with a bare
     * array, and there is no honest way to tell the two apart afterwards — see
     * `ResourceListPage.total`.
     */
    total: ComputedRef<number>;
    /** 1-based. Moved by `goToPage`, and reset to 1 by a filter change. */
    page: Ref<number>;
    pageSize: Ref<number>;
    /**
     * True while a load is in flight. Named as in `useAsyncData` and
     * `useAsyncAction`, whose flag this is — `useApiList` calls its own
     * `loading`.
     */
    pending: Ref<boolean>;
    /** The last failure, or `null`. Cleared at the start of every load. */
    error: Ref<AdminError | null>;
    /** Loads the current page again — after a mutation, or from a retry button. */
    reload: () => Promise<void>;
    /** Jumps to a page (1-based, clamped) and loads. */
    goToPage: (page: number) => Promise<void>;
    /** Changes the page size, returns to page 1, and loads. */
    setPageSize: (size: number) => Promise<void>;
}

export interface UseResourceListOptions<TOps extends ResourceOps, N extends ListOpNames<TOps>> {
    /**
     * Override the resource for this list only, layered over the app's own.
     * The page-level counterpart of `useResource(key, override)`.
     */
    resources?: ResourceOverride<TOps>;
    /** Which operation to page through. Defaults to `list`. */
    op?: N;
    /**
     * Reactive filter. A change returns to page 1 and reloads — a filter that
     * narrows the list while the operator is on page 4 would otherwise ask for
     * a page that no longer exists and render nothing.
     *
     * `page` and `pageSize` are not filter keys; see the guard below.
     */
    filter?: Ref<Record<string, unknown>>;
    /**
     * Rows per page to start with. Defaults to `LIST_PAGE_SIZE_DEFAULT`.
     *
     * Here rather than through `setPageSize` after construction, which is what
     * a page with a `pageSize` prop had to do: `setPageSize` loads, and the
     * first load was already queued, so the list fetched the same rows twice on
     * every mount.
     */
    pageSize?: number;
    /** Load once on creation. Default `true`. */
    immediate?: boolean;
}

/**
 * The failure for a filter that carries the pagination's own parameters.
 *
 * An `AdminError` with a diagnostic `message` and no `detail`, because the two
 * are not the same thing: `message` is for the log, and leaving `detail` unset
 * is what lets `adminErrorMessage` answer an operator with its translated
 * wording instead of an English sentence about a filter key.
 */
function paginationCollision(key: string, op: string, claimed: string[]): AdminError {
    return new AdminError({
        message:
            `useResourceList("${key}", { op: "${op}" }): the filter carries ` +
            `${claimed.join(' and ')}, which the list already sends. The filter is serialised ` +
            `after the pagination, so its value wins on the wire while page.value keeps the ` +
            `one goToPage() set — the list would report a page it is not showing. Drive the ` +
            `page with goToPage()/setPageSize() and leave those keys out of the filter.`,
    });
}

/** The pagination keys a filter is currently sending, if any. */
function paginationKeysIn(filter: Record<string, unknown>): string[] {
    return LIST_PAGINATION_PARAMS.filter((param) => isSentInQuery(filter[param]));
}

/**
 * The named operation, or a failure that says what the resource does offer.
 *
 * An own-property check rather than an indexed read: indexing walks the
 * prototype chain, so `op: 'toString'` would find `Object.prototype`'s and call
 * it. The registry documents the same trap for overrides, where a typo failed
 * loudly while a prototype name passed silently.
 *
 * `hasOwnProperty.call` rather than `Object.hasOwn`, which is ES2022 — this
 * file is reachable from `pages/*`, which ships as source.
 */
function readListOp<TRow>(
    key: string,
    ops: object,
    name: string,
): (query: ListQuery) => Promise<ResourceListPage<TRow>> {
    const op = Object.prototype.hasOwnProperty.call(ops, name)
        ? (ops as Record<string, unknown>)[name]
        : undefined;
    if (typeof op !== 'function') {
        throw new Error(
            `useResourceList("${key}", { op: "${name}" }): that resource has no such ` +
                `operation. It offers: ${Object.keys(ops).join(', ')}.`,
        );
    }
    return op as (query: ListQuery) => Promise<ResourceListPage<TRow>>;
}

export function useResourceList<
    K extends ListResourceKey<TMap> & keyof TMap & string,
    TMap extends ResourceMap = PlatformResources,
    N extends ListOpNames<TMap[K]['ops']> = ListOpNames<TMap[K]['ops']>,
>(key: K, opts?: UseResourceListOptions<TMap[K]['ops'], N>): AsyncList<RowOf<TMap[K]['ops'], N>> {
    type Row = RowOf<TMap[K]['ops'], N>;

    const ops = useResource<K, TMap>(key, opts?.resources);
    const opName = (opts?.op ?? DEFAULT_LIST_OP) as string;
    const load = readListOp<Row>(key, ops as object, opName);

    // Once, synchronously, so the ordinary case — a filter type that still
    // declares `page` — fails where it is written rather than on the first
    // load. The per-load check below covers a filter that gains the key later.
    if (opts?.filter) {
        const claimed = paginationKeysIn(opts.filter.value);
        if (claimed.length > 0) throw paginationCollision(key, opName, claimed);
    }

    const page = ref(LIST_FIRST_PAGE);
    const pageSize = ref(clampListPageSize(opts?.pageSize ?? LIST_PAGE_SIZE_DEFAULT));

    function query(): ListQuery {
        const filter = opts?.filter?.value;
        if (filter) {
            const claimed = paginationKeysIn(filter);
            if (claimed.length > 0) throw paginationCollision(key, opName, claimed);
        }
        return { page: page.value, pageSize: pageSize.value, filter };
    }

    const state = useAsyncData<ResourceListPage<Row>>(() => load(query()), {
        initial: EMPTY_PAGE,
        immediate: opts?.immediate,
    });

    // The server decides which page it served, and says so. Asking for page 99
    // of a list that has two returns page 2, and the next request has to ask
    // for the page being shown — otherwise `reload` asks for 99 again while the
    // paginator reads "99 of 1" over the rows of page 2. `useApiList` adopts
    // the echo for the same reason; the descriptor carries it and this was the
    // only reader that dropped it.
    //
    // Adopted from `state.data` rather than from inside the loader, because
    // only the load that won writes there. Doing it in the loader put the
    // assignment ahead of the generation check: two overlapping navigations
    // then discarded the stale rows but kept the stale echo, leaving page 2's
    // rows under a paginator reading 3 and a reload aimed at 3.
    //
    // An answer that says nothing about the page leaves the requested one
    // standing. Silence is not a statement about what was served, and moving
    // the paginator from it would move it on its own.
    watch(state.data, (answer) => {
        if (typeof answer.page === 'number') page.value = answer.page;
        if (typeof answer.pageSize === 'number') pageSize.value = answer.pageSize;
    });

    async function goToPage(next: number): Promise<void> {
        page.value = clampListPage(next);
        await state.reload();
    }

    async function setPageSize(size: number): Promise<void> {
        pageSize.value = clampListPageSize(size);
        page.value = LIST_FIRST_PAGE;
        await state.reload();
    }

    if (opts?.filter) {
        // Deep, and the page reset happens before the reload. `useAsyncData`'s
        // own `watch` option is neither — it is a plain watch that calls
        // `reload` — so the watcher lives here rather than being passed down.
        watch(
            opts.filter,
            () => {
                page.value = LIST_FIRST_PAGE;
                void state.reload();
            },
            { deep: true },
        );
    }

    return {
        items: computed(() => state.data.value.items),
        total: computed(() => state.data.value.total ?? state.data.value.items.length),
        page,
        pageSize,
        pending: state.pending,
        error: state.error,
        reload: state.reload,
        goToPage,
        setPageSize,
    };
}
