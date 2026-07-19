<template>
    <transition name="pl-toast">
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
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: #0f172a;
    color: #fff;
    padding: 12px 18px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    gap: 10px;
    font:
        500 13px 'Inter',
        system-ui,
        sans-serif;
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.3);
    z-index: 6000;
    max-width: 80vw;
}
.sa-plans__toast-tick {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #10b981;
    color: #fff;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}
.pl-toast-enter-active,
.pl-toast-leave-active {
    transition:
        opacity 0.22s ease,
        transform 0.22s ease;
}
.pl-toast-enter-from,
.pl-toast-leave-to {
    opacity: 0;
    transform: translate(-50%, 12px);
}
</style>
