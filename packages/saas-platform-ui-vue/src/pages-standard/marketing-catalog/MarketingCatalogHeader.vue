<template>
    <div class="sa-marketing-head-actions">
        <div class="sa-marketing-locale-mgr">
            <span class="sa-marketing-locale-mgr-label">{{ msg.header.localesLabel }}</span>
            <span
                v-for="loc in activeLocaleSet"
                :key="loc"
                class="sa-marketing-locale-pill"
                :class="{ active: loc === activeLocale }"
            >
                <button
                    type="button"
                    class="sa-marketing-locale-pill-btn"
                    @click="$emit('localeChange', loc)"
                >
                    {{ loc.toUpperCase() }}
                    <span v-if="loc === defaultLocale" :title="msg.header.defaultLocale">★</span>
                </button>
                <button
                    v-if="loc !== defaultLocale"
                    type="button"
                    class="sa-marketing-locale-x"
                    :title="msg.header.deactivateLocale"
                    @click="$emit('removeLocale', loc)"
                >
                    ×
                </button>
            </span>
            <div class="sa-marketing-locale-add-wrap">
                <button
                    type="button"
                    class="sa-marketing-locale-add"
                    :disabled="addableLocales.length === 0"
                    @click="$emit('update:localePickerOpen', !localePickerOpen)"
                >
                    {{ msg.header.addLocale }}
                </button>
                <div v-if="localePickerOpen" class="sa-marketing-locale-picker">
                    <button
                        v-for="l in addableLocales"
                        :key="l"
                        type="button"
                        class="sa-marketing-locale-picker-row"
                        @click="$emit('addLocale', l)"
                    >
                        {{ l.toUpperCase() }}
                    </button>
                </div>
            </div>
        </div>
        <button class="sa-marketing-btn" type="button" :disabled="busy" @click="$emit('reload')">
            <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
            >
                <path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" />
            </svg>
            <span>{{ msg.header.refresh }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

defineProps<{
    activeLocaleSet: string[];
    activeLocale: string;
    defaultLocale: string;
    addableLocales: string[];
    localePickerOpen: boolean;
    busy: boolean;
}>();

defineEmits<{
    (e: 'localeChange', loc: string): void;
    (e: 'removeLocale', loc: string): void;
    (e: 'addLocale', loc: string): void;
    (e: 'update:localePickerOpen', value: boolean): void;
    (e: 'reload'): void;
}>();

const msg = useSaMessages('marketing');
</script>
