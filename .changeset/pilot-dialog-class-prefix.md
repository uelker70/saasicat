---
'@saasicat/ui-vue': patch
---

PilotEditDialog now uses the same class names as PilotCreateDialog. The styles
are scoped, so the rename has no effect on consumers — it only makes visible
that both dialogs draw the same building blocks.
