<template>
    <PlatformUsersPage :options="options" />
</template>

<script setup lang="ts">
import PlatformUsersPage from '@saasicat/ui-vue/pages/UsersPage.vue';
import type { UsersPageOptions } from '@saasicat/ui-vue/pages/UsersPage.vue';

// Cross-tenant user search. The page reads the platform's users resource
// itself; reset-password and deactivate are left off, because this example's
// User model has no such lifecycle.
const options: UsersPageOptions = {
    subtitle: 'Every user, across all tenants.',
};
</script>
