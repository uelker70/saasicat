<template>
    <q-btn
        v-if="visible"
        class="sa-theme-switcher"
        flat
        dense
        no-caps
        icon="contrast"
        :label="activeLabel"
        :aria-label="msg.header.theme?.label"
    >
        <q-menu auto-close anchor="bottom right" self="top right">
            <q-list dense class="sa-theme-switcher__list">
                <q-item
                    v-for="option in options"
                    :key="option.scheme"
                    clickable
                    :active="option.scheme === scheme"
                    @click="select(option.scheme)"
                >
                    <q-item-section>{{ option.label }}</q-item-section>
                    <q-item-section v-if="option.scheme === scheme" side>
                        <q-icon name="check" size="16px" />
                    </q-item-section>
                </q-item>
            </q-list>
        </q-menu>
    </q-btn>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import { SA_COLOR_SCHEMES, useSaTheme, type SaColorScheme } from '../../vue/use-sa-theme.js';

// Colour-scheme switcher for the shell chrome, the sibling of
// `LocaleSwitcher` — same button, same menu, same fail-open rule, and the two
// sit next to each other in every header that carries one.
//
// It writes the PICKED scheme, never the resolved one. That distinction is the
// whole reason the control has three entries instead of a toggle: 'system' is
// a standing instruction to follow the operating system, and collapsing it to
// whatever the machine says right now silently turns it into a fourth state
// nobody chose.
//
// The button inherits its color from the surrounding chrome (`currentColor`),
// so it needs no variant prop — each host sets the color it wants. The header
// is permanently dark in both themes and its foreground is an
// `--sa-color-inverse-*` role; inheriting is what keeps this button out of that
// decision.

const { scheme, switcherEnabled } = useSaTheme();
const msg = useSaMessages('shell');

// Only an explicit `false` hides the switcher. The injection key is a
// `Symbol.for`, so a context created by an older copy of this package resolves
// here just as well — and that one has no `switcherEnabled` at all. Treating
// the missing field as "off" would make every switcher vanish after such an
// upgrade, without a warning anywhere. Chrome fails open.
const visible = switcherEnabled !== false;

// Same reason as above, on the i18n side: a catalog from before these keys
// existed has no `header.theme` at all, and reading through it unguarded turns
// an upgrade skew into a render-time exception instead of a missing word.
const options = computed(() =>
    SA_COLOR_SCHEMES.map((value) => ({
        scheme: value,
        label: msg.value.header.theme?.[value] ?? value,
    })),
);
const activeLabel = computed(
    () => options.value.find((option) => option.scheme === scheme.value)?.label ?? scheme.value,
);

function select(next: SaColorScheme): void {
    scheme.value = next;
}
</script>

<style scoped>
.sa-theme-switcher {
    color: inherit;
}
</style>
