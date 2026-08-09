---
'@saasicat/ui-vue': minor
---

Hand the language set to the app. The platform ships German and English and
stops there — which of them an app offers, and which languages it adds, is now
its own decision instead of a platform release.

- `i18n.locales` narrows the offered set. A single entry hides the switcher, and
  the starting locale follows the selection, so an English-only app no longer
  starts in German. A stored pick for a language the app dropped is ignored.
- `i18n.additionalLocales` adds languages the platform does not ship, each with
  its switcher label, `Intl` tag and a deep-partial catalog. Untranslated keys
  fall back to `basedOn` (default `'en'`), so a translation is usable from its
  first key onwards.
- `i18n.storageKeyPrefix` separates apps that share one origin, mirroring
  `createPlatformLoaders`.

Two defects surfaced on the way. `buildRoutes()` read the built-in catalogs by
locale code, so `i18n.overrides` never reached the sidebar and an app-supplied
language would have crashed it; it now takes the resolved `nav` catalog, which
`AdminLayout` passes. And an active locale the catalog cannot render falls back
instead of blanking the shell.

Breaking: `SaLocale` is now an open string type — the two the platform ships are
`SaBuiltinLocale`, and the guard `isSaLocale` is `isSaBuiltinLocale`. Catalog
maps (`SA_MESSAGES`, `SA_INTL_LOCALES`, `SA_LOCALE_LABELS`) are keyed by
`SaBuiltinLocale`.

Known gap: a few helper modules still index the built-in catalogs directly
(discovery status labels, relative dates, bundle status), so those strings stay
in the fallback language for an app-supplied locale. Everything reached through
`useSaMessages` translates fully.
