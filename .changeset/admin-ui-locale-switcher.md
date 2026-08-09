---
'@saasicat/ui-vue': minor
---

Add a language switcher to the SuperAdmin shell. The `AdminLayout` header and
the login page (first-run setup wizard included) now render a `LocaleSwitcher`
that lists every locale in `SA_LOCALES` by its own name, so users reach the
English catalog without an app-side control. The pick is persisted under the
`sa:locale` key and outranks the `i18n.locale` option on the next visit;
`i18n.persist: false` or an app-supplied `Ref` keeps the locale under app
control as before.
