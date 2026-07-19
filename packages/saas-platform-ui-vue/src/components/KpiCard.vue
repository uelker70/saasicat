<template>
    <div class="kpi" :style="{ borderTopColor: accent }">
        <div class="kpi__head">
            <q-icon :name="icon" size="20px" :style="{ color: accent }" />
            <span class="kpi__label">{{ label }}</span>
        </div>
        <div class="kpi__value">{{ value }}</div>
        <slot name="footer" />
    </div>
</template>

<script setup lang="ts">
// Generische KPI-Card mit Icon, Label, Wert und optionalem Footer-Slot.
// Akzent-Farbe ueber `accent`-Prop (CSS-Color).

defineProps<{
    label: string;
    value: string | number;
    icon: string;
    accent?: string;
}>();
</script>

<style scoped>
.kpi {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-top-width: 3px;
    border-radius: 14px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.kpi__head {
    display: flex;
    align-items: center;
    gap: 8px;
}
.kpi__label {
    font-size: 11px;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
}
.kpi__value {
    font-size: 24px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.1;
}
</style>
