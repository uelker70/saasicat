<template>
    <div class="sa-empty" :data-size="size">
        <q-icon v-if="icon" :name="icon" class="sa-empty__icon" aria-hidden="true" />
        <p class="sa-empty__title">{{ title }}</p>
        <div v-if="description || $slots.default" class="sa-empty__body">
            <slot>{{ description }}</slot>
        </div>
        <div v-if="$slots.actions" class="sa-empty__actions"><slot name="actions" /></div>
    </div>
</template>

<script setup lang="ts">
// What a list shows when it has nothing to show. The distinction that matters
// is between "nothing here yet" and "nothing matched your filter" — the first
// wants a way to create something, the second a way to clear the filter — so
// the title is required and the actions slot is the point of the component.
//
// `size` picks the treatment: `block` is the centred state that owns a section,
// `inline` the one-liner inside a table body. Both exist today, hand-written,
// which is why the prop is a variant rather than two components.
withDefaults(
    defineProps<{
        title: string;
        description?: string;
        icon?: string;
        size?: 'inline' | 'block';
    }>(),
    { description: undefined, icon: undefined, size: 'block' },
);
</script>
