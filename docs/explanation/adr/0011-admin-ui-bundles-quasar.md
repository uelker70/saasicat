# ADR 0011 — The admin package bundles its framework, not its stylesheet

**Status:** accepted · **Date:** 2026-08-24

Supersedes the runtime half of
[ADR 0005](0005-ship-sfc-source-not-dist.md). That record still stands for
`@saasicat/ui-vue-tenant`, which ships nothing but source, and its language
floor still governs what a consumer's TypeScript compiles here.

## Context

`@saasicat/ui-vue` **is** the application SaaSiCat hands over. It creates its own
Vue instance, owns a route, and what it is built from is nobody else's business
— except that it was in everybody else's `package.json`. Because the components
shipped as source, a consumer's Vite compiled our SFCs, which meant installing
`quasar`, `@quasar/vite-plugin` and `sass` to build an application they only
mount. That is the opposite of the guest problem [ADR 0010](0010-tenant-ui-without-quasar.md)
solves for the tenant package: there the framework had to go, here it only had
to stop being the consumer's declaration.

ADR 0005 gave two reasons for shipping source, and one of them expired. It said
a consumer themes the pages through **Quasar's Sass variables**, resolved by
their build. [ADR 0009](0009-three-layer-design-tokens.md) moved theming onto
three layers of CSS custom properties a month later, and custom properties
resolve in the browser: a compiled bundle passes them through untouched.
Measured in this package: **one** `.scss` file, internal, and **zero** code uses
of `$primary` — all eight matches were comments.

## Decision

The components are built. `quasar` moves from `peerDependencies` to
`dependencies`; Vue, `vue-router` and Pinia stay peers, because two Vue
instances break `provide`/`inject` silently.

**Quasar's stylesheet is not bundled.** It is copied into `dist/` and exported
as `./quasar.css`, one import the consumer writes — beside the `./theme.css`
they already write. That is not a compromise; it is what the build does anyway.
Importing Quasar's components pulls in none of its CSS, measured: a library
build of the SFC surface emitted 11.4 KB of scoped styles and not one line of
Quasar's 251 KB reset.

Keeping it opt-in matters because of what that reset does to a document it does
not own. Measured against a host page that styles itself — its own reset,
Georgia at 18px, its own headings and controls — Quasar's stylesheet changed
**76 computed properties across 19 of 19 elements**: the body font and size,
`h1` from 40px to 96px, `box-sizing` globally, every form control. It comes from
44 of 3,171 selectors, the ones anchored on `html`, `body`, `*`, the six
headings and the bare controls. A consumer importing it accepts that today and
would keep accepting it — the difference bundling would make is that they could
no longer decline.

Branding moves with it. `createSuperAdminApp({ brand: { color } })` writes
`--q-primary` on the document element, and `--sa-color-accent` is declared as
`var(--q-primary, …)`, so one value moves both namespaces. Quasar's shipped
stylesheet resolves all eight brand colours through custom properties — 86
`var(--q-*)` uses — which is what makes a runtime value a complete replacement
for a Sass variable.

The four subpaths keep their `.vue` specifier and gain conditions: `types` still
resolves to the source, `default` resolves to the build. A consumer changes no
import.

## Alternatives considered

- **Inline Quasar into the output.** `preserveModules` put it under a
  `dist/node_modules/.pnpm/quasar@2.24.0/…` path — a build machine's directory
  layout in a published package — and a copy of the framework in every chunk
  that touches it. A `dependencies` entry says the same thing to a consumer and
  lets their installer dedupe it against their own.
- **Bundle the stylesheet too.** It would make the reset unavoidable and
  invisible. The 76 properties above are the reason that is a different
  decision from bundling the code, not the same one.
- **Emit `.d.ts` for the components.** A declaration graph is type-erased: the
  page barrel's `PageLoader` is `() => Promise<unknown>`, and a page's
  declaration does not reference the children it renders. Shipping them left
  `dist-is-self-contained` reporting output nothing imports, for a reason that
  was true rather than a defect. The source is better types anyway — slots and
  generic components survive it intact.
- **Keep shipping source.** It is one line in a consumer's config against three
  installed packages, and the premise it rested on had already expired.

## Consequences

- A consumer installs `@saasicat/ui-vue` and adds two stylesheet imports. No
  `quasar`, no `@quasar/vite-plugin`, no `sass`. `examples/notesapp/admin` is
  the proof: it builds and typechecks with none of the three.
- **One stylesheet instead of per-page CSS.** `preserveModules` emitted each
  SFC's `<style>` as a chunk nothing imported — 50 stylesheets that would have
  shipped and never loaded, which `dist-is-self-contained` caught. Ordinary
  chunking merges them, and the components' styles arrive as one 199 KB file
  rather than split per page. The consumer's JavaScript splitting is unchanged:
  11 page chunks before, 11 after.
- Measured on `examples/notesapp/admin`: 1.8 MB of build output before, 1.6 MB
  after — CSS moves from 11 files (250 KB of Quasar plus ~130 KB of pages) to
  one 377 KB file, and JavaScript is 869 KB.
- A consumer who uses Quasar for their own application now has two copies unless
  their installer dedupes them, and they should keep `quasar` in
  `resolve.dedupe`. It is their singleton now, not this package's peer.
- **ADR 0005's two module instances are gone** for this package: `dist/` is the
  only runtime copy. `Symbol.for` on injection keys stays — the tenant package
  still ships source, and the registry keys are a published contract.

## What breaks if you ignore this

Writing a new `.vue` under `src/pages/`, `src/layouts/`, `src/auth/` or
`src/ui/` and expecting a consumer to compile it: they no longer do. The build
picks the file up automatically — `vite.build.config.ts` derives its entries
from those directories — but a component placed outside them is reachable from
neither the export map nor the build, and the failure is an import that resolves
to nothing in somebody else's repository.

Adding a stylesheet import inside a component is the other one. With
`cssCodeSplit` off, everything lands in the single `./style.css`; a consumer who
imports only `./theme.css` sees the components unstyled, which is why the
package README lists all three imports rather than describing them.
