// A list read a page at a time, each page naming the row the next one
// continues after: the first page read again whenever what the list is
// narrowed to changes, later pages added in order. A page read for a list
// that moved on while it was on its way is dropped, and so is a page another
// call already added.

import { computed, shallowRef, type ComputedRef, type Ref } from 'vue';

import { toAdminError, type AdminError } from '../client/admin-error.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';

/** A list read a page at a time. */
export interface PagedList<Row> {
    rows: ComputedRef<Row[]>;
    loading: Ref<boolean>;
    error: Ref<AdminError | null>;
    hasMore: ComputedRef<boolean>;
    reload(): Promise<void>;
    /**
     * Reads the next page and adds it. A page whose list was read anew while
     * it was on its way is dropped, and so is a page another call already added.
     */
    more(): Promise<void>;
}

/** A list read a page at a time, each page naming the row the next one continues after. */
export function usePagedList<Page extends { next: string | null }, Row>(
    read: (after?: string) => Promise<Page>,
    rowsOf: (page: Page) => Row[],
    watchSources: Ref<unknown>[] = [],
): PagedList<Row> & { first: AsyncData<Page | null> } {
    // Replaced whole, never changed in place: a shallow ref is all it needs.
    const later = shallowRef<Page[]>([]);
    // Every read of the first page counts, so a later page can tell whether
    // it still continues the list on screen.
    let firstReads = 0;
    const first = useAsyncData<Page | null>(
        () => {
            firstReads += 1;
            later.value = [];
            return read();
        },
        { initial: null, watch: watchSources },
    );
    const pages = computed(() => (first.data.value ? [first.data.value, ...later.value] : []));
    // Indexed rather than `.at(-1)`: the shipped source compiles at ES2021.
    const nextAfter = (): string | null => pages.value[pages.value.length - 1]?.next ?? null;

    // A button's handler: a failure is shown with the list rather than thrown
    // into nowhere.
    async function more(): Promise<void> {
        const after = nextAfter();
        if (!after) return;
        const asked = firstReads;
        try {
            const page = await read(after);
            if (asked === firstReads && nextAfter() === after) later.value = [...later.value, page];
        } catch (err: unknown) {
            if (asked === firstReads) first.error.value = toAdminError(err);
        }
    }

    return {
        first,
        rows: computed(() => pages.value.flatMap(rowsOf)),
        loading: first.pending,
        error: first.error,
        hasMore: computed(() => nextAfter() !== null),
        reload: first.reload,
        more,
    };
}
