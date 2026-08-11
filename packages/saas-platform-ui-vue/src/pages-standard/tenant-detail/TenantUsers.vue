<template>
    <q-table
        flat
        :rows="users"
        :columns="columns"
        row-key="id"
        :pagination="{ rowsPerPage: 0 }"
        hide-pagination
    />
</template>

<script setup lang="ts">
import type { QTableColumn } from 'quasar';

// The tenant's users. The column set comes from the page, which falls back to
// the platform default when the consumer supplies none.
defineProps<{
    users: Array<Record<string, unknown> & { id: string }>;
    columns: QTableColumn[];
}>();
</script>
