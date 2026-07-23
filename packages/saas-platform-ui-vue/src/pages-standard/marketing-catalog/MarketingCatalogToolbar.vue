<template>
    <div class="mc-toolbar">
        <div class="mc-tabbar">
            <button
                type="button"
                class="mc-tab"
                :class="{ active: tab === 'preview' }"
                @click="$emit('update:tab', 'preview')"
            >
                {{ msg.tabs.preview }}
            </button>
            <button
                type="button"
                class="mc-tab"
                :class="{ active: tab === 'admin' }"
                @click="$emit('update:tab', 'admin')"
            >
                {{ msg.tabs.admin }}
            </button>
            <button
                type="button"
                class="mc-tab"
                :class="{ active: tab === 'promos' }"
                @click="$emit('update:tab', 'promos')"
            >
                {{ msg.tabs.promos }}
                <span v-if="activePromoCount > 0" class="mc-tab-count">
                    {{ activePromoCount }}
                </span>
            </button>
        </div>
        <div class="mc-meta">
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
