<template>
    <div class="sa-page">
        <slot />
    </div>
</template>

<script setup lang="ts">
// Root of every SuperAdmin content page.
//
// It owns the page frame — canvas background, min-height and page padding —
// which eleven pages used to declare verbatim in their own scoped styles.
//
// It deliberately does NOT render <main>. The landmark belongs to the layout
// and must appear exactly once per document; AdminLayout provides it. Quasar's
// QPage also renders <main>, which is why pages must not use QPage either.
</script>
