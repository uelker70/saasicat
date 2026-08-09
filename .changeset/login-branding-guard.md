---
'@saasicat/ui-vue': patch
---

Stop a partial boot response from taking the login card down. The card read
`boot.project.displayName` behind an optional chain that only guarded `boot`, so
a payload without `project` threw inside a computed and blanked the page on the
next render — which the language switcher made easy to trigger.

The brand projection now lives in `resolveLoginBranding()` / `isProductionBoot()`
in the client layer, guarded and unit-tested, instead of in the SFC where it
could not be reached by a test.
