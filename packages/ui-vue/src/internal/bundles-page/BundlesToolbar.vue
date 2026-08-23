<template>
    <div class="sa-bundles__toolbar">
        <q-select
            v-if="locales.length > 1"
            :model-value="displayLocale"
            :options="localeOptions"
            outlined
            dense
            emit-value
            map-options
            class="sa-bundles__locale"
            :label="msg.header.displayLocale"
            @update:model-value="(value) => emit('update:displayLocale', String(value))"
        >
            <template #prepend><q-icon name="translate" size="18px" /></template>
        </q-select>
        <q-btn
            unelevated
            no-caps
            color="primary"
            icon="add"
            :label="msg.header.newBundle"
            @click="emit('create')"
        />
        <AdminRefreshBtn :loading="loading" @refresh="emit('refresh')" />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import AdminRefreshBtn from '../../ui/feedback/AdminRefreshBtn.vue';

// The language selector controls which locale feature/quota labels are resolved
// on the create form and in the detail view (fallback locale → DE → key). The default is the
// default locale (DE); further options come from the active project locales.

const props = defineProps<{
    loading: boolean;
    displayLocale: string;
    locales: string[];
}>();

const emit = defineEmits<{
    create: [];
    refresh: [];
    'update:displayLocale': [locale: string];
}>();

const msg = useSaMessages('bundles');

const localeOptions = computed(() =>
    props.locales.map((locale) => ({ label: locale.toUpperCase(), value: locale })),
);
</script>

<style scoped>
.sa-bundles__toolbar {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
}
.sa-bundles__locale {
    min-width: 150px;
}
</style>
