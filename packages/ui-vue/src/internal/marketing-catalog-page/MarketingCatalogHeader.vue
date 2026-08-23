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
                <q-btn
                    v-if="loc !== defaultLocale"
                    flat
                    dense
                    size="sm"
                    icon="close"
                    class="sa-marketing-locale-x"
                    :title="msg.header.deactivateLocale"
                    @click="$emit('removeLocale', loc)"
                />
            </span>
            <div class="sa-marketing-locale-add-wrap">
                <q-btn
                    class="sa-marketing-locale-add"
                    flat
                    dense
                    no-caps
                    :label="msg.header.addLocale"
                    :disable="addableLocales.length === 0"
                    @click="$emit('update:localePickerOpen', !localePickerOpen)"
                />
                <div v-if="localePickerOpen" class="sa-marketing-locale-picker">
                    <q-btn
                        v-for="l in addableLocales"
                        :key="l"
                        class="sa-marketing-locale-picker-row"
                        flat
                        dense
                        no-caps
                        :label="l.toUpperCase()"
                        @click="$emit('addLocale', l)"
                    />
                </div>
            </div>
        </div>
        <AdminRefreshBtn :loading="busy" @refresh="$emit('reload')" />
    </div>
</template>

<script setup lang="ts">
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import AdminRefreshBtn from '../../ui/feedback/AdminRefreshBtn.vue';

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
