---
'@saasicat/ui-vue': patch
---

Make the promotions timeline bar a control, and let the rule see it

The promotions list moved onto `AdminAccordion`, but the timeline above it kept
its own way in: each bar opened the matching editor from a `<div>` with a click
handler — no keyboard, nothing announceable — which is the shape that migration
existed to remove. Each bar is now a `<button>` that reports whether the row it
charts is open.

The guard walked past it. It collected the states a body is rendered by from
`v-if`/`v-else-if`/`v-show` only, and once a body is `AdminAccordion`'s the
condition lives in an `:open` binding instead, where no `v-if` mentions it. It
now reads those bindings too — and which props count is derived from the
components themselves, so a second disclosure component is covered without
anyone remembering to add it here.

Two further defects in the same detector: tags were matched with a pattern that
ends at the first `>` in the source, so a `v-if="rows.length > 0"` hid every
attribute written after it on that element, `@click` included; and the rule had
no counter-proof, which is why three rounds of it could ship believing they
asked about disclosures while asking about spelling. Both are fixed.
