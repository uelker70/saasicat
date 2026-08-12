<template>
    <AdminTable :rows="users" :columns="columns" storage-key="tenant-users" />
</template>

<script setup lang="ts">
import AdminTable from '../../components/admin-page/AdminTable.vue';
import type { QTableColumn } from 'quasar';

// The tenant's users. The column set comes from the page, which falls back to
// the platform default when the consumer supplies none.
defineProps<{
    users: Array<Record<string, unknown> & { id: string }>;
    columns: QTableColumn[];
}>();
</script>
