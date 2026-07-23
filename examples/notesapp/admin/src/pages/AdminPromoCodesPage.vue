<template>
    <PlatformPromoCodesPage
        :load-promos="loadPromos"
        :subtitle="subtitle"
        :plan-options="planOptions"
        :enable-create="true"
        :enable-edit="true"
        :enable-status-toggle="true"
        :enable-delete="true"
        :submit-create="createPromo"
        :submit-edit="updatePromo"
        :submit-delete="deletePromo"
    />
</template>

<script setup lang="ts">
import PlatformPromoCodesPage from '@saasicat/ui-vue/pages/PromoCodesPage.vue';
import { createPromo, deletePromo, loadPromos, updatePromo } from '../services/app-loaders';

// Promo codes (GET/POST/PATCH/DELETE /admin/promo-codes). The create/edit/
// status-toggle/delete flows are the page's built-in dialogs, wired to the
// app-owned CRUD endpoints. Plan options mirror config/saas.yaml.
const subtitle = 'Rabattcodes für das Onboarding-Checkout.';
const planOptions = [
    { key: 'STARTER', label: 'Starter' },
    { key: 'PRO', label: 'Pro' },
];
</script>
