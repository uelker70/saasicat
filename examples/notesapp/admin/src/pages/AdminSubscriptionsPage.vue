<template>
    <PlatformSubscriptionsPage :options="options" />
</template>

<script setup lang="ts">
import PlatformSubscriptionsPage from '@saasicat/ui-vue/pages/SubscriptionsPage.vue';

// Live subscriptions — tenant, plan, status and the current period end from the
// seeded Subscription rows.
const options = { subtitle: 'Aktive Subscriptions je Mandant.' };
</script>
