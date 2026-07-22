<template>
    <div class="sa-stc" @click.stop>
        <span class="sa-review" :class="`sa-review--${status}`">
            {{ statusLabel(status, locale) }}
            <q-tooltip>{{ statusHint(status, locale) }}</q-tooltip>
        </span>
        <q-btn
            dense
            no-caps
            size="sm"
            :unelevated="primary.emphasized"
            :outline="!primary.emphasized"
            :color="primary.emphasized ? 'primary' : undefined"
            :label="primary.label"
            :loading="busy"
            @click="emit('set-status', primary.to)"
        >
            <q-tooltip>{{ statusHint(primary.to, locale) }}</q-tooltip>
        </q-btn>
        <q-btn v-if="menu.length" dense flat round size="sm" icon="more_horiz">
            <q-menu auto-close anchor="bottom right" self="top right">
                <q-list dense>
                    <q-item
                        v-for="m in menu"
                        :key="m.to"
                        clickable
                        @click="emit('set-status', m.to)"
                    >
                        <q-item-section :class="{ 'sa-stc__danger': m.danger }">
                            {{ m.label }}
                        </q-item-section>
                    </q-item>
                </q-list>
            </q-menu>
        </q-btn>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DiscoveryStatus } from '@saasicat/types';
import { useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import { primaryReviewAction, reviewMenuActions, statusHint, statusLabel } from './discovery-ui.js';

// StatusControl (#20, design sim): status chip + contextual primary action
// + kebab menu for the remaining lifecycle transitions. Shared by the feature
// and quota card; the actual PATCH runs via the `set-status` event
// in the page (reviewFeature/reviewQuota).

const props = defineProps<{
    status: DiscoveryStatus;
    /** Review request in progress — disables the primary action. */
    busy?: boolean;
}>();

const emit = defineEmits<{
    'set-status': [target: DiscoveryStatus];
}>();

const { locale } = useSuperAdminI18n();

const primary = computed(() => primaryReviewAction(props.status, locale.value));
const menu = computed(() => reviewMenuActions(props.status, locale.value));
</script>

<style scoped>
.sa-stc {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}
.sa-stc__danger {
    color: #b91c1c;
}
</style>
