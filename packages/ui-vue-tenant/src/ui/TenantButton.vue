<template>
    <button
        type="button"
        class="sp-btn"
        :class="[`sp-btn--${variant}`, `sp-btn--${tone}`, { 'sp-btn--icon': iconOnly }]"
        :disabled="disabled || loading"
        :aria-busy="loading ? 'true' : undefined"
    >
        <span v-if="loading" class="sp-spinner sp-spinner--inline" aria-hidden="true"></span>
        <slot />
    </button>
</template>

<script setup lang="ts">
import './tenant-ui.css';

// The one button in this package.
//
// There were two: fifteen `q-btn` and eleven hand-written `<button>`s doing the
// same job, and nothing said which was the right one to write next. The answer
// could not be "use the Quasar one" here, because a control in the customer's
// application may not require the customer to install a UI framework.
//
// Two axes, because the call sites use two and no more: how loud the button is
// (`variant`) and what it means (`tone`). A destructive action is `danger` in
// either the solid or the quiet form, so the colour travels with the meaning
// rather than being spelled out again at every call site.
//
// Not here on purpose: `size`. `quiet` is already the compact one, and the
// three places that reached for Quasar's `dense size="sm"` are all quiet
// buttons. A second size axis would be a knob nobody has had to turn.
//
// `type` is fixed to `button`: this package renders no `<form>`, and a button
// that defaults to `submit` inside the customer's form is a page reload nobody
// asked for.

withDefaults(
    defineProps<{
        /** How loud: filled, bordered, or bare. */
        variant?: 'solid' | 'outline' | 'quiet';
        /** What it means. `danger` is the only one that carries a warning. */
        tone?: 'neutral' | 'accent' | 'danger';
        /**
         * Square, for a control whose whole content is a glyph. The call site
         * owes it an `aria-label` — nothing here can name it.
         */
        iconOnly?: boolean;
        /** Shows the ring and takes the button out of reach while it runs. */
        loading?: boolean;
        disabled?: boolean;
    }>(),
    { variant: 'outline', tone: 'neutral', iconOnly: false, loading: false, disabled: false },
);
</script>

<style scoped>
.sp-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sa-space-2);
    padding: var(--sa-space-3) var(--sa-space-5);
    border: 1px solid transparent;
    border-radius: var(--sa-radius-control);
    font: inherit;
    font-size: var(--sa-text-md);
    font-weight: 500;
    line-height: var(--sa-leading-2xs);
    text-align: center;
    cursor: pointer;
    /* A button whose label grows must not push its row wider than the card. */
    min-width: 0;
}
.sp-btn:focus-visible {
    outline: 2px solid var(--sa-color-border-focus);
    outline-offset: 2px;
}
.sp-btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

/* ── Loud: a filled surface ─────────────────────────────────────────────── */
.sp-btn--solid.sp-btn--accent {
    background: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
}
.sp-btn--solid.sp-btn--accent:hover:not(:disabled) {
    background: var(--sa-color-accent-strong);
}
.sp-btn--solid.sp-btn--danger {
    background: var(--sa-color-negative);
    color: var(--sa-color-fg-on-accent);
}
.sp-btn--solid.sp-btn--danger:hover:not(:disabled) {
    background: var(--sa-color-negative-strong);
}
.sp-btn--solid.sp-btn--neutral {
    background: var(--sa-color-bg-sunken);
    color: var(--sa-color-fg-body);
}

/* ── Default: a bordered surface ────────────────────────────────────────── */
.sp-btn--outline {
    background: var(--sa-color-bg-surface);
    border-color: var(--sa-color-border-strong);
    color: var(--sa-color-fg-body);
}
.sp-btn--outline.sp-btn--accent {
    border-color: var(--sa-color-accent-border);
    color: var(--sa-color-accent-strong);
}
.sp-btn--outline.sp-btn--danger {
    border-color: var(--sa-color-negative-border);
    color: var(--sa-color-negative-fg);
}
.sp-btn--outline:hover:not(:disabled) {
    background: var(--sa-color-bg-sunken);
}

/* ── Quiet: a label that happens to be pressable ────────────────────────── */
.sp-btn--quiet {
    padding: var(--sa-space-2) var(--sa-space-3);
    background: transparent;
    color: var(--sa-color-fg-secondary);
}
.sp-btn--quiet.sp-btn--accent {
    color: var(--sa-color-accent-strong);
}
.sp-btn--quiet.sp-btn--danger {
    color: var(--sa-color-negative-fg);
}
.sp-btn--quiet:hover:not(:disabled) {
    background: var(--sa-color-bg-sunken);
}

.sp-btn--icon {
    width: 32px;
    height: 32px;
    padding: var(--sa-space-0);
    border-radius: var(--sa-radius-pill);
}
</style>
