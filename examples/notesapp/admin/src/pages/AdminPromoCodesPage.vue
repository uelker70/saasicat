<template>
    <PlatformPromoCodesPage :options="options" />
</template>

<script setup lang="ts">
import PlatformPromoCodesPage from '@saasicat/ui-vue/pages/PromoCodesPage.vue';
import type { PromoCodesPageOptions } from '@saasicat/ui-vue/pages/PromoCodesPage.vue';

// Promo codes. The page reaches the platform's promo-code resource itself —
// there is no loader to write and no endpoint to spell. What stays here is what
// this app decides: the wording, which plans a code may apply to, and which of
// the four flows its operators are offered.
const options: PromoCodesPageOptions = {
    subtitle: 'Discount codes for the onboarding checkout.',
    planOptions: [
        { key: 'STARTER', label: 'Starter' },
        { key: 'PRO', label: 'Pro' },
    ],
    enableCreate: true,
    enableEdit: true,
    enableStatusToggle: true,
    enableDelete: true,
};
</script>
