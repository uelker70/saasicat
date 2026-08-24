<template>
    <div class="sa-accordion" :class="{ 'sa-accordion--open': open }">
        <div class="sa-accordion__head">
            <!-- @optionSurface
                 The disclosure trigger, and the reason this component exists: it owns
                 `aria-expanded` and `aria-controls`, which four of the eight hand-built
                 accordions did not. -->
            <button
                :id="triggerId"
                type="button"
                class="sa-accordion__trigger"
                :aria-expanded="open"
                :aria-controls="bodyId"
                :disabled="disabled"
                @click="emit('update:open', !open)"
            >
                <span
                    v-if="$slots.mark"
                    class="sa-accordion__mark"
                    :class="`sa-accordion__mark--${markTone}`"
                >
                    <slot name="mark" />
                </span>
                <span class="sa-accordion__label"><slot name="header" /></span>
            </button>
            <div v-if="$slots['header-actions']" class="sa-accordion__actions">
                <slot name="header-actions" />
            </div>
        </div>
        <q-slide-transition>
            <div
                v-if="open"
                :id="bodyId"
                role="region"
                :aria-labelledby="triggerId"
                class="sa-accordion__body"
            >
                <slot />
            </div>
        </q-slide-transition>
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
// **No chevron.** The row is the affordance: the whole header is the trigger, it
// takes a hover surface, and the badge reports the state by turning. A glyph
// that says "there is more this way" was a fourth thing in a header that
// already carries a mark, a title and a status — and it was the only part of
// the row a reader could be sure to hit on the one surface that did not make
// its header clickable. That surface was fixed instead.
//
// **The body slides.** `v-if` alone snaps, which reads as a page jump on a
// list where several rows open. `q-slide-transition` animates the height
// Quasar's own way, so an accordion here and a `q-expansion-item` a consumer
// puts beside it move alike.
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
// (`openKey === row.id`), and in the bundle list opening one card while closing
// another is tied to loading that bundle's versions — a component that owned a
// boolean would break that. The other four simply hold the id, and lose nothing
// by the arrangement. `v-model:open` keeps the page in charge either way.
//
// The body is `v-if`, which is what all seven JS implementations already did.
// Uniform by accident until now; uniform on purpose from here.
const {
    open,
    disabled = false,
    markTone = 'accent',
} = defineProps<{
    /** Whether the body is shown. The page owns this — see above. */
    open: boolean;
    /** A locked row: the trigger is inert and announces itself as such. */
    disabled?: boolean;
    /**
     * The `mark` badge's tone. `accent` unless the row is in a state the badge
     * itself should report — the discovery quota with no usage provider is the
     * one case, and it swaps its glyph as well.
     *
     * Two values because two exist. The frame, size, radius and position do not
     * change with it: that is what makes the badge the same badge everywhere.
     */
    markTone?: 'accent' | 'negative';
}>();

const emit = defineEmits<{ 'update:open': [value: boolean] }>();

defineSlots<{
    /**
     * The icon that identifies the row, in a badge this component draws.
     *
     * A slot rather than a prop, because the glyph is sometimes conditional and
     * sometimes carries its own attributes. The BADGE is not the page's
     * business: three surfaces had three answers — a 34px accent-tinted square,
     * a bare 22px glyph, and a bare 20px glyph coloured by a Quasar palette
     * prop — so the same row on two pages did not look like the same row.
     */
    mark?(): unknown;
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
