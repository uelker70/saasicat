<template>
    <q-card-section>
        <div class="sp-plan-section__usage-title">{{ i18n.usageTitle }}</div>
        <div class="sp-plan-section__usage-grid">
            <UsageBar
                v-for="key in catalogQuotaKeys"
                :key="key"
                :label="quotaLabel(key)"
                :used="usage.usage[key] ?? 0"
                :max="usage.limits.quotas[key] ?? 0"
                :fractional="isFractionalQuota(key)"
                :format-value="usageBarFormatter(key)"
            />
        </div>
    </q-card-section>
</template>

<script setup lang="ts">
import type { TenantPlanSectionI18n } from '../default-i18n.js';
import type { UsageSnapshotShape } from '../../vue/use-tenant-billing.js';
import UsageBar from '../UsageBar.vue';

defineProps<{
    usage: UsageSnapshotShape;
    i18n: TenantPlanSectionI18n;
    catalogQuotaKeys: string[];
    quotaLabel: (key: string) => string;
    isFractionalQuota: (key: string) => boolean;
    usageBarFormatter: (key: string) => ((value: number) => string) | undefined;
}>();
</script>
