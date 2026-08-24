<template>
    <div class="sp-card-section">
        <slot />
    </div>
</template>

<script setup lang="ts">
// A padded block inside a card. Eighteen of them across the package, which is
// why the padding is here rather than repeated in eighteen scoped styles.
//
// No `horizontal`, no `dense`, no `avatar` slot: the ones this package uses are
// all the same block, and a variant added before a second call site needs it is
// a decision nobody has had to make yet.
</script>

<style scoped>
.sp-card-section {
    padding: var(--sa-space-5) var(--sa-space-6);
    min-width: 0;
}
</style>
