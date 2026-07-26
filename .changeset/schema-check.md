---
'@saasicat/cli': minor
---

Add `saasicat schema check` — reports what a consumer's `schema.prisma`
is missing relative to the canonical prisma-fragments, and exits 1 on drift so
CI can gate on it.

`schema apply` only ever adds whole models: it carries no enums, and a model
that already exists is skipped rather than updated. After a package upgrade a
consumer schema therefore falls behind silently, and the gap only surfaces as a
runtime error. Run against the three schemas in this workspace, the new check
finds five missing `PlanVersion`/`BundleVersion` fields in the NotesApp example
itself, five in autohauspro, and two field mismatches in vereinsfux.

The check distinguishes two situations that look alike:

- A field or enum value missing from a declaration the consumer **does** carry
  fails the check — platform code reads it with the spec's type. Type,
  optionality and list changes fail for the same reason.
- A model or enum the consumer does not carry at all is reported as
  information. Not adopting a fragment is a decision, not drift.

Fields a consumer adds on top of a platform model are never reported:
extending them is supported, so a drift check has to tolerate it. Replacing a
spec `String` with a locally declared enum stays allowed too — the fragments
document that substitution explicitly.

The block parser `schema apply` used moved to `prisma-blocks.ts` and now
handles `enum` declarations as well; `extractModelNames`/`extractModelBlocks`
keep their signatures.
