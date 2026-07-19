<template>
    <div class="sa-pv-kpi">
        <div class="sa-pv-kpi__icon"><q-icon :name="icon" size="18px" /></div>
        <div>
            <div class="sa-pv-kpi__label">{{ label }}</div>
            <div class="sa-pv-kpi__value">
                {{ value }}
                <span v-if="sub" class="sa-pv-kpi__sub">{{ sub }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    label: string;
    value: number | string;
    icon: string;
    sub?: string;
}>();
</script>

<style scoped>
.sa-pv-kpi {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
}
.sa-pv-kpi__icon {
    width: 36px;
    height: 36px;
    border-radius: 9px;
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    display: flex;
    align-items: center;
    justify-content: center;
}
.sa-pv-kpi__icon :deep(.q-icon) {
    color: var(--sa-primary, #3f6bff);
}
.sa-pv-kpi__label {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
}
.sa-pv-kpi__value {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 20px;
    color: var(--sa-heading, #0f172a);
    line-height: 1.1;
    margin-top: 2px;
}
.sa-pv-kpi__sub {
    font-size: 12px;
    font-weight: 500;
    color: var(--sa-muted, #64748b);
}
</style>
