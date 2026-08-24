---
'@saasicat/ui-vue': minor
---

Every icon in the admin UI is now a `q-icon` with a Material Icons name. The 51
hand-drawn `<svg>` glyphs are gone.

**Why it matters to you.** The package drew its own icons in 17 files while
asking Quasar for the same pictures in 112 other places, and it had never chosen
between the two — both arrived together when the package was extracted, and
nobody looked again. The result was drift a reader cannot see from one file: one
checkmark existed in three different geometries, and at 11px in three different
stroke widths, so the same tick did not look the same on two pages. Twenty-six of
the 51 declared nothing about themselves to a screen reader — not on the glyph
and not on a wrapper — where `q-icon` marks every one decorative. And none of the
51 set `stroke-linecap`, which the geometry they were copied from is drawn for, so
every one rendered with cut ends and sharp corners.

**What changed for you.** The glyphs are Material's now, so they read a little
heavier than the thin strokes they replace, most visibly at 10 and 11px. If you
styled one by element — `.pd-timeline-hint svg` and its kin — target `.q-icon`
instead. The lock on a blocked delete no longer carries its own `opacity: 0.4`
on top of the disabled button's, which had it rendering at roughly 0.24 against
the surface, below the 3:1 a graphical element needs.

`@saasicat/ui-vue-tenant` is untouched. It renders inside your application and
brings no UI framework (ADR 0010), so its four glyphs stay hand-drawn — and the
guard that keeps Quasar out of it now also refuses the `@quasar/*` scope, which
is how the shared icon geometry would have crept back in.

`saasicat/no-restricted-components` refuses a raw `<svg>` in this package,
including under `src/ui/` where the path escape had been covering one.

**The plans page reports its successes through the notify port.** Its seven
confirmations — plan created, draft saved, version published, plan deleted and
their kin — went through a page-local toast component that reimplemented what
`useSuperAdminNotify()` already does for every other page, down to its own
`setTimeout` that nothing cleared on unmount. They now go through the port, so a
`notify` you provide to `createSuperAdminApp()` receives them like the rest, and
the `.sa-plans__toast` classes are gone. This surfaced because taking 510 lines
of hand-drawn markup out of the package pushed that file to the top of the
`<style>`-share ratchet without adding a single line of CSS — the file was the
second-worst already, and the ratchet was pointing at something real.
