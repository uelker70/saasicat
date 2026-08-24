<template>
    <div class="sa-marketing-toolbar">
        <div class="sa-marketing-tabbar">
            <q-btn
                class="sa-marketing-tab"
                flat
                dense
                no-caps
                :label="msg.tabs.preview"
                :class="{ active: tab === 'preview' }"
                @click="$emit('update:tab', 'preview')"
            />
            <q-btn
                class="sa-marketing-tab"
                flat
                dense
                no-caps
                :label="msg.tabs.admin"
                :class="{ active: tab === 'admin' }"
                @click="$emit('update:tab', 'admin')"
            />
            <!-- @optionSurface
                 A tab with a count badge; the tabbar draws the selected state. -->
            <button
                type="button"
                class="sa-marketing-tab"
                :class="{ active: tab === 'promos' }"
                @click="$emit('update:tab', 'promos')"
            >
                {{ msg.tabs.promos }}
                <span v-if="activePromoCount > 0" class="sa-marketing-tab-count">
                    {{ activePromoCount }}
                </span>
            </button>
        </div>
        <div class="sa-marketing-meta">
            <span>catalogVersion</span>
            <code>{{ catalogVersion }}</code>
            <span>·</span>
            <span
                >locale <code>{{ activeLocale }}</code></span
            >
            <span>·</span>
            <span>currency <code>EUR</code></span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { MarketingCatalogTab } from './types.js';

defineProps<{
    tab: MarketingCatalogTab;
    activePromoCount: number;
    catalogVersion: string;
    activeLocale: string;
}>();

defineEmits<{
    (e: 'update:tab', tab: MarketingCatalogTab): void;
}>();

const msg = useSaMessages('marketing');
</script>
