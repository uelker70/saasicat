<template>
    <div class="sa-field-grid" :data-columns="columns"><slot /></div>
</template>

<script setup lang="ts">
// The grid AdminField sits in. Column count is a prop rather than a breakpoint
// guess because a dialog and a settings page want different densities from the
// same fields; the grid collapses to one column below the `sm` breakpoint
// either way, which is the part no caller should have to remember.
withDefaults(defineProps<{ columns?: 1 | 2 | 3 }>(), { columns: 2 });
</script>
