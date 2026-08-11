<template>
    <div class="sa-page-body">
        <div v-if="loading" class="sa-page-body__state">
            <slot name="loading">
                <q-spinner size="32px" />
                <span>{{ loadingText ?? common.loadingData }}</span>
            </slot>
        </div>

        <div v-else-if="empty" class="sa-page-body__state sa-page-body__state--empty">
            <slot name="empty">{{ emptyText ?? common.noData }}</slot>
        </div>

        <slot v-else />
    </div>
</template>

<script setup lang="ts">
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// The page body: everything below the hero, plus the two states that body is
// almost always in before it has content.
//
// Ten of the fifteen standard pages used to spell out their own spinner and
// their own empty text, each with a private class for the same centred,
// muted block. The states live here so a page describes *when* it is empty
// rather than *what* empty looks like.
//
// Like AdminPage, this is deliberately not <main>: the landmark belongs to
// AdminLayout and must appear once per document.
defineProps<{
    loading?: boolean;
    /** Shown when not loading. The page decides what counts as empty. */
    empty?: boolean;
    loadingText?: string;
    emptyText?: string;
}>();

const common = useSaMessages('common');
</script>
