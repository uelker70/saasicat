<template>
    <AdminBanner
        v-if="reasons.length > 0"
        tone="warning"
        :title="msg.subscriber.heldBack"
        class="q-mb-md"
    >
        <ul class="sa-subscriber-held-back__reasons">
            <li v-for="reason in reasons" :key="reason">{{ reason }}</li>
        </ul>
    </AdminBanner>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SubscriberReadiness } from '@saasicat/core';

import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import { heldBackReasons } from '../tenants/held-back.js';

// What holds the subscriber's next contract back, where a tax adapter decides
// and something does — the same words on the tenant's card and in the record,
// because both read them from one place.
const props = defineProps<{ readiness: SubscriberReadiness | null }>();

const msg = useSaMessages('subscribers');

const reasons = computed(() =>
    props.readiness ? heldBackReasons(props.readiness, msg.value.subscriber) : [],
);
</script>

<style scoped>
.sa-subscriber-held-back__reasons {
    margin: 0;
    padding-left: var(--sa-space-4);
}
</style>
