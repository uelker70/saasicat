---
'@saasicat/ui-vue': patch
---

The brand colour no longer disappears in dark mode.

`--sa-color-accent` is the host's `$primary`, and it is the one role that does
**not** change between themes — that is what a brand is. Everything around it
does. So it reads at about 4.5:1 on a light card, near 3.4:1 on the dark theme's
slate, and worse on a tint of itself — which is exactly what a selected state is
made of. Six rules paired the two, and every one of them looked right in light
mode: the promo dialog's chosen duration and plan chips, the dashboard's KPI and
shortcut icons, a status pill, an onboarding eyebrow.

They now use `--sa-color-accent-strong`, which the design guide already names for
"accent text on a tint" and which mixes the brand toward the theme's own extreme
— darker in light, lighter in dark. Branding still follows `$primary`. Measured
on the promo dialog's selected state: 3.99 → 5.35:1 light, 3.40 → 4.20:1 dark.

A rule in `theme-layer-discipline` fails the build on the pairing from now on.

**Plan and tenant chips get the same treatment, and they needed it more.**
`identityChipStyle()` painted its accent as text on an 8 % wash of that same
accent, and it does so from an inline `style`, which beats the class rules above
— so a plan carrying its own `color` kept the unreadable pairing. It also takes
a colour nobody curates: a stored plan colour, or anything a consumer passes in
`planAccents`. The text is now mixed halfway toward `--sa-color-fg-heading`,
which is near-black in light and near-white in dark. All six colours the
promotion editor itself stores were under 3:1 on a raised dark card (1.99–2.75)
and four of them on a plain one; they now read 5.48–7.78. Chip backgrounds,
borders and the plan dot are unchanged, so
each plan keeps its identity. `theme-role-contrast` measures the helper across
the whole sRGB cube, not a sample, because the input is not a role.

**Quasar's own accent text is painted too.** The focused field's floating label
and the selected item in an open select are coloured `--q-primary` by Quasar, on
surfaces the theme darkened — the shrunk label is small text and read as
decoration rather than as the name of the field being edited. Both now take the
same readable role, including inside teleported
menus — except while a field is invalid, where Quasar's error colour still wins.
That carve-out is deliberate: the label inherits the error red from the control,
and colouring it at all cut that inheritance, so an invalid field looked normal
while every other error indicator stayed red.

**Two more, reported from a running admin.** The promo dialog's status buttons
had no styles at all and rendered as raw browser buttons on a dark dialog; they
share the segmented-control recipe with the duration row next to them now. And
the marketing catalogue's open editor ended on the same colour and the same
hairline as an ordinary row, so the next plan read as part of the plan being
edited — it is a recessed well with an accent edge and a real closing border.
