<template>
    <!-- Around the whole application, the sign-in page included: an announced
         window is shown there too, and while the lock holds every page is the
         maintenance page. -->
    <MaintenanceGate :http="platformHttp" :api-base="API_BASE">
        <router-view />
    </MaintenanceGate>
</template>

<script setup lang="ts">
import MaintenanceGate from '@saasicat/ui-vue-tenant/MaintenanceGate.vue';

import { API_BASE, platformHttp } from './services/http';
</script>
