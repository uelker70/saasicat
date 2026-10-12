---
'@saasicat/ui-vue': patch
---

`@saasicat/ui-vue` asks for Quasar `^2.32.2`, past GHSA-89vp-x45c-52cq, in which
`openURL()` could be made to fail through DOM clobbering. Quasar 2.32 sets an
icon's ligature name in a `span` of its own and lays a field's hint or error
line out in the field's own height; neither moves anything on the admin's
pages.
