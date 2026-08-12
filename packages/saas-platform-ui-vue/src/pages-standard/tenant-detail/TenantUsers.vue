<template>
    <q-table
        flat
        :rows="pagedRows"
        :columns="columns"
        row-key="id"
        :pagination="{ rowsPerPage: ALL_ROWS }"
        hide-pagination
    />

    <AdminPaginator
        storage-key="tenant-users"
        v-model:page="page"
        v-model:rows-per-page="rowsPerPage"
        :total="total"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ALL_ROWS, usePagination } from '../../vue/use-pagination.js';
import AdminPaginator from '../../components/admin-page/AdminPaginator.vue';
import type { QTableColumn } from 'quasar';

// The tenant's users. The column set comes from the page, which falls back to
// the platform default when the consumer supplies none.
const props = defineProps<{
    users: Array<Record<string, unknown> & { id: string }>;
    columns: QTableColumn[];
}>();

const userRows = computed(() => props.users);
const { page, rowsPerPage, total, pagedRows } = usePagination(userRows);
</script>
