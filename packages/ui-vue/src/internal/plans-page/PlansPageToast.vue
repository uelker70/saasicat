<template>
    <transition name="sa-plans-toast">
        <div v-if="message" class="sa-plans__toast">
            <span class="sa-plans__toast-tick" aria-hidden="true">
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                >
                    <path d="M5 13l4 4L19 7" />
                </svg>
            </span>
            <span>{{ message }}</span>
        </div>
    </transition>
</template>

<script setup lang="ts">
defineProps<{
    message: string | null;
}>();
</script>

<style scoped>
.sa-plans__toast {
    position: fixed;
    bottom: var(--sa-space-7);
    left: 50%;
    transform: translateX(-50%);
    background: var(--sa-color-inverse-bg);
    color: var(--sa-color-fg-on-accent);
    padding: var(--sa-space-4) var(--sa-space-5);
    border-radius: var(--sa-radius-tile);
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    font:
        500 var(--sa-text-md) 'Inter',
        system-ui,
        sans-serif;
    box-shadow: 0 12px 40px var(--sa-shadow-tint-4);
    z-index: 6000;
    max-width: 80vw;
}
.sa-plans__toast-tick {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}
.sa-plans-toast-enter-active,
.sa-plans-toast-leave-active {
    transition:
        opacity 0.22s ease,
        transform 0.22s ease;
}
.sa-plans-toast-enter-from,
.sa-plans-toast-leave-to {
    opacity: 0;
    transform: translate(-50%, 12px);
}
</style>
