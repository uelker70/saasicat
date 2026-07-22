<template>
    <div class="sa-bundles__filter-row">
        <q-input
            :model-value="query"
            dense
            outlined
            clearable
            :placeholder="msg.filterBar.searchPlaceholder"
            class="sa-bundles__search"
            @update:model-value="emitQuery"
        >
            <template #prepend><q-icon name="search" /></template>
        </q-input>
        <q-select
            :model-value="statusFilter"
            dense
            outlined
            :options="statusFilterOptions"
            emit-value
            map-options
            class="sa-bundles__status-filter"
            @update:model-value="emitStatusFilter"
        />
    </div>
</template>

<script setup lang="ts">
import type { BundlesStatusFilter, BundlesStatusFilterOption } from './types.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

defineProps<{
    query: string;
    statusFilter: BundlesStatusFilter;
    statusFilterOptions: BundlesStatusFilterOption[];
}>();

const msg = useSaMessages('bundles');

const emit = defineEmits<{
    'update:query': [value: string];
    'update:statusFilter': [value: BundlesStatusFilter];
}>();

function emitQuery(value: string | number | null): void {
    emit('update:query', String(value ?? ''));
}

function emitStatusFilter(value: unknown): void {
    emit('update:statusFilter', (value ?? 'all') as BundlesStatusFilter);
}
</script>
