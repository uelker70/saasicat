<template>
    <Teleport :to="teleportTo">
        <div v-if="modelValue" class="sp-dialog" v-bind="backdropProps">
            <div ref="panelRef" class="sp-dialog__panel" :data-size="size" v-bind="panelProps">
                <header class="sp-dialog__head">
                    <div class="sp-dialog__heading">
                        <h2 :id="titleId" class="sp-dialog__title">{{ title }}</h2>
                        <p v-if="subtitle" class="sp-dialog__sub">{{ subtitle }}</p>
                    </div>
                    <TenantButton
                        variant="quiet"
                        icon-only
                        :aria-label="closeLabel ?? i18n.wizardClose"
                        @click="close"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </TenantButton>
                </header>

                <div class="sp-dialog__body"><slot /></div>

                <TenantCardActions v-if="$slots.footer" class="sp-dialog__foot">
                    <slot name="footer" />
                </TenantCardActions>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { useDialog } from '@saasicat/ui-vue';

import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from './TenantButton.vue';
import TenantCardActions from './TenantCardActions.vue';

// The chrome the package's dialogs share, over the headless `useDialog`.
//
// `title` is required, and it is what `aria-labelledby` points at: a component
// that cannot be built without a name cannot ship an unnamed one. The dialog
// this package had before announced itself as "dialog" and nothing else.
//
// The close control is always rendered, `persistent` or not. Persistent means
// escape and the backdrop do not close it — which makes the visible control the
// ONLY way out, so hiding it there would build the trap it is meant to prevent.

const i18n = useTenantI18n();

const props = withDefaults(
    defineProps<{
        modelValue: boolean;
        title: string;
        subtitle?: string;
        /** 420 / 560 / 900 px, capped at the viewport. */
        size?: 'sm' | 'md' | 'lg';
        /** Escape and the backdrop do not close it. For a dialog mid-request. */
        persistent?: boolean;
        /**
         * Accessible name for the close control. Defaults to the tenant
         * catalog; the wizard carries its own catalog and passes that instead.
         */
        closeLabel?: string;
        /**
         * Where the panel is teleported. The host may name a container of its
         * own — a dialog that always lands on `document.body` lands outside
         * whatever element carries the host's theme.
         */
        to?: string | HTMLElement;
    }>(),
    { subtitle: undefined, size: 'md', persistent: false, closeLabel: undefined, to: 'body' },
);

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

function close(): void {
    emit('update:modelValue', false);
}

const { panelRef, panelProps, backdropProps, titleId, teleportTo } = useDialog({
    open: () => props.modelValue,
    onClose: close,
    persistent: () => props.persistent,
    to: () => props.to,
});
</script>

<style scoped>
.sp-dialog {
    position: fixed;
    inset: 0;
    z-index: var(--sa-z-dialog);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sa-space-5);
    background: var(--sa-color-bg-overlay);
}
.sp-dialog__panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-height: 90vh;
    border-radius: var(--sa-radius-card);
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-fg-body);
    box-shadow: var(--sa-elevation-dialog);
}
.sp-dialog__panel:focus-visible {
    outline: 2px solid var(--sa-color-border-focus);
    outline-offset: 2px;
}
.sp-dialog__panel[data-size='sm'] {
    max-width: 420px;
}
.sp-dialog__panel[data-size='md'] {
    max-width: 560px;
}
.sp-dialog__panel[data-size='lg'] {
    max-width: 900px;
}
.sp-dialog__head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sa-space-5);
    padding: var(--sa-space-5) var(--sa-space-6);
    border-bottom: 1px solid var(--sa-color-border);
}
.sp-dialog__heading {
    min-width: 0;
}
.sp-dialog__title {
    margin: 0;
    font-size: var(--sa-text-xl);
    font-weight: 600;
    line-height: var(--sa-leading-2xl);
    color: var(--sa-color-fg-heading);
}
.sp-dialog__sub {
    margin: var(--sa-space-1) 0 0;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-secondary);
}
.sp-dialog__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: var(--sa-space-5) var(--sa-space-6);
}
.sp-dialog__foot {
    border-top: 1px solid var(--sa-color-border);
}
</style>
