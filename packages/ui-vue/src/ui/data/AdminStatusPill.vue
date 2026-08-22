<template>
    <span class="sa-pill" :class="[`sa-pill--${tone}`, `sa-pill--${variant}`]" :data-size="size">
        <q-icon v-if="icon" :name="icon" class="sa-pill__icon" aria-hidden="true" />
        {{ label }}
    </span>
</template>

<script setup lang="ts">
import type { PillTone } from '../../vue/status.js';

// The status marker. Promoted out of the tenants folder, where it had been
// living as a private component used by exactly one page while nine other
// places rendered their own status display — several of them a bare coloured
// `q-badge`, which is colour carrying the meaning on its own.
//
// Pills compose: an app puts two side by side for a composite state
// ("Active + PILOT"), which is why this takes a label rather than a status.
// `statusTone()` next door is what turns a domain status INTO these props, so
// no page invents its own mapping.
withDefaults(
    defineProps<{
        label: string;
        tone: PillTone;
        icon?: string;
        /** `soft` is the tinted default; `outline` is for dense tables. */
        variant?: 'soft' | 'outline';
        size?: 'sm' | 'md';
    }>(),
    { icon: undefined, variant: 'soft', size: 'md' },
);
</script>
