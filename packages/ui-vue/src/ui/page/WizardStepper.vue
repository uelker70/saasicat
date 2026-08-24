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
                    <q-icon v-if="i < currentIndex" name="check" size="11px" />
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
    gap: var(--sa-space-2);
    padding: var(--sa-space-4) var(--sa-space-7);
    background: var(--sa-color-bg-surface);
    border-bottom: 1px solid var(--sa-color-border);
}
.wz-step {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-2) var(--sa-space-4);
    border-radius: var(--sa-radius-pill);
    font: 500 var(--sa-text-md) var(--sa-font-body);
    color: var(--sa-color-fg-muted);
}
.wz-step--current {
    background: var(--sa-color-inverse-bg);
    color: var(--sa-color-fg-on-accent);
}
.wz-step--done {
    color: var(--sa-color-positive);
}
.wz-step-num {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--sa-color-border);
    color: var(--sa-color-fg-secondary);
    display: grid;
    place-items: center;
    font: 700 var(--sa-text-xs) var(--sa-font-body);
    flex: 0 0 auto;
}
.wz-step--current .wz-step-num {
    background: var(--sa-color-inverse-border-strong);
    color: var(--sa-color-fg-on-accent);
}
.wz-step--done .wz-step-num {
    background: var(--sa-color-positive-surface);
    color: var(--sa-color-positive);
}
.wz-step-sep {
    width: 14px;
    height: 1px;
    background: var(--sa-color-border);
    margin: 0 var(--sa-space-1);
}
.wz-stepper-hint {
    margin-left: auto;
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
}
</style>
