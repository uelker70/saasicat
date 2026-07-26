---
'@saasicat/ui-vue': minor
'create-saasicat-admin': minor
---

Require Quasar >= 2.22.0. Earlier releases are affected by the prototype
pollution in Quasar's `extend()` utility (GHSA-3r53-75j5-3g7j), so the
`@saasicat/ui-vue` peer range and the generated admin scaffold now start at the
patched version. Consumers still on Quasar 2.18–2.21 need to upgrade.
