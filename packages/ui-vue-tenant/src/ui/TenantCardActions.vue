<template>
    <div class="sp-card-actions">
        <slot />
    </div>
</template>

<script setup lang="ts">
// The foot of a card: its buttons, trailing, in reading order.
//
// Alignment is not a prop. `q-card-actions align="right"` offered five, and
// both call sites here passed the same one — a dialog's actions go where a
// dialog's actions go, and a second alignment would be a second answer to a
// question the design system has already answered.
</script>

<style scoped>
.sp-card-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--sa-space-3);
    flex-wrap: wrap;
    padding: var(--sa-space-4) var(--sa-space-6);
}
</style>
