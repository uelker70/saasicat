---
'@saasicat/ui-vue': patch
---

`@saasicat/ui-vue/quasar.css` imports `quasar/dist/quasar.css` instead of
holding a copy taken when the package was built. Your bundler resolves it from
the Quasar this package runs on, so the stylesheet always matches the
JavaScript, whatever Quasar release your installer picks. The copy in
`1.0.0-rc.25` held Quasar 2.24's stylesheet while a fresh install ran 2.35. The
import you write is unchanged (ADR 0014).
