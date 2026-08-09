---
'@saasicat/ui-vue': minor
---

Harden the language switcher and the storage it uses.

`defaultKvStore()` no longer lets a browser take the app down: reading
`globalThis.localStorage` throws `SecurityError` when site data is blocked (a
sandboxed iframe, cookie blocking), and `typeof` evaluates that getter rather
than guarding it. Since the locale persistence put storage on the mandatory
boot path of `createSuperAdminApp()`, that throw meant a blank admin page.
Access and every read/write are now guarded, so persistence degrades to a no-op
instead — which also covers `QuotaExceededError` in Safari's private mode for
the manifest ETag cache.

The switcher gained an off switch: `i18n.switcher: false` for deployments that
ship a single language. A readonly `locale` ref (typically a `computed`)
disables it automatically — TypeScript accepts one because it ignores
`readonly` in assignability checks, and writing to it would fail silently.

On the login and first-run cards the switcher now sits inside the card instead
of floating above the page, where it collided with the centered card on short
viewports. The provider-less fallback context no longer persists, so it cannot
make test outcomes depend on their order.
