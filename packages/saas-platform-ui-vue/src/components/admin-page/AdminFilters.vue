<template>
    <section class="sa-filters">
        <div class="sa-filters__body">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
import { useSlots } from 'vue';

const slots = useSlots();
</script>
