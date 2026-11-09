<template>
    <!-- Hidden rather than removed: the parts have to be mounted to ask the
         server whether they are for this user at all. -->
    <TenantCard
        v-show="shown.account || shown.invoices || shown.paymentMethod || shown.details"
        class="sp-billing-section"
    >
        <TenantAccountCard
            :http="http"
            :api-prefix="apiPrefix"
            :format-date="formatDate"
            :format-currency="formatCurrency"
            @availability="shown.account = $event"
        />
        <TenantInvoicesCard
            :http="http"
            :api-prefix="apiPrefix"
            :format-date="formatDate"
            :format-currency="formatCurrency"
            @availability="shown.invoices = $event"
        />
        <TenantPaymentMethodCard
            :http="http"
            :api-prefix="apiPrefix"
            :format-date="formatDate"
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
import TenantAccountCard from './tenant-billing-section/TenantAccountCard.vue';
import TenantBillingDetailsCard from './tenant-billing-section/TenantBillingDetailsCard.vue';
import TenantInvoicesCard from './tenant-billing-section/TenantInvoicesCard.vue';
import TenantPaymentMethodCard from './TenantPaymentMethodCard.vue';
import TenantCard from './ui/TenantCard.vue';
import './ui/tenant-ui.css';

// TenantBillingSection — where a tenant finds its billing: what its account
// owes and is owed, the invoices the operator issues it with the contract
// confirmations beside them, what the subscriber pays with and whom it is
// billed to, in one component an application mounts under whatever its
// navigation calls billing. The plan
// page answers "what did I book"; this answers the chores that come up
// without a plan decision, such as an invoice to file or a card that expires.
//
// Every part sits behind the billing permission and shows itself only to a
// user the server lets see it; the rest of the tenant sees nothing here, and a
// request built by hand is refused where it is served. Each part asks its own
// routes, so a part the server does not serve shows nothing.

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
    /**
     * The account's and the invoices' amounts. Each comes with its ISO 4217
     * currency, which a formatter that writes a symbol takes from here: an
     * installation may bill in more than one.
     */
    formatCurrency: (amount: number, currency: string) => string;
    /**
     * A day as the page writes it, as for `TenantPlanSection`: it is handed noon
     * of a day the server named, so it reads that instant in the viewer's zone.
     */
    formatDate: (iso: string) => string;
}>();

const { locale } = useSuperAdminI18n();

/** Which parts show anything; an empty card would be a bordered strip saying nothing. */
const shown = reactive({ account: false, invoices: false, paymentMethod: false, details: false });

provideTenantI18n(
    computed<TenantPlanSectionI18n>(() => ({
        ...defaultTenantPlanSectionI18n(locale.value),
        ...props.i18n,
    })),
);
</script>

<style scoped>
.sp-billing-section :deep(.sp-card-section + .sp-card-section) {
    border-top: 1px solid var(--sa-color-border);
}
</style>
