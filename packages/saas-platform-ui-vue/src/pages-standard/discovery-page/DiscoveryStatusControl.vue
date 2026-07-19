<template>
    <div class="sa-stc" @click.stop>
        <span class="sa-review" :class="`sa-review--${status}`">
            {{ STATUS_META[status].label }}
            <q-tooltip>{{ STATUS_META[status].hint }}</q-tooltip>
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
            <q-tooltip>{{ STATUS_META[primary.to].hint }}</q-tooltip>
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
import { primaryReviewAction, reviewMenuActions, STATUS_META } from './discovery-ui.js';

// StatusControl (#20, Design-Sim): Status-Chip + kontextuelle Primär-Aktion
// + Kebab-Menü für die übrigen Lebenszyklus-Übergänge. Geteilt von Feature-
// und Quota-Karte; der eigentliche PATCH läuft über das `set-status`-Event
// in der Page (reviewFeature/reviewQuota).

const props = defineProps<{
    status: DiscoveryStatus;
    /** Laufender Review-Request — deaktiviert die Primär-Aktion. */
    busy?: boolean;
}>();

const emit = defineEmits<{
    'set-status': [target: DiscoveryStatus];
}>();

const primary = computed(() => primaryReviewAction(props.status));
const menu = computed(() => reviewMenuActions(props.status));
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
