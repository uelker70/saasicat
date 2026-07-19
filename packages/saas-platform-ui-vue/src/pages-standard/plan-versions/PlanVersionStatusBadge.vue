<template>
    <span class="sa-pv-status-badge" :class="`sa-pv-status-badge--${status.toLowerCase()}`">
        <q-icon :name="cfg.icon" size="12px" />
        {{ cfg.label }}
    </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

type Status = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
const props = defineProps<{ status: Status }>();

const STATUS_CFG: Record<Status, { label: string; icon: string }> = {
    DRAFT: { label: 'DRAFT', icon: 'edit_note' },
    ACTIVE: { label: 'AKTIV', icon: 'check_circle' },
    ARCHIVED: { label: 'ARCHIV', icon: 'archive' },
};
const cfg = computed(() => STATUS_CFG[props.status]);
</script>

<style scoped>
.sa-pv-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 9px;
    border-radius: 6px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
}
.sa-pv-status-badge--draft {
    background: #fef3c7;
    color: #92400e;
}
.sa-pv-status-badge--active {
    background: #d1fae5;
    color: #065f46;
}
.sa-pv-status-badge--archived {
    background: #f1f5f9;
    color: #64748b;
}
.sa-pv-status-badge :deep(.q-icon) {
    color: inherit;
}
</style>
