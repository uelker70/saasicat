<template>
    <div class="sa-toolbar" :data-align="align" :data-sticky="sticky ? '' : undefined">
        <div class="sa-toolbar__start">
            <slot name="start"><slot /></slot>
        </div>
        <div v-if="$slots.end" class="sa-toolbar__end"><slot name="end" /></div>
    </div>
</template>

<script setup lang="ts">
// The action row above a table that is not the hero. Bulk actions, a view
// switch, "New …" — things that act on the list rather than on the page.
//
// It replaces `<div class="row items-center q-gutter-sm q-mb-md">`, which
// several pages wrote and none wrote identically: the gutters differed, and two
// of them wrapped on a narrow viewport in a way that put the primary action
// under the fold. Wrapping is this component's job, once.
withDefaults(
    defineProps<{
        /** Keeps the row in view while a long table scrolls under it. */
        sticky?: boolean;
        /** Where the start group sits when there is no `end` content. */
        align?: 'start' | 'between' | 'end';
    }>(),
    { sticky: false, align: 'between' },
);
</script>
