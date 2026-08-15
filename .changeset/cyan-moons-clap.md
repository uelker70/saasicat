---
'@saasicat/ui-vue': minor
---

Add the theme switcher to the shell chrome. Light, dark and system were already
implemented — `useSaTheme` has had all three states, a live `prefers-color-scheme`
subscription and persistence for several releases — but no shipped user interface
read them, so unless your app carried its own toggle the only way to leave light
mode was a JavaScript console.

`ThemeSwitcher` now sits next to `LocaleSwitcher` in the `AdminLayout` header, on
the login card and on the first-run setup card. It behaves like its sibling:
`theme: { switcher: false }` removes it, a readonly `scheme` ref removes it on its
own, and it can be imported into your own chrome from
`@saasicat/ui-vue/components/ThemeSwitcher.vue`.

Three related changes:

- `theme.storageKeyPrefix` separates the persisted pick, mirroring
  `i18n.storageKeyPrefix`. Without it two admin apps on one origin share
  `saasicat.theme.scheme` and inherit each other's choice — reachable for the
  first time now that the pick can be made from the interface. The key itself is
  unchanged.
- The Quasar bridge now tells its own writes apart from your app's. It reads
  `Dark.mode` rather than `Dark.isActive`, so `$q.dark.set('auto')` arrives as
  `'system'` instead of as whatever the machine reported at that instant; and it
  decides whether to adopt a write by whether the bridge caused it, not by
  whether the colour on screen changed. A hard `$q.dark.set(true)`/`set(false)`
  therefore replaces the pick with the scheme it names even when that scheme is
  what `'system'` was already resolving to — previously such a write was mistaken
  for the bridge's own echo and dropped, and the theme then walked away from the
  selection at the next change of the operating system. The one write the bridge
  still cannot see is a `set()` that repeats the mode Quasar already holds:
  nothing changes for it to read, so set `theme.scheme` for that case.
- The brand mark on the login and setup cards keeps its size. Adding a second
  switcher made those rows wider than the card, and a flex row takes the
  shortfall from every item that can give — the 44px mark included. Measured, it
  came out as little as 33.56px at 1440 on the setup card, and disappeared from
  the login card entirely at 320. The mark is now pinned and the brand text
  absorbs the difference by wrapping. The setup card's heading block gained a
  class, `.sa-setup-headings`, so it can carry that rule.
