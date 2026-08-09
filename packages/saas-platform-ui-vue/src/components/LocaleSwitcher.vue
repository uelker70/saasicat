<template>
    <q-btn
        class="sa-locale-switcher"
        flat
        dense
        no-caps
        icon="language"
        :label="SA_LOCALE_LABELS[locale]"
        :aria-label="msg.header.language"
    >
        <q-menu auto-close anchor="bottom right" self="top right">
            <q-list dense class="sa-locale-switcher__list">
                <q-item
                    v-for="option in SA_LOCALES"
                    :key="option"
                    clickable
                    :active="option === locale"
                    @click="select(option)"
                >
                    <q-item-section>{{ SA_LOCALE_LABELS[option] }}</q-item-section>
                    <q-item-section v-if="option === locale" side>
                        <q-icon name="check" size="16px" />
                    </q-item-section>
                </q-item>
            </q-list>
        </q-menu>
    </q-btn>
</template>

<script setup lang="ts">
import { SA_LOCALES, SA_LOCALE_LABELS, type SaLocale } from '../client/i18n/index.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Language switcher for the shell chrome. Writes straight to the shared i18n
// locale, so every catalog text, the sidebar labels and `Intl` formatting
// follow on the next render.
//
// The button inherits its color from the surrounding chrome (`currentColor`);
// on the dark header and the login background that is already the light text
// color, so no variant prop is needed.

const { locale } = useSuperAdminI18n();
const msg = useSaMessages('shell');

function select(next: SaLocale): void {
    locale.value = next;
}
</script>

<style scoped>
.sa-locale-switcher {
    color: inherit;
}
.sa-locale-switcher__list {
    min-width: 160px;
}
</style>
