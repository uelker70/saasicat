<template>
    <AdminSection class="sa-filters">
        <slot />
    </AdminSection>
</template>

<script setup lang="ts">
import AdminSection from './AdminSection.vue';

// The filter row above a list. It exists so no page declares its own: five
// pages had built one independently, four with Quasar fields and one with a
// raw `<input>` and `<select>`, each with its own flex rule — five filter bars
// that looked like five products.
//
// Fields go in as `q-input` / `q-select`; the row lays them out and the theme
// gives them their shape. A page contributes which filters it has, never how
// they look.
</script>
