<template>
    <TenantCardSection>
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
    </TenantCardSection>
</template>

<script setup lang="ts">
import type { UsageSnapshotShape } from '@saasicat/ui-vue';
import { useTenantI18n } from '../tenant-i18n.js';
import TenantCardSection from '../ui/TenantCardSection.vue';
import UsageBar from '../UsageBar.vue';

const i18n = useTenantI18n();

defineProps<{
    usage: UsageSnapshotShape;
    catalogQuotaKeys: string[];
    quotaLabel: (key: string) => string;
    isFractionalQuota: (key: string) => boolean;
    usageBarFormatter: (key: string) => ((value: number) => string) | undefined;
}>();
</script>
