<template>
    <component
        :is="action ? 'button' : 'div'"
        :type="action ? 'button' : undefined"
        :aria-pressed="action ? selected : undefined"
        :class="[
            'sa-kpi',
            tone !== 'neutral' && `sa-kpi--${tone}`,
            emphasis === 'surface' && 'sa-kpi--surface',
            action && 'sa-kpi--action',
            action && selected && 'sa-kpi--selected',
        ]"
        @click="action?.()"
    >
        <q-icon v-if="icon" :name="icon" size="18px" class="sa-kpi__icon" />
        <span class="sa-kpi__label">{{ label }}</span>
        <span class="sa-kpi__value">
            <slot name="value">{{ formattedValue }}</slot>
        </span>
        <span v-if="sub || $slots.sub" class="sa-kpi__sub">
            <slot name="sub">{{ sub }}</slot>
        </span>
    </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// One statistic tile. Seven near-copies of this existed across the admin
// pages, two of them byte identical; the differences that were real are the
// props below.
//
// `action` decides everything about interactivity: with one the tile is a
// <button> carrying `aria-pressed`, without one it is a <div>. Making that an
// explicit prop rather than inferring it from an attached listener keeps the
// rendered tag, the role and the focus behaviour visible at the call site.
//
// `emphasis` is the one genuine fork between the two families that came
// before: the filter pills recolour only the number, while the discovery and
// draft tiles tint the whole tile because there the colour IS the statement.
const props = withDefaults(
    defineProps<{
        label: string;
        /** Numbers are localised here so every tile formats alike. */
        value?: string | number | null;
        sub?: string;
        tone?: 'neutral' | 'positive' | 'info' | 'warn' | 'danger' | 'muted' | 'purple';
        /** `value` colours the number only, `surface` tints the whole tile. */
        emphasis?: 'value' | 'surface';
        icon?: string;
        /** Supply to make the tile a button; omit for an informational tile. */
        action?: () => void;
        selected?: boolean;
    }>(),
    { tone: 'neutral', emphasis: 'value', selected: false },
);

const EMPTY = '—';

const { intlLocale } = useSuperAdminI18n();

const formattedValue = computed(() => {
    const value = props.value;
    if (value === null || value === undefined || value === '') return EMPTY;
    return typeof value === 'number' ? value.toLocaleString(intlLocale.value) : value;
});
</script>
