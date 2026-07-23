<template>
    <PlatformAuditPage :load-audit="loadAudit" :page-size="pageSize" />
</template>

<script setup lang="ts">
import PlatformAuditPage from '@saasicat/ui-vue/pages/AuditPage.vue';
import { loadAudit } from '../services/app-loaders';

// Audit trail (GET /admin/audit). Populated by the tenant suspend/reactivate
// and promo-code actions this example writes.
const pageSize = 100;
</script>
