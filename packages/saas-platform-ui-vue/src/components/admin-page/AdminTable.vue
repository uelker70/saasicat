<template>
    <div class="sa-table">
        <q-table
            v-model:pagination="pagination"
            flat
            hide-pagination
            :rows="rows"
            :columns="allColumns"
            :row-key="rowKey"
            :loading="loading"
            :rows-number="serverSide ? total : undefined"
        >
            <!-- Cell and header slots stay the page's business; only the
                 actions column is ours. -->
            <template v-for="name in passedSlots" #[name]="slotProps" :key="name">
                <slot :name="name" v-bind="slotProps ?? {}" />
            </template>

            <template v-if="$slots['row-actions']" #body-cell-actions="cell">
                <q-td :props="cell" class="sa-table__actions">
                    <slot name="row-actions" :row="cell.row" />
                </q-td>
            </template>

            <template #no-data>
                <slot name="no-data">
                    <span class="sa-table__empty">{{ emptyText ?? common.noData }}</span>
                </slot>
            </template>
        </q-table>

        <div class="sa-table__foot">
            <AdminPaginator
                :page="pagerPage"
                :rows-per-page="pagerRowsPerPage"
                :total="serverSide ? total : rows.length"
                :storage-key="storageKey"
                :page-sizes="offeredPageSizes"
                @update:page="onPageChange"
                @update:rows-per-page="onRowsPerPageChange"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, useSlots, watch } from 'vue';
import type { QTableColumn } from 'quasar';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import {
    ALL_ROWS,
    DEFAULT_ROWS_PER_PAGE,
    PAGE_SIZE_OPTIONS,
    SERVER_PAGE_SIZE_OPTIONS,
} from '../../vue/use-pagination.js';
import AdminPaginator from './AdminPaginator.vue';

// Every list in the admin. Nine pages used to reach for `q-table` directly and
// agreed on nothing: what a header looks like, where actions sit, whether
// there was a pager at all.
//
// Sorting and paging live together here on purpose. A page that sliced its own
// rows and handed the slice to a table would have that table sort the slice —
// so "sort by name" would order the ten rows that happened to be on screen,
// not the list. Here QTable holds every row and does both, in that order.
//
// The actions column is added by this component rather than declared by the
// page: it is always last, always right-aligned, and it only exists when a
// page fills `row-actions`.

const ACTIONS_COLUMN = 'actions';
/** Handled here, so they must not be forwarded to QTable as-is. */
const OWN_SLOTS = new Set(['row-actions', 'no-data']);

const props = withDefaults(
    defineProps<{
        rows: readonly Record<string, unknown>[];
        columns: QTableColumn[];
        rowKey?: string;
        loading?: boolean;
        emptyText?: string;
        /** Remembers the page size per list; omit to keep it for the visit. */
        storageKey?: string;
        /**
         * The rows are one server page already. QTable then renders them as
         * given instead of slicing again, and the page owns page and size.
         */
        serverSide?: boolean;
        page?: number;
        rowsPerPage?: number;
        /** Rows across all pages. Required with `serverSide`. */
        total?: number;
    }>(),
    { rowKey: 'id', loading: false, serverSide: false, total: 0 },
);

const emit = defineEmits<{
    (e: 'update:page', page: number): void;
    (e: 'update:rowsPerPage', rows: number): void;
}>();

const slots = useSlots();
const common = useSaMessages('common');

const passedSlots = computed(() => Object.keys(slots).filter((name) => !OWN_SLOTS.has(name)));

const allColumns = computed<QTableColumn[]>(() =>
    slots['row-actions']
        ? [
              ...props.columns,
              { name: ACTIONS_COLUMN, label: '', field: ACTIONS_COLUMN, align: 'right' },
          ]
        : props.columns,
);

// QTable's own pagination object carries the sort as well as the page, which
// is why it is one ref rather than two props: `sortBy` and `descending` are
// nobody else's business, while page and size belong to the pager.
//
// A server-paged list is handed exactly one page of rows, so QTable must not
// page on top of that — it would hide rows the server already narrowed to.
// There, `rowsPerPage: 0` means "render what you were given" and the real size
// lives with the page.
const pagination = ref({
    page: props.serverSide ? (props.page ?? 1) : 1,
    rowsPerPage: props.serverSide ? ALL_ROWS : DEFAULT_ROWS_PER_PAGE,
    sortBy: null as string | null,
    descending: false,
});

/** What the pager shows: the server's size, or the one QTable slices by. */
const pagerRowsPerPage = computed(() =>
    props.serverSide ? (props.rowsPerPage ?? DEFAULT_ROWS_PER_PAGE) : pagination.value.rowsPerPage,
);

const offeredPageSizes = computed(() =>
    props.serverSide ? [...SERVER_PAGE_SIZE_OPTIONS] : [...PAGE_SIZE_OPTIONS],
);

const pagerPage = computed(() => (props.serverSide ? (props.page ?? 1) : pagination.value.page));

// Filtering can shrink a list under the current page; without this the table
// renders an empty slice and looks like it lost its rows.
const pageCount = computed(() => {
    const size = pagination.value.rowsPerPage;
    if (props.serverSide || size === ALL_ROWS) return 1;
    return Math.max(1, Math.ceil(props.rows.length / size));
});

watch(pageCount, (count) => {
    if (pagination.value.page > count) pagination.value.page = count;
});

function onPageChange(page: number): void {
    if (!props.serverSide) pagination.value.page = page;
    emit('update:page', page);
}

function onRowsPerPageChange(rows: number): void {
    if (!props.serverSide) {
        pagination.value.rowsPerPage = rows;
        pagination.value.page = 1;
    }
    emit('update:rowsPerPage', rows);
    emit('update:page', 1);
}
</script>
