# ADR 0014 — Quasar's stylesheet comes from the Quasar the administration runs

**Status:** accepted · **Date:** 2026-10-12

Supersedes in part [ADR 0011](0011-admin-ui-bundles-quasar.md): its decision
that Quasar's stylesheet is copied into `dist/`. Everything else in it stands —
the components are built, `quasar` is a dependency, and the stylesheet stays an
import the consumer writes.

## Context

ADR 0011 copied `quasar/dist/quasar.css` into `dist/assets` at build time and
exported it as `./quasar.css`. The JavaScript did not travel with it: `quasar`
is external in the build and a dependency under `^`, so the application's
installer resolves it at the newest minor it admits. The two halves of one
framework came from two releases.

Quasar's minors change markup and stylesheet together. Moving from 2.24 to 2.32
set an icon's ligature name in a `span` of its own, added a class to a select's
value and moved a field's hint line into the field's own height. The published
`1.0.0-rc.25` ships the stylesheet of Quasar 2.24.0, byte for byte, and asks for
`^2.24.0`, which a fresh install resolves to 2.35.1, the newest release when
this was written. Regenerating this repository's lockfile resolved `^2.32.2` to
a 2.35 release as well.

## Decision

`dist/assets/quasar.css` no longer holds Quasar's rules. It holds one import:

```css
@import 'quasar/dist/quasar.css';
```

The application's bundler resolves it from where the file lies, inside this
package, so from this package's own `quasar` — the installation its
JavaScript comes from. The two halves then match whatever release the installer
picks. Quasar's `exports` map (`"./*"`) publishes the file, and it names no
fonts by relative path, so nothing else has to travel with it.

The consumer's line does not change: `import '@saasicat/ui-vue/quasar.css'`.

The Material Icons font is still copied. Its stylesheet names the font files by
relative URL, and a URL is fetched by the browser from wherever the stylesheet
was served, so the files have to sit beside it.

## Alternatives considered

- **Pin Quasar to the minor the package was built with** (`~2.32.2`). The halves
  would match, but an application that uses a newer Quasar minor itself would
  install a second copy: two Quasar instances, with `Dark.set()` in one leaving
  the other light, as the upgrade guide warns.
- **Keep the copy and run the end-to-end suite against the newest Quasar in
  CI.** It would show a mismatch early, but not prevent one in an application
  that installs after a Quasar release and before ours.
- **Make Quasar a peer again.** It would undo ADR 0011's reason for existing:
  the integrator installs one package and nothing else.

## Consequences

- The consumer's bundler has to resolve a bare `@import` in a stylesheet from
  `node_modules`. Vite does, and it is what the platform's guides build with.
- Nothing of Quasar's is distributed in the tarball any more, so its licence no
  longer travels with it (`SC-SEC-017` still governs the font's copy).
- `tests/quasar-stylesheet-is-the-installed-quasars.test.js` holds that the
  file is the import and nothing else, and that it resolves from the same
  Quasar installation as the JavaScript (`SC-UI-027`).

## What breaks if you ignore this

Putting Quasar's stylesheet back into `VENDOR_COPIES`, or writing rules of our
own into `dist/assets/quasar.css`, fixes the stylesheet at the release this
package was built with again. Nothing fails at once: the pages render, and they
drift from the JavaScript only once the application's installer picks a newer
Quasar minor, which changes markup the old stylesheet does not know. The unit
test fails first, because the file is no longer exactly the import.

Removing the import, or breaking the path to it, leaves the administration
without Quasar's reset and layout. Every consumer spec but one stays green
without it; `consumer-quasar-stylesheet.spec.ts` is the one that reads Quasar's
own rules off an assembled application's page.
