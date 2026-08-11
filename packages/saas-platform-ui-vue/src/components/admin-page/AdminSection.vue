<template>
    <section class="sa-section" :aria-labelledby="headingId">
        <header class="sa-section__head">
            <div>
                <h2 :id="headingId" class="sa-section__title">{{ title }}</h2>
                <p v-if="subtitle || $slots.subtitle" class="sa-section__sub">
                    <slot name="subtitle">{{ subtitle }}</slot>
                </p>
            </div>
            <div v-if="$slots.actions" class="sa-section__actions">
                <slot name="actions" />
            </div>
        </header>
        <slot />
    </section>
</template>

<script setup lang="ts">
import { useId } from 'vue';

// A labelled block within a page, carrying the page's only heading level
// below the hero's <h1>.
//
// The aria-labelledby wiring is the reason this is a component and not a bare
// <section>: an unnamed <section> is not a landmark at all — assistive
// technology treats it as a generic container. Pointing it at its own heading
// is what makes it navigable, and doing that by hand needs a unique id per
// instance, which is exactly the step a hand-written section forgets.
//
// The section is structural, not a surface. A block that should read as a card
// adds `.sa-card`, which falls through to the root element.
defineProps<{
    title: string;
    subtitle?: string;
}>();

const headingId = useId();
</script>
