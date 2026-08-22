<template>
    <AdminBanner v-if="error != null" tone="negative" :title="title">
        {{ message }}
        <template v-if="retry" #actions>
            <q-btn flat dense no-caps :label="common.retry" @click="onRetry" />
        </template>
    </AdminBanner>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import AdminBanner from './AdminBanner.vue';
import { adminErrorMessage } from '../../client/admin-error.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// The ninety-percent case of AdminBanner: something failed, say what, offer to
// try again. It renders nothing at all when `error` is null, so a page binds it
// unconditionally under the hero and never writes an `v-if` for it.
//
// It exists because five pages had each grown their own `errMsg()` — five
// wordings of the same function, each carrying its own assumption about what an
// axios rejection looks like. `adminErrorMessage()` is that decision made once,
// and this component is the only thing a page needs to reach it.
const props = defineProps<{
    /** Whatever was caught. `null` renders nothing. */
    error: unknown | null;
    /** Overrides the generic heading, e.g. "Could not load plans". */
    title?: string;
    /** When given, the banner offers a retry button that calls it. */
    retry?: () => void | Promise<void>;
}>();

const common = useSaMessages('common');
const errors = useSaMessages('errors');

const message = computed(() => adminErrorMessage(props.error, errors.value));

function onRetry(): void {
    void props.retry?.();
}
</script>
