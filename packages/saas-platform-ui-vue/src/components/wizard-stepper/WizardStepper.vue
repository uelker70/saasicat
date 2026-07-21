<template>
    <div class="wz-stepper">
        <template v-for="(step, i) in steps" :key="i">
            <div
                class="wz-step"
                :class="{
                    'wz-step--current': i === currentIndex,
                    'wz-step--done': i < currentIndex,
                }"
            >
                <span class="wz-step-num">
                    <svg
                        v-if="i < currentIndex"
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3.5"
                        aria-hidden="true"
                    >
                        <path d="M5 13l4 4L19 7" />
                    </svg>
                    <template v-else>{{ i + 1 }}</template>
                </span>
                <span>{{ step.label }}</span>
            </div>
            <span v-if="i < steps.length - 1" class="wz-step-sep" aria-hidden="true" />
        </template>
        <div v-if="hint" class="wz-stepper-hint">{{ hint }}</div>
    </div>
</template>

<script setup lang="ts">
// WizardStepper — generic step bar for multi-step SuperAdmin
// wizards (plan creation, bundle creation, …). Purely presentational: the host
// controls `currentIndex`; the component does not know the flow.

export interface WizardStep {
    label: string;
}

defineProps<{
    steps: WizardStep[];
    /** 0-based index of the current step. */
    currentIndex: number;
    /** Optional hint text, right-aligned (e.g. "Jederzeit als Draft speicherbar"). */
    hint?: string;
}>();
</script>

<style scoped>
.wz-stepper {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 14px 26px;
    background: var(--sa-bg-surface);
    border-bottom: 1px solid var(--sa-border);
}
.wz-step {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    font: 500 12.5px var(--sa-font-body);
    color: var(--sa-muted);
}
.wz-step--current {
    background: var(--sa-heading);
    color: #fff;
}
.wz-step--done {
    color: var(--sa-positive);
}
.wz-step-num {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--sa-border);
    color: var(--sa-muted-dark);
    display: grid;
    place-items: center;
    font: 700 11px var(--sa-font-body);
    flex: 0 0 auto;
}
.wz-step--current .wz-step-num {
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
}
.wz-step--done .wz-step-num {
    background: var(--sa-positive-soft);
    color: var(--sa-positive);
}
.wz-step-sep {
    width: 14px;
    height: 1px;
    background: var(--sa-border);
    margin: 0 2px;
}
.wz-stepper-hint {
    margin-left: auto;
    font-size: 11px;
    color: var(--sa-muted);
}
</style>
