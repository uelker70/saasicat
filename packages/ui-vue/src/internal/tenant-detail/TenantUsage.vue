<template>
    <div class="sa-kv-grid">
        <KvBlock
            v-for="(field, i) in fields"
            :key="field.label + i"
            :label="field.label"
            :value="resolve(field)"
        />
    </div>
</template>

<script setup lang="ts">
import KvBlock from '../../ui/data/KvBlock.vue';
import type { TenantDetailData, UsageField } from './types.js';

// Usage counters. A field either names a key in `data.counts` or brings its own
// getter, so a consumer can surface a number the platform knows nothing about.
const props = defineProps<{
    data: TenantDetailData;
    fields: readonly UsageField[];
}>();

const EMPTY = '—';

function resolve(field: UsageField): string {
    if (field.getter) return String(field.getter(props.data));
    if (!field.key) return EMPTY;
    const value = props.data.counts?.[field.key];
    return value === undefined || value === null ? '0' : String(value);
}
</script>
