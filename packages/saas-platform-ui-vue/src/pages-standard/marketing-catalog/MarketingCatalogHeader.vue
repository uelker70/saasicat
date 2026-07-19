<template>
    <div class="mc-page-head">
        <div>
            <h2 class="mc-h-title">Marketing-Catalog</h2>
            <p class="mc-h-sub">
                Öffentliche Marketing-Projektion · gefilterte Sicht für Website, Pricing-Page und
                Checkout
            </p>
        </div>
        <div class="mc-head-actions">
            <div class="mc-locale-mgr">
                <span class="mc-locale-mgr-label">Sprachen:</span>
                <span
                    v-for="loc in activeLocaleSet"
                    :key="loc"
                    class="mc-locale-pill"
                    :class="{ active: loc === activeLocale }"
                >
                    <button
                        type="button"
                        class="mc-locale-pill-btn"
                        @click="$emit('localeChange', loc)"
                    >
                        {{ loc.toUpperCase() }}
                        <span v-if="loc === defaultLocale" title="Default-Sprache">★</span>
                    </button>
                    <button
                        v-if="loc !== defaultLocale"
                        type="button"
                        class="mc-locale-x"
                        title="Sprache deaktivieren"
                        @click="$emit('removeLocale', loc)"
                    >
                        ×
                    </button>
                </span>
                <div class="mc-locale-add-wrap">
                    <button
                        type="button"
                        class="mc-locale-add"
                        :disabled="addableLocales.length === 0"
                        @click="$emit('update:localePickerOpen', !localePickerOpen)"
                    >
                        + Sprache
                    </button>
                    <div v-if="localePickerOpen" class="mc-locale-picker">
                        <button
                            v-for="l in addableLocales"
                            :key="l"
                            type="button"
                            class="mc-locale-picker-row"
                            @click="$emit('addLocale', l)"
                        >
                            {{ l.toUpperCase() }}
                        </button>
                    </div>
                </div>
            </div>
            <button class="mc-btn" type="button" :disabled="busy" @click="$emit('reload')">
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
                <span>Aktualisieren</span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
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
</script>
