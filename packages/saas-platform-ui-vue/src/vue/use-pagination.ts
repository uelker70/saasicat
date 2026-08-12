import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

// Client-side paging for a list that is already fully loaded.
//
// Most admin lists fetch everything and filter in the browser; without this
// they would each carry the same three lines of `slice()` plus the same
// off-the-end guard. Lists that page on the server (see `useApiList`) bind
// AdminPaginator to their own state instead and do not need this.

/** Quasar's convention: 0 rows per page means no paging at all. */
export const ALL_ROWS = 0;

/** Starting page size for every list; AdminPaginator restores a stored one. */
export const DEFAULT_ROWS_PER_PAGE = 10;

/** The sizes a locally paged list offers, in order. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, ALL_ROWS] as const;

/**
 * The same without "all". A server-paged list cannot honour it: the admin API
 * caps `pageSize` at 200 and falls back to 50 when it is omitted, so the
 * option would claim to show everything while showing the first fifty.
 */
export const SERVER_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface UsePaginationResult<T> {
    page: Ref<number>;
    rowsPerPage: Ref<number>;
    /** Total across all pages — what AdminPaginator counts with. */
    total: ComputedRef<number>;
    /** The slice to render. */
    pagedRows: ComputedRef<T[]>;
}

export function usePagination<T>(
    rows: Ref<readonly T[]> | ComputedRef<readonly T[]>,
    initialRowsPerPage = DEFAULT_ROWS_PER_PAGE,
): UsePaginationResult<T> {
    const page = ref(1);
    const rowsPerPage = ref(initialRowsPerPage);

    const total = computed(() => rows.value.length);

    const pageCount = computed(() =>
        rowsPerPage.value === ALL_ROWS
            ? 1
            : Math.max(1, Math.ceil(total.value / rowsPerPage.value)),
    );

    // Filtering can shrink a list under the current page — without this the
    // table would render an empty slice and look like it lost its rows.
    watch(pageCount, (count) => {
        if (page.value > count) page.value = count;
    });

    const pagedRows = computed(() => {
        if (rowsPerPage.value === ALL_ROWS) return [...rows.value];
        const start = (page.value - 1) * rowsPerPage.value;
        return rows.value.slice(start, start + rowsPerPage.value);
    });

    return { page, rowsPerPage, total, pagedRows };
}
