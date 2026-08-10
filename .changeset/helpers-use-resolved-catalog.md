---
'@saasicat/ui-vue': minor
---

Let every string follow an app-supplied language. A handful of helper modules
still indexed the built-in catalogs by locale code — discovery status labels and
hints, review actions, relative dates, bundle status. An app that added French
got a French shell with 34 strings stranded in the fallback language, and
`i18n.overrides` never reached them either, for the same reason the sidebar
missed them before 0.17.0.

They take the resolved catalog slice now, the way `buildRoutes()` takes `nav`:

```ts
statusLabel(status, msg); // was: statusLabel(status, locale)
formatRelative(iso, planVersions); // was: formatRelative(iso, locale)
bundleStatusMeta(status, bundles); // was: bundleStatusMeta(status, locale)
i18nFieldLabel(field, discovery, common); // was: i18nFieldLabel(field, locale)
```

Breaking for anyone calling those four directly; the platform pages are updated.
`builtinLocaleOf()` is gone with them — it existed only to keep those lookups
from crashing on a locale they had no entry for.
