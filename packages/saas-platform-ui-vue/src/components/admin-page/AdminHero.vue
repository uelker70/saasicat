<template>
    <header class="sa-page-head">
        <div>
            <slot name="before-title" />
            <h1 class="sa-page-head__title">{{ title }}</h1>
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
defineProps<{
    title: string;
    subtitle?: string;
}>();
</script>
