<template>
    <div class="sa-field" :data-span="span" :data-invalid="error ? '' : undefined">
        <label class="sa-field__label" :for="fieldFor">
            {{ label }}
            <span v-if="required" class="sa-field__required" aria-hidden="true">*</span>
        </label>
        <div class="sa-field__control"><slot :described-by="describedBy" /></div>
        <p v-if="error" :id="errorId" class="sa-field__error" role="alert">{{ error }}</p>
        <p v-else-if="hint" :id="hintId" class="sa-field__hint">{{ hint }}</p>
    </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';

// One labelled control in a form. Two dialogs in the package — 666 and 602
// lines — are mostly hand-laid field grids, and between them the label sat
// above the control, beside it, and inside it as a Quasar float.
//
// The accessibility is why this is a component and not a class. A hint or an
// error is only announced if the control points at it, and doing that by hand
// needs an id per instance; four of the hand-laid fields had a visible error
// message that no screen reader ever reached. The `described-by` slot prop is
// that id — a caller binds it to `aria-describedby` on whatever control it
// renders, and gets the association without minting ids.
//
// `for` is a prop rather than derived because the control is in a slot: this
// component cannot know the id of an input it did not render. When the caller
// has one, passing it makes the label clickable; when it does not, Quasar's own
// label association still holds.
const props = withDefaults(
    defineProps<{
        label: string;
        hint?: string;
        /** A message, or null when valid. Replaces the hint while present. */
        error?: string | null;
        required?: boolean;
        /** Id of the control this labels, when the caller knows it. */
        for?: string;
        /** How many grid columns the field spans. */
        span?: 1 | 2 | 3 | 'full';
    }>(),
    { hint: undefined, error: null, required: false, for: undefined, span: 1 },
);

const uid = useId();
const hintId = `${uid}-hint`;
const errorId = `${uid}-error`;

const fieldFor = computed(() => props.for);
const describedBy = computed(() => {
    if (props.error) return errorId;
    if (props.hint) return hintId;
    return undefined;
});
</script>
