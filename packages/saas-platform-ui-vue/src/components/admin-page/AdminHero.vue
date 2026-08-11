<template>
    <header class="sa-page-head">
        <div>
            <slot name="before-title" />
            <component :is="`h${level}`" class="sa-page-head__title">
                <slot name="title">{{ title }}</slot>
            </component>
            <p v-if="subtitle || $slots.subtitle" class="sa-page-head__sub">
                <slot name="subtitle">{{ subtitle }}</slot>
            </p>
        </div>
        <div v-if="$slots.actions" class="sa-page-head__actions">
            <slot name="actions" />
        </div>
    </header>
</template>

<script setup lang="ts">
// The page hero: the one <h1> a page is allowed to have.
//
// `title` is required on purpose. It is the part of the contract that the
// previous class-name convention could not enforce — a page can forget to add
// `.sa-page-head`, but it cannot instantiate this component without a title,
// because vue-tsc rejects it.
//
// `subtitle` covers the plain-text case; the matching slot is for the detail
// pages whose subtitle carries markup (a status badge, a <code> slug).
// `before-title` holds the back link on detail pages, which sits above the
// heading rather than beside it.
//
// The `title` slot fills the heading with markup rather than text — a rename
// affordance, say. The hero still owns the element and its level; the page only
// says what goes inside it. `title` stays required either way, so the heading
// has an accessible name even while the slot renders a control.
//
// `level` is what lets the same title block appear twice on a page: `1` at the
// top, `2` for a titled group inside AdminBody. The markup is identical, so a
// second component would only have duplicated it — and the heading level is
// the one thing that actually differs.
withDefaults(
    defineProps<{
        title: string;
        subtitle?: string;
        /** Heading level. `1` for the page hero, `2` for a block inside the body. */
        level?: 1 | 2;
    }>(),
    { level: 1 },
);
</script>
