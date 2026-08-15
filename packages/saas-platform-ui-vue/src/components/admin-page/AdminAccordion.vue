<template>
    <div class="sa-accordion" :class="{ 'sa-accordion--open': open }">
        <div class="sa-accordion__head">
            <button
                :id="triggerId"
                type="button"
                class="sa-accordion__trigger"
                :aria-expanded="open"
                :aria-controls="bodyId"
                :disabled="disabled"
                @click="emit('update:open', !open)"
            >
                <span class="sa-accordion__label"><slot name="header" /></span>
                <q-icon name="chevron_right" size="18px" class="sa-accordion__chev" />
            </button>
            <div v-if="$slots['header-actions']" class="sa-accordion__actions">
                <slot name="header-actions" />
            </div>
        </div>
        <div
            v-if="open"
            :id="bodyId"
            role="region"
            :aria-labelledby="triggerId"
            class="sa-accordion__body"
        >
            <slot />
        </div>
    </div>
</template>

<script setup lang="ts">
import { useId } from 'vue';

// One disclosure: a header that opens a body. Eight surfaces in this package
// built their own, in three incompatible idioms, and agreed on nothing —
// three header paddings, three body paddings, two radii, two colours for the
// open border, two transition durations, and hover feedback on exactly one of
// six despite five setting `cursor: pointer`.
//
// The reason is not that eight decisions were taken. It is that none was: there
// is an `AdminTable` and an `AdminSection`, and for "open this" there was
// nothing, so every page wrote it again. `admin-page-shell.test.ts` rule 14
// records the same story for tables — "nine pages used QTable directly and
// agreed on nothing".
//
// **The trigger is a `<button>`, and that is the point of the component.**
// Four of the eight were a `<div>` with a click handler: no `tabindex`, no
// keyboard, and a screen reader announcing text rather than a control. A grep
// for `aria-expanded` across the whole package returned nothing at all. A
// shared component has that argument once; eight surfaces have to win it eight
// times, and the score was 4:4.
//
// `header-actions` is a SIBLING of the button rather than a slot inside it, and
// both halves of that matter. A control inside the trigger would fire the
// toggle on its way past — the discovery cards put a live status control in
// their clickable header — and interactive content nested in a `<button>` is
// not valid HTML, so the browser's own behaviour there is not something to
// rely on.
//
// The state is NOT owned here. Five of the eight take it from the page
// (`openKey === row.id`), because opening one card while closing another is
// tied to loading that card's data; a component that owned a boolean would
// break exactly those. `v-model:open` keeps the page in charge.
//
// The body is `v-if`, which is what all seven JS implementations already did.
// Uniform by accident until now; uniform on purpose from here.
const { open, disabled = false } = defineProps<{
    /** Whether the body is shown. The page owns this — see above. */
    open: boolean;
    /** A locked row: the trigger is inert and announces itself as such. */
    disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

defineSlots<{
    /** The header's content — a title, keys, chips, whatever the row needs. */
    header(): unknown;
    /**
     * Controls on the right of the header that must NOT toggle it.
     * Rendered outside the trigger, so a click here is only a click here.
     */
    'header-actions'?(): unknown;
    /** The body. Only rendered while open. */
    default(): unknown;
}>();

// `useId`, as in `AdminSection`: `aria-controls` and `aria-labelledby` have to
// point at THIS instance, and an accordion is by nature rendered many times on
// one page.
const triggerId = useId();
const bodyId = useId();
</script>
