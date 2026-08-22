<template>
    <PlatformAuditPage :page-size="100" />
</template>

<script setup lang="ts">
import PlatformAuditPage from '@saasicat/ui-vue/pages/AuditPage.vue';

// Audit trail. Populated by the tenant suspend/reactivate and promo-code
// actions this example writes. The page reads the platform's audit resource
// itself — there is no loader here and no endpoint to spell.
</script>
