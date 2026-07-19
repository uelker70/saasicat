<template>
    <header class="sa-discovery__head">
        <div>
            <h1 class="sa-discovery__title">Discovery</h1>
            <p class="sa-discovery__sub">
                Capabilities, die der Code <b>aktuell</b> implementiert. Discovery ist Ist-Zustand —
                die Freigabe für Produkt &amp; Marketing erfolgt im Review.
            </p>
        </div>
        <div class="sa-discovery__head-actions">
            <q-btn
                unelevated
                color="primary"
                icon="bolt"
                label="Discovery neu ausführen"
                :loading="loading"
                @click="emit('runDiscovery')"
            />
        </div>
    </header>
</template>

<script setup lang="ts">
defineProps<{
    loading: boolean;
}>();

const emit = defineEmits<{
    (e: 'runDiscovery'): void;
}>();
</script>
