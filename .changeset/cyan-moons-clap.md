---
'@saasicat/ui-vue': minor
---

Add the theme switcher to the shell chrome. Light, dark and system were already
implemented — `useSaTheme` has had all three states, a live `prefers-color-scheme`
subscription and persistence for several releases — but no user interface read
them, so the only way to leave light mode was a JavaScript console.

`ThemeSwitcher` now sits next to `LocaleSwitcher` in the `AdminLayout` header, on
the login card and on the first-run setup card. It behaves like its sibling:
`theme: { switcher: false }` removes it, a readonly `scheme` ref removes it on its
own, and it can be imported into your own chrome from
`@saasicat/ui-vue/components/ThemeSwitcher.vue`.

Two related changes:

- `theme.storageKeyPrefix` separates the persisted pick, mirroring
  `i18n.storageKeyPrefix`. Without it two admin apps on one origin share
  `saasicat.theme.scheme` and inherit each other's choice — reachable for the
  first time now that the pick can be made from the interface. The key itself is
  unchanged.
- The Quasar bridge reads `Dark.mode` instead of `Dark.isActive`, so
  `$q.dark.set('auto')` arrives as `'system'` rather than as whatever the machine
  reported at that instant. A hard `$q.dark.set(true)`/`set(false)` still replaces
  the pick with the scheme it names, which is what it asks for.
