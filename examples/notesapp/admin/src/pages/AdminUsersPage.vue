<template>
    <PlatformUsersPage :load-users="loadUsers" :subtitle="subtitle" />
</template>

<script setup lang="ts">
import PlatformUsersPage from '@saasicat/ui-vue/pages/UsersPage.vue';
import { loadUsers } from '../services/app-loaders';

// Cross-tenant user search (GET /admin/users). Reset-password/deactivate flows
// are left off — this example's User model has no such lifecycle.
const subtitle = 'Alle Nutzer über die Mandanten hinweg.';
</script>
