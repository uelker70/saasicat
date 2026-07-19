<template>
    <section v-if="tenantImpact" class="pc-card">
        <div class="pc-card-head">
            <div class="pc-card-head-text">
                <div class="pc-card-title">Tenant-Impact</div>
                <div class="pc-card-sub">
                    Wer ist betroffen, wenn die nächste Version published wird
                </div>
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
                    <span class="pc-impact-bar-label">{{ tenantImpact.auto }} auto-migrieren</span>
                </div>
                <div class="pc-impact-bar">
                    <span
                        class="pc-impact-bar-fill"
                        :style="{
                            width: pct(tenantImpact.review, tenantImpactTotal),
                            background: '#f59e0b',
                        }"
                    />
                    <span class="pc-impact-bar-label"
                        >{{ tenantImpact.review }} brauchen Review</span
                    >
                </div>
                <div class="pc-impact-bar">
                    <span
                        class="pc-impact-bar-fill"
                        :style="{
                            width: pct(tenantImpact.conflict, tenantImpactTotal),
                            background: '#ef4444',
                        }"
                    />
                    <span class="pc-impact-bar-label">{{ tenantImpact.conflict }} Konflikt</span>
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
import type { ImpactTenant, TenantImpact } from './types';

defineProps<{
    tenantImpact: TenantImpact | null;
    tenantImpactTotal: number;
}>();

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
    return state === 'auto' ? 'auto' : state === 'review' ? 'review' : 'Konflikt';
}

function impactStateChip(state: ImpactTenant['state']): string {
    return state === 'auto'
        ? 'pc-chip--live'
        : state === 'review'
          ? 'pc-chip--draft'
          : 'pc-chip--conflict';
}
</script>
