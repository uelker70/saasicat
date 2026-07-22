<template>
    <header class="sa-discovery__head">
        <div>
            <h1 class="sa-discovery__title">{{ msg.title }}</h1>
            <p class="sa-discovery__sub">
                {{ msg.subtitleLead }} <b>{{ msg.subtitleEmphasis }}</b> {{ msg.subtitleTail }}
            </p>
        </div>
        <div class="sa-discovery__head-actions">
            <q-btn
                unelevated
                color="primary"
                icon="bolt"
                :label="msg.runDiscovery"
                :loading="loading"
                @click="emit('runDiscovery')"
            />
        </div>
    </header>
</template>

<script setup lang="ts">
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

defineProps<{
    loading: boolean;
}>();

const emit = defineEmits<{
    (e: 'runDiscovery'): void;
}>();

const msg = useSaMessages('discovery');
</script>
