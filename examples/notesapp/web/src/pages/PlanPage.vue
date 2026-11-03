<template>
    <q-page class="q-pa-md">
        <div class="plan-container">
            <div class="text-h5 q-mb-xs">Subscription &amp; plan</div>
            <div class="text-body2 text-grey-7 q-mb-md">
                Review your plan and usage, change plans, and book add-on bundles. The payment
                method and the billing details are under Billing.
            </div>

            <TenantPlanSection
                :http="platformHttp"
                api-prefix="/billing"
                :format-currency="formatCurrency"
                :format-date="formatDate"
                :quota-label="quotaLabel"
                :feature-label="featureLabel"
                :is-fractional-quota="isFractionalQuota"
                show-bundle-store
                show-feature-matrix
                :show-payment-method="false"
            />
        </div>
    </q-page>
</template>

<script setup lang="ts">
import TenantPlanSection from '@saasicat/ui-vue-tenant/TenantPlanSection.vue';
import { platformHttp } from '../services/http';
import { formatCurrency, formatDate } from '../formats';
import { featureLabel, quotaLabel } from '../labels';

// notesapp has no fractional (storage-style) quotas — notesMax is an integer.
function isFractionalQuota(): boolean {
    return false;
}
</script>

<style scoped>
.plan-container {
    max-width: 960px;
    margin: 0 auto;
}
</style>
