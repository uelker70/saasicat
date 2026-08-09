<template>
    <q-btn
        v-if="visible"
        class="sa-locale-switcher"
        flat
        dense
        no-caps
        icon="language"
        :label="activeLabel"
        :aria-label="msg.header.language"
    >
        <q-menu auto-close anchor="bottom right" self="top right">
            <q-list dense class="sa-locale-switcher__list">
                <q-item
                    v-for="option in availableLocales"
                    :key="option.code"
                    clickable
                    :active="option.code === locale"
                    @click="select(option.code)"
                >
                    <q-item-section>{{ option.label }}</q-item-section>
                    <q-item-section v-if="option.code === locale" side>
                        <q-icon name="check" size="16px" />
                    </q-item-section>
                </q-item>
            </q-list>
        </q-menu>
    </q-btn>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import type { SaLocale, SaLocaleOption } from '../client/i18n/index.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Language switcher for the shell chrome. Writes straight to the shared i18n
// locale, so every catalog text, the sidebar labels and `Intl` formatting
// follow on the next render.
//
// The button inherits its color from the surrounding chrome (`currentColor`),
// so it needs no variant prop — each host sets the color it wants.
//
// It renders nothing when the app opted out, offers a single language, or
// handed over a locale it does not allow writing to; hosts therefore embed it
// unconditionally and never have to repeat that check.

const { locale, switcherEnabled, availableLocales } = useSuperAdminI18n();

// Only an explicit `false` hides the switcher. The injection key is a
// `Symbol.for`, so a context created by an older copy of this package resolves
// here just as well — and that one has no `switcherEnabled` at all. Treating
// the missing field as "off" would make every switcher vanish after such an
// upgrade, without a warning anywhere. Chrome fails open.
const visible = switcherEnabled !== false;
const msg = useSaMessages('shell');

// Same reason as above: such a context carries no `availableLocales` either, so
// the list has to tolerate its absence instead of throwing during render.
const options = computed<readonly SaLocaleOption[]>(() => availableLocales ?? []);
const activeLabel = computed(
    () => options.value.find((option) => option.code === locale.value)?.label ?? locale.value,
);

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
