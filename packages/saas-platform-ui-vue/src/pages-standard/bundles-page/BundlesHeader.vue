<template>
    <header class="sa-bundles__head">
        <div>
            <h1 class="sa-bundles__title">{{ msg.header.title }}</h1>
            <p class="sa-bundles__sub">{{ msg.header.subtitle }}</p>
        </div>
        <div class="sa-bundles__head-actions">
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
                color="primary"
                icon="add"
                :label="msg.header.newBundle"
                @click="emit('create')"
            />
            <q-btn flat icon="refresh" :loading="loading" @click="emit('refresh')">
                <q-tooltip>{{ msg.header.reload }}</q-tooltip>
            </q-btn>
        </div>
    </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

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
.sa-bundles__locale {
    min-width: 150px;
}
</style>
