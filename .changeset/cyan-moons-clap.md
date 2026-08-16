---
'@saasicat/ui-vue': minor
---

Add the theme switcher to the shell chrome. Light, dark and system were already
implemented — `useSaTheme` has had all three states, a live `prefers-color-scheme`
subscription and persistence for several releases — but no shipped user interface
read them. The scheme was therefore whatever the app configured or the operating
system reported, and unless your app carried its own toggle the operator had no
way to choose.

`ThemeSwitcher` now sits next to `LocaleSwitcher` in the `AdminLayout` header, on
the login card and on the first-run setup card. It behaves like its sibling:
`theme: { switcher: false }` removes it, a readonly `scheme` ref removes it on its
own, and it can be imported into your own chrome from
`@saasicat/ui-vue/components/ThemeSwitcher.vue`.

Four related changes:

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
  that moves `Dark.mode` — away from `'auto'`, for instance — therefore replaces
  the pick with the scheme it names even when the colour on screen does not
  change; previously such a write was mistaken for the bridge's own echo and
  dropped, and the theme then walked away from the selection at the next change
  of the operating system. The one write the bridge still cannot see is a `set()`
  that repeats the mode Quasar already holds: nothing changes for it to read, so
  set `theme.scheme` for that case.
- The brand mark on the login and setup cards keeps its size. Adding a second
  switcher made those rows wider than the card, and a flex row takes the
  shortfall from every item that can give — the 44px mark included. Measured, it
  came out as little as 33.56px at 1440 on the setup card, and disappeared from
  the login card entirely at 320. The mark is now pinned (`flex: none`) and the
  brand text is allowed to shrink (`min-width: 0`), so the shortfall lands there
  and the text wraps. The setup card's heading block gained a class,
  `.sa-setup-headings`, so it can carry that rule.
- The `AdminLayout` header stays inside narrow viewports. Its toolbar does not
  wrap, and the second switcher pushed the row past the edge: measured on the
  example app, the row's right edge moved from 319.4px to 382px, putting the
  sign-out button outside a 320px and a 360px viewport; a header that also
  carries a user name and an email was outside from 320px through 600px.
  Nothing scrolled to bring it back — the header is `position: fixed`, which is
  excluded from the page's scrollable overflow, so the button was simply not
  there. Below `sm` (600px) both switchers now render as icons without their
  labels, and the role badge and the user's name and email are hidden: the badge
  repeats a word the subtitle beneath the title already carries, and the name
  cost the title itself, which measured 24px — one letter — at 360. The avatar
  and the sign-out button stay, so nothing you can press is removed. From `sm`
  up the name and email are shown and truncate with an ellipsis rather than
  pushing the sign-out button along. Every control in the header now stays
  inside the viewport from 320px up; if you override `.sa-admin-badge`,
  `.sa-admin-user`, `.sa-admin-user__name` or either switcher's class, check
  them against those widths.
