<template>
    <section v-if="tenantImpact" class="pc-card">
        <div class="pc-card-head">
            <div class="pc-card-head-text">
                <div class="pc-card-title">{{ msg.kpis.tenantImpact }}</div>
                <div class="pc-card-sub">{{ msg.impact.subtitle }}</div>
            </div>
        </div>
        <div class="pc-impact-strip">
            <div class="pc-impact-num">{{ tenantImpactTotal }}</div>
            <div class="pc-impact-bars">
                <div class="pc-impact-bar">
                    <span
                        class="pc-impact-bar-fill"
                        :style="{
                            width: pct(tenantImpact.auto, tenantImpactTotal),
                            background: '#10b981',
                        }"
                    />
                    <span class="pc-impact-bar-label">{{ autoLabel }}</span>
                </div>
                <div class="pc-impact-bar">
                    <span
                        class="pc-impact-bar-fill"
                        :style="{
                            width: pct(tenantImpact.review, tenantImpactTotal),
                            background: '#f59e0b',
                        }"
                    />
                    <span class="pc-impact-bar-label">{{ reviewLabel }}</span>
                </div>
                <div class="pc-impact-bar">
                    <span
                        class="pc-impact-bar-fill"
                        :style="{
                            width: pct(tenantImpact.conflict, tenantImpactTotal),
                            background: '#ef4444',
                        }"
                    />
                    <span class="pc-impact-bar-label">{{ conflictLabel }}</span>
                </div>
            </div>
        </div>
        <div
            v-if="tenantImpact.examples && tenantImpact.examples.length > 0"
            class="pc-impact-tenants"
        >
            <div v-for="t in tenantImpact.examples" :key="t.name" class="pc-impact-tenant">
                <div class="pc-impact-avatar">{{ initialsOf(t.name) }}</div>
                <div class="pc-impact-body">
                    <div class="pc-impact-name">{{ t.name }}</div>
                    <div class="pc-impact-sub">{{ t.plan }}</div>
                </div>
                <span :class="['pc-chip', impactStateChip(t.state)]">{{
                    impactStateLabel(t.state)
                }}</span>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { ImpactTenant, TenantImpact } from './types';

const props = defineProps<{
    tenantImpact: TenantImpact | null;
    tenantImpactTotal: number;
}>();

const msg = useSaMessages('planDetail');

const autoLabel = computed(() =>
    formatMessage(msg.value.impact.autoMigrate, { count: props.tenantImpact?.auto ?? 0 }),
);
const reviewLabel = computed(() =>
    formatMessage(msg.value.impact.needReview, { count: props.tenantImpact?.review ?? 0 }),
);
const conflictLabel = computed(() =>
    formatMessage(msg.value.impact.conflict, { count: props.tenantImpact?.conflict ?? 0 }),
);

function pct(part: number, total: number): string {
    if (total <= 0) return '0%';
    return `${Math.max(2, Math.round((part / total) * 100))}%`;
}

function initialsOf(name: string): string {
    return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase() ?? '')
        .join('');
}

function impactStateLabel(state: ImpactTenant['state']): string {
    if (state === 'auto') return msg.value.impact.stateAuto;
    if (state === 'review') return msg.value.impact.stateReview;
    return msg.value.impact.stateConflict;
}

function impactStateChip(state: ImpactTenant['state']): string {
    return state === 'auto'
        ? 'pc-chip--live'
        : state === 'review'
          ? 'pc-chip--draft'
          : 'pc-chip--conflict';
}
</script>
