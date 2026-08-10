---
'@saasicat/ui-vue': patch
---

The promo-code dialogs now share their form body through one internal
component. Create and edit had kept byte-identical copies of it. The public
surface of both dialogs — props, emits, class names — is unchanged.
