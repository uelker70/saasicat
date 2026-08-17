---
'@saasicat/ui-vue': patch
---

Give the seven design values in inline `style` attributes their tokens

`packages/saas-platform-ui-vue/src` ships as source, so the `.vue` files a
consumer imports carried four literal font sizes and three literal spacings in
inline `style="…"` attributes. They now read the scale:
`--sa-text-2xl` for the two marketing price tags, `--sa-text-2xs` for the
version status chip, `--sa-space-3` for the hint below the "allow zero price"
toggle and for the top margin of the promo-code duration input, and
`--sa-gap-inline` for an optional-field hint's left margin.

Three of the seven change rendered geometry, all by 1–2px, because the value
that was written has no rung on the scale:

- the `∞` in the plan-versions validity column drops from 14px to 13px. Its
  inline override sat on `.pd-arrow-inf`, and the `→` beside it on the same line
  carries the same class at `--sa-text-md` — the two were a pixel apart for no
  stated reason. The override is gone rather than tokenised.
- two 6px margins become 8px (`--sa-space-3`, which `--sa-gap-inline` also
  resolves to): the hint below the "allow zero price" toggle in the bundle
  publish dialog, and the "optional" hint beside the quotas heading in the
  bundle create panel.

If you override `.pd-arrow-inf`, `.bvpd__label` or `.bcp-field-hint`, those are
the three to look at.
