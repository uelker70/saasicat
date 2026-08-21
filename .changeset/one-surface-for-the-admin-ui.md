---
'@saasicat/ui-vue': major
---

**The UI package has one name for each thing again.** Its export map went from
37 entries to 13, and the surface it hands out is now the one the architecture
describes rather than the one that accumulated.

**`./pages-standard/*` is gone.** It was a second spelling of `./pages/*` —
same files, two names, and both consumer apps used both. Import from `./pages/`.

**`./components/*` is gone.** What it published was everything that happened to
sit in one directory: page skeleton primitives beside domain components beside
page-private parts. The primitives are `./ui/*.vue` now — `AdminPage`,
`AdminTable`, `AdminHero` and the rest, plus `FeatureGate` and
`MfaPromptDialog`. The domain and page-private components are not published at
all; they were never meant to be a public surface, and importing them tied your
app to our internal structure.

**Three files moved out of `./pages/`:** `AdminLayout.vue` is `./layouts/`,
`SuperAdminLoginPage.vue` and `SuperAdminSetupWizard.vue` are `./auth/`.

**Source subpaths end in `.vue` now** — `./pages/*.vue` rather than `./pages/*`.
A subpath that hands out a directory hands out everything in it.

**New: `./vue`.** The package is three layers — `client` (framework-free),
`vue` (composables), `quasar` (bootstrap) — and until now only two of them had
an entry. The main entry still works and is wider: it re-exports the `client`
layer as well. `./vue` is the narrow door.

### Migrating

```bash
npx @saasicat/cli@latest codemod v1-imports --dir=./src
```

It rewrites every subpath that has a new home and reports the ones that no
longer have one — for those, copy what you need into your own repository. Add
`--dry-run` to see what it would do first.

The rules come from the same table the platform's own move ran on, shipped with
the CLI, so what your imports become cannot disagree with where the files went.
Measured against the two apps we know: 2 imports in one, 42 in the other, and
neither imports anything that became unreachable.
