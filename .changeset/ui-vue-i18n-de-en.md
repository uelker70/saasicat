---
'@saasicat/ui-vue': minor
'create-saasicat-admin': minor
---

Localize the SuperAdmin UI: German (reference) and English message catalogs.

Every hard-coded German string in the standard pages, components and composables
now comes from a typed catalog. There is no `vue-i18n` dependency — the catalogs
are plain typed objects, so a missing key is a compile error rather than a gap at
runtime. German stays the default; nothing changes for existing apps that do not
opt in.

**Choosing the language** via `createSuperAdminApp()`:

```ts
createSuperAdminApp({
    // …
    i18n: { locale: 'en' },
});
```

Pass a `Ref<SaLocale>` instead of a literal to switch at runtime (the handle
exposes the same context as `handle.i18n`), and `i18n.overrides` to replace
individual strings per locale without forking a page. Components read the
catalog via `useSaMessages('<namespace>')` / `useSuperAdminI18n()`; outside a
shell both fall back to German, so isolated mounts and unit tests need no setup.

Switching the locale also re-renders sidebar labels and drawer sections, and
moves date, number and currency formatting plus search/sort collation to the
active locale.

**Breaking (0.x minor):**

- `DEFAULT_SECTION_ORDER` → `defaultSectionOrder(locale?)`. The drawer section
  names are locale-dependent, so a constant could not stay correct.

    ```diff
    -import { DEFAULT_SECTION_ORDER } from '@saasicat/ui-vue';
    +import { defaultSectionOrder } from '@saasicat/ui-vue';
    -buildSidebar(routes, DEFAULT_SECTION_ORDER);
    +buildSidebar(routes, defaultSectionOrder('en'));
    ```

- `DEFAULT_PILOT_COPY` removed — the pilot dialogs resolve their defaults from
  the catalog. The `PilotCopy` type stays as the consumer override API.
- Label-returning helpers reachable through the `./pages/*` and `./components/*`
  subpath exports take a trailing `locale` parameter and dropped their `…De`
  suffix: `formatDateDe`/`formatTsDe`/`formatRelativeDe` →
  `formatDate`/`formatTimestamp`/`formatRelative`, `BUNDLE_STATUS_META` →
  `bundleStatusMeta(status, locale)`, `STATUS_META` →
  `statusLabel(status, locale)` / `statusHint(status, locale)`.
- Developer-facing error messages (missing `endpoint`, unregistered action
  handlers, integration bugs) are now English. They target integrators, not end
  users, so they are deliberately not translatable — update any test that
  asserts on the German wording.

**New:**

- `@saasicat/ui-vue/client` exports the i18n core: `SaLocale`, `SA_MESSAGES`,
  `resolveMessages`, `formatMessage`, `formatCurrency` and `defineMessages`.
- `formatCurrency(amount, locale)` replaces nine copies of the same
  German-formatted euro helper. Whole amounts keep rendering without decimals
  (`29 €`), as before.
- Tenant-facing pages (`@saasicat/ui-vue/pages-tenant/*`) keep their prop-based
  `TenantPlanSectionI18n` map but now ship an English default alongside the
  German one, selected by `defaultTenantPlanSectionI18n(locale)`.
