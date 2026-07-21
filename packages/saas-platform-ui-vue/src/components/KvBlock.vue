<template>
    <div class="kv">
        <div class="kv__label">{{ label }}</div>
        <div class="kv__value">{{ value }}</div>
    </div>
</template>

<script setup lang="ts">
// Generic key-value display block. Used on detail pages and
// everywhere a label/value pair should be rendered in a consistent
// style.

defineProps<{ label: string; value: string }>();
</script>

<style scoped>
.kv {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 10px 12px;
}
.kv__label {
    color: #64748b;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
}
.kv__value {
    font-size: 14px;
    font-weight: 600;
    color: #0f172a;
    margin-top: 4px;
}
</style>
