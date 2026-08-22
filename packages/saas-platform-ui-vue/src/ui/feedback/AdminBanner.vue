<template>
    <div class="sa-banner" :class="toneClass" :data-dense="dense ? '' : undefined" role="status">
        <q-icon
            v-if="resolvedIcon"
            :name="resolvedIcon"
            class="sa-banner__icon"
            aria-hidden="true"
        />
        <div class="sa-banner__text">
            <p v-if="title" class="sa-banner__title">{{ title }}</p>
            <div v-if="$slots.default" class="sa-banner__body"><slot /></div>
        </div>
        <div v-if="$slots.actions" class="sa-banner__actions"><slot name="actions" /></div>
        <q-btn
            v-if="dismissible"
            flat
            dense
            round
            size="sm"
            icon="close"
            class="sa-banner__close"
            :aria-label="dismissLabel"
            @click="emit('dismiss')"
        />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// The inline notice a page shows in place, as opposed to the toast the notify
// port raises. Before this existed, nineteen places wrote their own — in six
// different colour recipes, from `bg-red-1 text-red-9` to `bg-negative
// text-white`. Two of those pairs disagreed about which colour a warning is.
//
// The tone is a role, never a colour: the caller says what the message IS, and
// the theme decides how that looks in light and in dark. That is also why the
// icon defaults per tone — an operator scanning a page reads the shape before
// the hue, and WCAG 1.4.1 says colour cannot be the only carrier. Passing
// `icon: false` drops it for the rare banner whose body already carries one.
const props = withDefaults(
    defineProps<{
        tone?: 'info' | 'positive' | 'warning' | 'negative';
        title?: string;
        /** Overrides the per-tone default; `false` renders no icon at all. */
        icon?: string | false;
        dense?: boolean;
        dismissible?: boolean;
    }>(),
    { tone: 'info', title: undefined, icon: undefined, dense: false, dismissible: false },
);

const emit = defineEmits<{ (e: 'dismiss'): void }>();

const common = useSaMessages('common');
const dismissLabel = computed(() => common.value.close);

const TONE_ICONS: Record<NonNullable<typeof props.tone>, string> = {
    info: 'info',
    positive: 'check_circle',
    warning: 'warning',
    negative: 'error',
};

const toneClass = computed(() => `sa-banner--${props.tone}`);
const resolvedIcon = computed(() => {
    if (props.icon === false) return undefined;
    return props.icon ?? TONE_ICONS[props.tone];
});
</script>
