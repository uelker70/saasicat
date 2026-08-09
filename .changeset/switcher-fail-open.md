---
'@saasicat/ui-vue': patch
---

Show the language switcher unless it is explicitly disabled. The injection key
is a `Symbol.for`, so an i18n context created by an older copy of the package
resolves in the current `LocaleSwitcher` — and that context carries no
`switcherEnabled` field. Reading the missing field as "disabled" made every
switcher disappear after such an upgrade with nothing logged anywhere, so only
an explicit `false` hides it now.
