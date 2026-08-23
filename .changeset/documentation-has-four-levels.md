---
'@saasicat/cli': patch
'@saasicat/ui-vue': patch
'create-saasicat-admin': patch
---

The handbook is gone, and its twelve chapters are documents you can enter
directly: guides for a task, reference for a name, explanation for a why.
[`docs/README.md`](https://github.com/uelker70/saasicat/blob/main/docs/README.md)
is the map.

If you linked to a numbered section — `handbook.md#87-ui-language-i18n` and its
kin — the sections carry names now. The comments in the scaffolded files and in
`examples/notesapp` point at the new documents, and the numbered references they
used to carry are gone: a number was exactly what broke every time a section was
inserted.

Two contradictions the split removed, both of which sent readers the wrong way:
the architecture chapter presented seven individual `forRoot` calls as the way to
wire the backend while the quickstart used `SaaSiCatModule.forRoot`, and the
sub-entry rule said "never import the root" while the platform composition is
exported from there deliberately.
