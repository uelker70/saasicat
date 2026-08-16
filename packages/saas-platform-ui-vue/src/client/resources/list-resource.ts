// What a paginated admin list asks for, and what it gets back.
//
// One decision, written once. `useApiList` assembles `?page=…&pageSize=…` plus
// the filter, `createAdminResourceClient` assembles the filter half of the same
// thing for the endpoints that do not page, and every list descriptor would
// have been a third and fourth expression of it. They agreed by coincidence
// rather than by construction: three copies of "an empty value is omitted" is
// three chances for one of them to start sending `status=null` and filter every
// row away.
//
// Framework-free like the rest of `src/client/`: a URL, a body shape and the
// arithmetic around the page number. The reactive half — refs, watchers, the
// two controls — is `useResourceList`'s.

import type { ResourceContext, ResourceOp } from './define-resource.js';
import { requestJson } from './resource-request.js';

/** 1-based: the page a list starts on, and the one a changed filter returns to. */
export const LIST_FIRST_PAGE = 1;

/**
 * What the admin API falls back to when `pageSize` is absent. Sent explicitly
 * rather than relied on, so the URL states what it asked for.
 */
export const LIST_PAGE_SIZE_DEFAULT = 50;

/**
 * The largest page the admin API serves. There is no "all" to pass on, which is
 * why `SERVER_PAGE_SIZE_OPTIONS` leaves Quasar's `ALL_ROWS` out as well.
 */
export const LIST_PAGE_SIZE_MAX = 200;

/** The two parameters the pagination owns; a filter may not carry them. */
export const LIST_PAGINATION_PARAMS = ['page', 'pageSize'] as const;

/**
 * A filter without the two keys the pagination owns.
 *
 * The platform's filter types (`TenantListFilter`, `AuditQuery`) declare
 * `page` and `pageSize` because they were once passed as one object. Serialised
 * after the pagination they silently overwrite it — `goToPage(3)` moves the ref
 * while the request asks for page 7 — so a descriptor takes the filter without
 * them and the page number travels in its own field.
 */
export type ListFilterOf<TFilter> = Omit<TFilter, 'page' | 'pageSize'>;

/** Everything one list request varies: which page, how big, filtered by what. */
export interface ListQuery<TFilter extends object = Record<string, unknown>> {
    /** 1-based. Defaults to `LIST_FIRST_PAGE`. */
    page?: number;
    /** Defaults to `LIST_PAGE_SIZE_DEFAULT`. */
    pageSize?: number;
    /** Serialised as `?key=value`; see `isSentInQuery` for what is left out. */
    filter?: TFilter;
}

/**
 * One page of a list, as the admin API answers it.
 *
 * `total` is optional because it is genuinely absent from some answers: a
 * controller returning a bare array has reported the rows it sent and nothing
 * about the rest, and an envelope may omit the field altogether. A number
 * invented here would read as "rows matching the filter" under a paginator that
 * then offers pages nobody can reach.
 */
export interface ResourceListPage<T> {
    items: T[];
    /** Rows matching the filter — only when the server said so. */
    total?: number;
    /** What the server echoed back about the page it served, when it echoed anything. */
    page?: number;
    pageSize?: number;
}

/** A list operation: the query in, one page out. */
export type ListOp<TRow, TFilter extends object = Record<string, unknown>> = ResourceOp<
    [query?: ListQuery<TFilter>],
    ResourceListPage<TRow>
>;

/**
 * Whether a filter value reaches the query string at all.
 *
 * `undefined`, `null` and `''` are the three spellings of "not filtered" that
 * a form produces, and sending them would filter on the literal text `null`.
 * Everything else goes as `String(value)` — including `0` and `false`, which
 * are answers, not absences.
 */
export function isSentInQuery(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
}

function appendFilter(params: URLSearchParams, filter: object | undefined): void {
    for (const [key, value] of Object.entries(filter ?? {})) {
        if (!isSentInQuery(value)) continue;
        params.set(key, String(value));
    }
}

/**
 * `?a=b` for a filter on its own, or `''` when nothing survives — the form the
 * admin endpoints that do not page take their filter in.
 */
export function filterQueryString(filter: object): string {
    const params = new URLSearchParams();
    appendFilter(params, filter);
    const query = params.toString();
    return query ? `?${query}` : '';
}

/**
 * The URL one page of a list is requested from.
 *
 * `page` and `pageSize` are always present and always first — an endpoint that
 * ignores them is free to, but the request says which page it meant. The filter
 * follows in its own insertion order, and the endpoint may already carry a
 * query of its own.
 */
export function listUrl<TFilter extends object>(
    endpoint: string,
    query: ListQuery<TFilter> = {},
): string {
    const params = new URLSearchParams();
    params.set('page', String(query.page ?? LIST_FIRST_PAGE));
    params.set('pageSize', String(query.pageSize ?? LIST_PAGE_SIZE_DEFAULT));
    appendFilter(params, query.filter);
    return `${endpoint}${endpoint.includes('?') ? '&' : '?'}${params.toString()}`;
}

/**
 * Reads whatever a list endpoint answered into one page.
 *
 * Both shapes are real: some controllers return a bare array, others the
 * `{ items, page, pageSize, total }` envelope. Accepting only the envelope is
 * what once rendered three tenants as an empty table (see
 * `use-api-list-shape.test.js`). What the answer did not state stays absent
 * rather than being filled in — the caller decides what "no total" means for
 * its paginator.
 */
export function readListPage<T>(raw: unknown): ResourceListPage<T> {
    if (Array.isArray(raw)) return { items: raw as T[], total: raw.length };
    if (raw === null || typeof raw !== 'object') return { items: [], total: 0 };
    const body = raw as { items?: unknown; total?: unknown; page?: unknown; pageSize?: unknown };
    const page: ResourceListPage<T> = {
        items: Array.isArray(body.items) ? (body.items as T[]) : [],
    };
    if (typeof body.total === 'number') page.total = body.total;
    if (typeof body.page === 'number') page.page = body.page;
    if (typeof body.pageSize === 'number') page.pageSize = body.pageSize;
    return page;
}

/** Keeps a requested page on the 1-based scale the API counts on. */
export function clampListPage(page: number): number {
    return Math.max(LIST_FIRST_PAGE, Math.floor(page));
}

/** Keeps a requested page size inside the 1..`LIST_PAGE_SIZE_MAX` the API serves. */
export function clampListPageSize(size: number): number {
    return Math.min(LIST_PAGE_SIZE_MAX, Math.max(1, Math.floor(size)));
}

/**
 * A list operation over one endpoint: the second of a pair, and the reason it
 * is a function rather than two hand-written descriptors.
 *
 * The endpoint is a function of the context so a `context` override on the
 * registry — an app pointing one resource at a legacy base — reaches it without
 * the descriptor knowing.
 */
export function defineListOp<TRow, TFilter extends object = Record<string, unknown>>(
    endpoint: (ctx: ResourceContext) => string,
): ListOp<TRow, TFilter> {
    return async (http, ctx, query) =>
        readListPage<TRow>(await requestJson(http, listUrl(endpoint(ctx), query)));
}
