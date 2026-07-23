<template>
    <PlatformPlansPage :admin-endpoint="adminEndpoint" :project-key="projectKey" :http="http" />
</template>

<script setup lang="ts">
import PlatformPlansPage from '@saasicat/ui-vue/pages/PlansPage.vue';
import { platformHttp } from '../services/http';

const projectKey = 'notesapp';
const adminEndpoint = '/api/v1/admin';
const http = platformHttp;
</script>
