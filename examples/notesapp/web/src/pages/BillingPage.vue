<template>
    <q-page class="q-pa-md">
        <div class="billing-container">
            <h1 class="text-h5 q-mt-none q-mb-xs">Billing</h1>
            <div class="text-body2 text-grey-7 q-mb-md">
                How your subscription is paid, and whom it is billed to.
            </div>

            <TenantBillingSection :http="platformHttp" api-prefix="/billing" />
        </div>
    </q-page>
</template>

<script setup lang="ts">
import TenantBillingSection from '@saasicat/ui-vue-tenant/TenantBillingSection.vue';
import { platformHttp } from '../services/http';
</script>

<style scoped>
.billing-container {
    max-width: 960px;
    margin: 0 auto;
}
</style>
