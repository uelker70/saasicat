---
'@saasicat/ui-vue': minor
---

Bundle actions sit with the object they act on

The bundle detail panel edits two things — the bundle and the selected version —
and it offered four action clusters in three places. The one that mattered: a
full-width footer paired "publish this version" with "soft-delete bundle". One
releases a draft; the other destroys the bundle and every version it has. They
looked like peers, and the delete sat in the same corner as save, a button's
height below it.

Publish moves up into the version editor's own action bar, beside reset and
save, which is where the version's work already happens. Soft-delete moves into
the card header as an icon button with a tooltip, at the bundle's own row. The
footer is gone, because nothing acts on both columns any more. Discard stays in
the draft banner, where it reads as part of the draft's state.

Two things follow from having two forms in one panel: the master-data save now
says whether there is anything to save — a marker on the section and a disabled
button when nothing changed — and its label already named its object, so the
version's save now does too ("Save version").

Both confirmations on this page went through `window.confirm`. They go through
the platform's confirm port now, like every other destructive action in the
admin, and say what will happen: "Soft-delete bundle "Export Pro"? All 2
version(s) leave the administration."

**If you override the bundle messages**, two keys changed shape.
`bundles.page.confirmSoftDelete` took `{bundleKey}` and now takes `{label}` and
`{versions}`; `confirmDiscardVersion` takes no placeholder and gained a title
key beside it. Overriding a message with the old placeholder renders the
placeholder. New keys: `page.confirmSoftDeleteTitle`,
`page.confirmDiscardVersionTitle`, `editor.saveVersion`,
`detail.unsavedChanges`.
