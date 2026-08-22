<template>
    <div class="sa-discovery__banner">
        <div class="sa-discovery__banner-app">
            <q-icon name="inventory_2" size="20px" />
            <div>
                <div class="sa-discovery__banner-name">{{ appLabel }}</div>
                <div class="sa-discovery__banner-meta">
                    <code>{{ appKey }}</code> · v{{ appVersion }}
                </div>
            </div>
        </div>
        <div class="sa-discovery__banner-time">
            <div class="sa-discovery__banner-time-lbl">Letzter Scan</div>
            <div class="sa-discovery__banner-time-val">{{ scanLabel }}</div>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    appLabel: string;
    appKey: string;
    appVersion: string;
    scanLabel: string;
}>();
</script>
