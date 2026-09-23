<template>
    <!-- Hidden rather than removed: the parts have to be mounted to ask the
         server whether they are for this user at all. -->
    <TenantCard v-show="shown.paymentMethod || shown.details" class="sp-billing-section">
        <TenantPaymentMethodCard
            :http="http"
            :api-prefix="apiPrefix"
            :return-url="returnUrl"
            :navigate="navigate"
            :separated="false"
            @availability="shown.paymentMethod = $event"
        />
        <TenantBillingDetailsCard
            :http="http"
            :api-prefix="apiPrefix"
            @availability="shown.details = $event"
        />
    </TenantCard>
</template>

<script setup lang="ts">
import { useSuperAdminI18n, type HttpClient } from '@saasicat/ui-vue';
import { computed, reactive } from 'vue';

import { defaultTenantPlanSectionI18n, type TenantPlanSectionI18n } from './default-i18n.js';
import { provideTenantI18n } from './tenant-i18n.js';
import TenantBillingDetailsCard from './tenant-billing-section/TenantBillingDetailsCard.vue';
import TenantPaymentMethodCard from './TenantPaymentMethodCard.vue';
import TenantCard from './ui/TenantCard.vue';
import './ui/tenant-ui.css';

// TenantBillingSection — where a tenant finds its billing: what the
// subscriber pays with and whom it is billed to, in one component an
// application mounts under whatever its navigation calls billing. The plan
// page answers "what did I book"; this answers the chores that come up
// without a plan decision, such as a card that expires.
//
// Every part sits behind the billing permission and shows itself only to a
// user the server lets see it; the rest of the tenant sees nothing here, and a
// request built by hand is refused where it is served. The invoices and the
// account arrive in this section as they are built, so an application that
// mounts it now changes nothing when they do.

const props = defineProps<{
    /** App-specific HTTP adapter (axios with auth header etc.). */
    http?: HttpClient;
    /** API prefix before `/billing/*`, as for `TenantPlanSection`. Default `/billing`. */
    apiPrefix?: string;
    /** Where the payment provider's form sends the person back. Default: this page. */
    returnUrl?: string;
    /** How the person is sent to the payment provider's form. Default: `window.location.assign`. */
    navigate?: (url: string) => void;
    /** i18n overrides — missing keys fall back to the active locale's map. */
    i18n?: Partial<TenantPlanSectionI18n>;
}>();

const { locale } = useSuperAdminI18n();

/** Which parts show anything; an empty card would be a bordered strip saying nothing. */
const shown = reactive({ paymentMethod: false, details: false });

provideTenantI18n(
    computed<TenantPlanSectionI18n>(() => ({
        ...defaultTenantPlanSectionI18n(locale.value),
        ...(props.i18n ?? {}),
    })),
);
</script>

<style scoped>
.sp-billing-section :deep(.sp-card-section + .sp-card-section) {
    border-top: 1px solid var(--sa-color-border);
}
</style>
