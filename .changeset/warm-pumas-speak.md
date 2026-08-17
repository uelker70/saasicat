---
'@saasicat/ui-vue': patch
---

Say the batch-column diagnostics in English

Two errors an integrator reads in a browser console were German, and one JSDoc
comment on a public prop was too. The repository requires English for
developer-facing text; nothing checked it, so these travelled through several
releases.

`BatchColumnDriftError` said `Spalte "x": …` and now says `Column "x": …`. The
non-200 diagnostic in `fetchOne` said `Spalte "x" — Endpoint /y antwortete HTTP
503` and now says `Column "x" — endpoint /y responded with HTTP 503`, which is
the phrasing `BootLoadError` already uses. Both are `message` text, not an
error class, code or status: a consumer that matches on the class, on
`instanceof`, or on the status is unaffected; one that matches the German
sentence is not, and that is the reason this is called out rather than left
silent.

The third is the `savePill` prop of `PlanCycleToggle`, whose JSDoc reaches a
consumer's editor tooltip. Besides being German, it named a German label —
`"Jährlich"` — for a pill that sits beside a _localized_ yearly label, so the
example was wrong in every other locale as well.

Both diagnostics are now asserted in full by the package suite rather than by a
`/HTTP 503/` fragment, which is what let the German sit there while the test
stayed green. The JSDoc has no such check, and no cheap honest one was added:
the obvious umlaut scan sees neither of the two throw sites — `antwortete` has
no umlaut — while flagging ten legitimate files, among them the `Türkçe`
endonym and the transliteration maps.
