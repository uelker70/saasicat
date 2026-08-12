<template>
    <section class="sa-section" :aria-labelledby="hasTitle ? headingId : undefined">
        <header v-if="hasTitle" class="sa-section__head">
            <div>
                <h2 :id="headingId" class="sa-section__title">
                    <slot name="title">{{ title }}</slot>
                </h2>
                <p v-if="subtitle || $slots.subtitle" class="sa-section__sub">
                    <slot name="subtitle">{{ subtitle }}</slot>
                </p>
            </div>
            <div v-if="$slots.actions" class="sa-section__actions">
                <slot name="actions" />
            </div>
        </header>
        <div class="sa-section__body">
            <slot />
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, useId, useSlots } from 'vue';

// A block of a page. Every child of AdminBody is one of these or an
// AdminStatistics — nothing else, so the page structure can be explained once
// instead of page by page.
//
// The title is optional. A filter row and a data table are blocks without a
// natural name, and inventing one per page is exactly how a design line
// splinters. When a title IS given, the head repeats the hero's treatment one
// level down: same block, `h2` instead of `h1`.
//
// The `title` slot is for the cases where the heading carries more than text —
// a count, a badge — so a page never has to rebuild the head to add one.
//
// `aria-labelledby` is why this is a component rather than a bare `<section>`:
// an unnamed section is not a landmark, and naming one by hand needs an id
// unique per instance. Without a title there is nothing to point at, so the
// attribute is left off rather than pointed at an element that is not there.
//
// The content sits in its own wrapper so a page can lay it out — a filter row
// as flex, a grid of cards — without the head being dragged into that layout.
// That wrapper is the only thing a page styles; the surface is not its business.
const props = defineProps<{
    title?: string;
    subtitle?: string;
}>();

const slots = useSlots();
const headingId = useId();
const hasTitle = computed(() => Boolean(props.title || slots.title));
</script>
