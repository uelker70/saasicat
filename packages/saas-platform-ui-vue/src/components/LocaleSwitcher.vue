<template>
    <q-btn
        v-if="switcherEnabled"
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
// The button inherits its color from the surrounding chrome (`currentColor`),
// so it needs no variant prop — each host sets the color it wants.
//
// It renders nothing when the app opted out of the switcher or handed over a
// locale it does not allow writing to; hosts therefore embed it unconditionally
// and never have to repeat that check.

const { locale, switcherEnabled } = useSuperAdminI18n();
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
