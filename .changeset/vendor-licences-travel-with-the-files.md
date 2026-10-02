---
'@saasicat/ui-vue': patch
---

Ship the licences of the vendor files `@saasicat/ui-vue` copies

The package copies Quasar's stylesheet (MIT) and the Material Icons font
(Apache-2.0) into `dist/assets`, so it distributes them, and both licences ask
for their terms to go with every copy. They now do, copied from the packages
they come from (`SC-SEC-017`): `quasar.css.LICENSE.txt` beside the stylesheet,
and beside the font both its own licence (`material-icons/LICENSE.txt`) and
that of the package it ships in (`material-icons/PACKAGE-LICENSE.txt`).
Nothing changes for an application that imports `@saasicat/ui-vue/quasar.css`
or `icons.css`.
