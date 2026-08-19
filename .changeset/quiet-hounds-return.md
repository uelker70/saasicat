---
'@saasicat/ui-vue': patch
---

Keep the shipped source compiling under ES2021

Four of this package's export subpaths hand out `.vue` and `.ts` straight from
`src/` rather than from a build — `pages/*`, `pages-standard/*`, `pages-tenant/*`
and `components/*`. (Four more serve stylesheets: three from `src/ui/theme/`,
which carries no TypeScript, and `sa-theme.css` from `src/pages-standard/`.)
That is deliberate: a consumer needs the source for
Quasar and Sass theming. The consequence is easy to miss, and 0.26.0 missed it:
**your** `tsconfig` compiles those files, not ours. Ours says `lib: ES2023`.

`AdminError`, new in 0.26.0, used `new Error(message, { cause })` — an ES2022
constructor overload. Any app importing one of those subpaths with a `lib` below
ES2022 got `error TS2554: Expected 0-1 arguments, but got 2` in a file it never
wrote. Measured on a real consumer targeting ES2021: clean on 0.23.0, one error
on 0.26.0.

Two older spots had the same defect without anyone reaching them yet:
`Object.hasOwn` in `nav-builder.ts`, and another `{ cause }` in
`SuperAdminSetupWizard.vue`. All three are fixed. `attachCause()` in
`src/client/attach-cause.ts` sets the property afterwards, which reads
identically to anything inspecting `error.cause` and needs nothing above ES5.

`AdminError` also declares `cause` now. It was only ever set at runtime, and
`Error.cause` is itself ES2022 — so on the floor this release declares, an app
could hand a cause in through `AdminErrorInit` and never read it back out.

**The floor is now stated and checked.** It is **ES2021** (`lib: ES2021, DOM`),
and `test:shipped-source` compiles the whole closure reachable from the
source-shipping subpaths at that level in CI. It is set the way a Vite consumer
sets it rather than to a bare language level — `isolatedModules`,
`useDefineForClassFields` and `strictPropertyInitialization`, the last two of
which this package's own config would otherwise leave milder than its subject.

The directory list comes from the export map rather than from a hand-written
list, so a new source subpath is covered the day it is added; a subpath whose
shape the derivation cannot express fails the check instead of being skipped.

One thing the check does not pin is the compiler version: `satisfies` in the
shipped source needs TypeScript 4.9 or newer whatever `lib` says. **TypeScript
5.0 or newer** is the supported minimum, stated in `CONTRIBUTING.md` — as prose,
because verifying it would mean installing old compilers.

Raising the floor is a breaking change for consumers below it and will be
announced as one.

Nothing else changes: `dist/` is built at the repo's own level as before, and
this only constrains code that consumers compile themselves.
