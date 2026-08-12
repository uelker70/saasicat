<template>
    <nav class="sa-paginator" :aria-label="msg.paginator.label">
        <span class="sa-paginator__size-label">{{ msg.paginator.rowsPerPage }}</span>
        <q-select
            class="sa-paginator__select"
            :model-value="rowsPerPage"
            :options="sizeOptions"
            :aria-label="msg.paginator.rowsPerPage"
            dense
            outlined
            emit-value
            map-options
            @update:model-value="onSizeChange"
        />

        <button
            class="sa-paginator__step"
            type="button"
            :disabled="page <= 1"
            :aria-label="msg.paginator.previous"
            @click="goTo(page - 1)"
        >
            <q-icon name="chevron_left" size="18px" />
        </button>

        <input
            v-if="editing"
            ref="pageInput"
            v-model="draft"
            class="sa-paginator__input"
            type="number"
            inputmode="numeric"
            :min="1"
            :max="pageCount"
            :aria-label="pageInputLabel"
            @keydown.enter="commit"
            @keydown.escape="cancel"
            @blur="commit"
        />
        <button
            v-else
            class="sa-paginator__page"
            type="button"
            :disabled="pageCount <= 1"
            @click="startEdit"
        >
            {{ pageLabel }}
        </button>

        <button
            class="sa-paginator__step"
            type="button"
            :disabled="page >= pageCount"
            :aria-label="msg.paginator.next"
            @click="goTo(page + 1)"
        >
            <q-icon name="chevron_right" size="18px" />
        </button>
    </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
// Imported, not redeclared: `withDefaults` hoists its defaults out of setup(),
// so a local const cannot be referenced there — and the sizes belong with the
// composable that slices by them anyway.
import { ALL_ROWS, PAGE_SIZE_OPTIONS } from '../../vue/use-pagination.js';

// The pager below a list. One control for every list in the admin, so a page
// contributes how many rows it has and which page it is on — never how paging
// looks or where it sits.
//
// The page indicator doubles as its own input: clicking it turns "Page 3/9"
// into a number field. That keeps a long list reachable without a row of page
// buttons whose width depends on the number of pages.
//
// `rowsPerPage` follows Quasar's convention where 0 means "all", so a page can
// hand this straight to a QTable's pagination object.

const STORAGE_PREFIX = 'saasicat.rowsPerPage.';

const props = withDefaults(
    defineProps<{
        page: number;
        rowsPerPage: number;
        /** Total rows across all pages, not the rows on this one. */
        total: number;
        /** Ordered page sizes; 0 renders as "all". */
        pageSizes?: readonly number[];
        /**
         * Remembers the chosen size under this key. One key per list, not per
         * page: a detail page with two tables would otherwise have them
         * overwrite each other. Omit to keep the size for the visit only.
         */
        storageKey?: string;
    }>(),
    { pageSizes: () => [...PAGE_SIZE_OPTIONS] },
);

const emit = defineEmits<{
    (e: 'update:page', page: number): void;
    (e: 'update:rowsPerPage', rows: number): void;
}>();

const msg = useSaMessages('common');

// A page may start on a size that is not in the list (its own default); it is
// merged in rather than silently snapped to the nearest offered one.
const sizeOptions = computed(() => {
    const sizes = props.pageSizes.includes(props.rowsPerPage)
        ? [...props.pageSizes]
        : [...props.pageSizes, props.rowsPerPage].sort((a, b) => a - b);
    return sizes.map((size) => ({
        value: size,
        label: size === ALL_ROWS ? msg.value.paginator.all : String(size),
    }));
});

const pageCount = computed(() => {
    if (props.rowsPerPage === ALL_ROWS) return 1;
    return Math.max(1, Math.ceil(props.total / props.rowsPerPage));
});

const pageLabel = computed(() =>
    formatMessage(msg.value.paginator.page, { page: props.page, pages: pageCount.value }),
);
const pageInputLabel = computed(() =>
    formatMessage(msg.value.paginator.pageInput, { pages: pageCount.value }),
);

function goTo(page: number): void {
    const clamped = Math.min(Math.max(1, page), pageCount.value);
    if (clamped !== props.page) emit('update:page', clamped);
}

function onSizeChange(value: number): void {
    emit('update:rowsPerPage', value);
    // A smaller page can put the current one past the end.
    emit('update:page', 1);
    writeStoredSize(value);
}

// Persistence lives here rather than in each list's state, so a page that
// paginates on the server gets it on the same terms as one that slices
// locally. Storage can throw — Safari's private mode, a blocked third-party
// context — and a pager that cannot remember a number is not a reason to take
// the page down with it.
function readStoredSize(): number | null {
    if (!props.storageKey) return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + props.storageKey);
        const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    } catch {
        return null;
    }
}

function writeStoredSize(value: number): void {
    if (!props.storageKey) return;
    try {
        window.localStorage.setItem(STORAGE_PREFIX + props.storageKey, String(value));
    } catch {
        // Nothing to recover: the size simply lasts for this visit.
    }
}

onMounted(() => {
    const stored = readStoredSize();
    if (stored !== null && stored !== props.rowsPerPage) emit('update:rowsPerPage', stored);
});

const editing = ref(false);
const draft = ref('');
const pageInput = ref<HTMLInputElement | null>(null);

function startEdit(): void {
    draft.value = String(props.page);
    editing.value = true;
    void nextTick(() => pageInput.value?.select());
}

function commit(): void {
    if (!editing.value) return;
    editing.value = false;
    const parsed = Number.parseInt(draft.value, 10);
    if (Number.isFinite(parsed)) goTo(parsed);
}

function cancel(): void {
    editing.value = false;
}
</script>
