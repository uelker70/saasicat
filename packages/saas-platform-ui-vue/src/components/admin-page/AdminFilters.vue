<template>
    <section class="sa-filters">
        <div class="sa-filters__body">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
// Layout-only: the filter row is a flex container around whatever the page
// puts in it. No script state — the inputs are the page's, not ours.
</script>
