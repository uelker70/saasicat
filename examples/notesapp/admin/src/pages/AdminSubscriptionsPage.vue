<template>
    <PlatformSubscriptionsPage :load-subscriptions="loadSubscriptions" :subtitle="subtitle" />
</template>

<script setup lang="ts">
import PlatformSubscriptionsPage from '@saasicat/ui-vue/pages/SubscriptionsPage.vue';
import { loadSubscriptions } from '../services/app-loaders';

// Live subscriptions (GET /admin/subscriptions) — tenant, plan, status and the
// current period end from the seeded Subscription rows.
const subtitle = 'Aktive Subscriptions je Mandant.';
</script>
