# @saasicat/ui-vue

## 0.18.0

### Minor Changes

- ccdd7b1: Let every string follow an app-supplied language. A handful of helper modules
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

### Patch Changes

- @saasicat/types@0.18.0

## 0.17.0

### Minor Changes

- 9ecbbff: Hand the language set to the app. The platform ships German and English and
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

### Patch Changes

- 4419016: Stop a partial boot response from taking the login card down. The card read
  `boot.project.displayName` behind an optional chain that only guarded `boot`, so
  a payload without `project` threw inside a computed and blanked the page on the
  next render — which the language switcher made easy to trigger.

    The brand projection now lives in `resolveLoginBranding()` / `isProductionBoot()`
    in the client layer, guarded and unit-tested, instead of in the SFC where it
    could not be reached by a test.

- cbd1737: Remove consumer domain vocabulary from the platform.

    `slugify()` fell back to the literal `'verein'` when a tenant name reduced to
    nothing, and that value reaches the tenant slug during registration — so a car
    dealership or a notes app could end up on a slug from someone else's business.
    The fallback is now `'tenant'`, the platform's own term. This changes observable
    output for degenerate input (empty, whitespace-only, or a name with no ASCII
    letters).

    Two placeholder texts in the shared catalogs carried club vocabulary as their
    example — the bundle description ("for active clubs") and the marketing feature
    label ("Membership management"). Both are now domain-neutral; apps that want
    their own wording set it via `i18n.overrides`.

    Doc comments that illustrate how an app supplies its _own_ vocabulary are kept
    deliberately: they document the extension point rather than leak a domain into
    the platform.

- Updated dependencies [cbd1737]
    - @saasicat/types@0.17.0

## 0.16.0

### Minor Changes

- f734b71: Add a language switcher to the SuperAdmin shell. The `AdminLayout` header and
  the login page (first-run setup wizard included) now render a `LocaleSwitcher`
  that lists every locale in `SA_LOCALES` by its own name, so users reach the
  English catalog without an app-side control. The pick is persisted under the
  `sa:locale` key and outranks the `i18n.locale` option on the next visit;
  `i18n.persist: false` or an app-supplied `Ref` keeps the locale under app
  control as before.
- 2ed46a4: Harden the language switcher and the storage it uses.

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

### Patch Changes

- 02ff350: Show the language switcher unless it is explicitly disabled. The injection key
  is a `Symbol.for`, so an i18n context created by an older copy of the package
  resolves in the current `LocaleSwitcher` — and that context carries no
  `switcherEnabled` field. Reading the missing field as "disabled" made every
  switcher disappear after such an upgrade with nothing logged anywhere, so only
  an explicit `false` hides it now.
    - @saasicat/types@0.16.0

## 0.15.1

### Patch Changes

- @saasicat/types@0.15.1

## 0.15.0

### Patch Changes

- @saasicat/types@0.15.0

## 0.14.0

### Patch Changes

- @saasicat/types@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [362a1a7]
    - @saasicat/types@0.13.0

## 0.12.1

### Patch Changes

- @saasicat/types@0.12.1

## 0.12.0

### Patch Changes

- @saasicat/types@0.12.0

## 0.11.0

### Patch Changes

- @saasicat/types@0.11.0

## 0.10.1

### Patch Changes

- @saasicat/types@0.10.1

## 0.10.0

### Patch Changes

- @saasicat/types@0.10.0

## 0.9.0

### Minor Changes

- 6524f04: Require Quasar >= 2.22.0. Earlier releases are affected by the prototype
  pollution in Quasar's `extend()` utility (GHSA-3r53-75j5-3g7j), so the
  `@saasicat/ui-vue` peer range and the generated admin scaffold now start at the
  patched version. Consumers still on Quasar 2.18–2.21 need to upgrade.
- b30a110: Add a high-level SaaSiCat standard stack that wires catalog, entitlements,
  tenant billing and subscription bundles from one persistence bundle. The
  Prisma bundle now includes the canonical catalog and tenant-billing adapters,
  including a reusable subscription usage mapper and standard Admin resource
  adapter. Tenant, user, audit and subscription controllers plus promo-code CRUD
  can now be enabled with two flags. The Vue client supplies the matching
  resource loaders and actions. Existing fine-grained modules and adapter
  overrides remain available.

### Patch Changes

- Updated dependencies [b30a110]
    - @saasicat/types@0.9.0

## 0.8.0

### Minor Changes

- 1003a52: Remove the obsolete `PlanVersionsPage`, its standard navigation manifest key,
  and the synthetic client-side catalog snapshot projection. Plan lifecycle and
  per-plan version history remain in `PlansPage`; `MarketingCatalogPage` remains
  the separate marketing projection.

    Retain the reusable catalog timeline and diff components behind a presentation
    contract that can consume immutable Publication Archive / Catalog History
    snapshots from issues #30 and #35.

### Patch Changes

- Updated dependencies [1003a52]
    - @saasicat/types@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [05729ce]
    - @saasicat/types@0.7.0

## 0.6.0

### Minor Changes

- 0c08fc3: Remove the BusinessType catalog concept across the public contracts, NestJS
  modules, persistence adapters, UI, OpenAPI specification, and canonical database
  schema. Subscriptions now always reference a plan version; bundles remain the
  only composable catalog add-on.
- 1af2364: Localize the SuperAdmin UI: German (reference) and English message catalogs.

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

### Patch Changes

- Updated dependencies [0c08fc3]
    - @saasicat/types@0.6.0

## 0.5.0

### Minor Changes

- 6c28b77: Layer the SuperAdmin UI package: framework-free client core, Quasar-free main entry, dedicated Quasar entry.

    **Breaking (0.x minor):** `createSuperAdminApp()`, `CreateSuperAdminAppOptions` and `SuperAdminAppHandle` moved from the main entry to `@saasicat/ui-vue/quasar`:

    ```diff
    -import { createSuperAdminApp } from '@saasicat/ui-vue';
    +import { createSuperAdminApp } from '@saasicat/ui-vue/quasar';
    ```

    Everything else keeps its import path — injection keys, shell option types and `buildNavigationGuard` now live in the Vue layer and stay exported from the main entry. The scaffolder template already uses the new path.

    New:

    - `@saasicat/ui-vue/client` — the framework-free core (BootLoader, ManifestLoader with ETag cache, nav builder, action registry, batch column fetcher, HTTP contract) as its own entry with zero Vue/Pinia/Quasar imports.
    - The main entry no longer executes any `quasar` import at module load — Quasar is now a truly optional peer dependency. (`pinia`/`vue-router` are still loaded by the main entry, unchanged, for the store factory and `ProjectPageHost`.)
    - UI notify port: standard pages emit toasts via the injected `UiNotify` port (`SUPER_ADMIN_NOTIFY_KEY`) instead of calling `$q.notify` directly. `createSuperAdminApp()` provides a Quasar-backed default (same behavior as before); override it with `createSuperAdminApp({ notify })`. Without a bootstrap the pages fall back to Quasar `Notify`.
    - Layer boundaries (client ← vue ← quasar/SFCs) are enforced via ESLint `no-restricted-imports` in CI.

    Scaffolder fixes (pre-existing bugs surfaced by an end-to-end build of the scaffolded app):

    - `main.ts` template passed `manifestGuard: { errorRoute }` without the required `ensureLoaded` — the scaffolded app did not compile. The template now wires the documented pattern: `services/platform-loaders.ts` (`createPlatformLoaders`) + `stores/manifest.ts` (`createManifestStore`) feed the manifest guard.
    - `vite.config.ts` template passed `sassVariables` as a plain relative path, which current sass versions resolve against the importing file inside `node_modules/quasar` — the production build failed. Now passed as an absolute `fileURLToPath` URL.

### Patch Changes

- @saasicat/types@0.5.0

## 0.4.0

### Patch Changes

- @saasicat/types@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [d758318]
    - @saasicat/types@0.3.0

## 0.2.1

### Patch Changes

- @saasicat/types@0.2.1

## 0.2.0

### Minor Changes

- c94b1fe: Remove `quotaKeys` from `saas.yaml` — quota keys now have a single source of truth: the `@DefinesQuota` decorator in code, validated against the discovery snapshot.

    **Breaking:** `saas.yaml` files containing a `quotaKeys:` block fail schema validation (`additionalProperties: false`). Delete the block — the platform derives all quota dimensions from the registered `QuotaProvider` classes.

    - `plan-catalog.schema.json` / `admin-manifest.schema.json` / OpenAPI: `quotaKeys` removed from schema and `planCatalogSnapshot`.
    - `PlanCatalog.quotaKeys`, `PlanCatalogModule.forRoot({ quotaKeys })` and `buildPlanCatalogFromSnapshot` settings field removed.
    - `PlanChangePreviewService.limitsCheck` and `GET /billing/usage` iterate the union of quota keys from entitlement, target plan and usage snapshot instead of the catalog list.
    - `TenantBillingController` no longer injects the plan catalog.
    - `TenantPlanSection` derives the displayed quota keys as an ordered union across all plans and the tenant's effective limits (previously only the first plan's keys), so higher-tier-only quotas stay visible.

### Patch Changes

- 32cca3b: Replace two backtracking-prone regexes with linear string scans (CodeQL `js/polynomial-redos`): the Prisma `//`-comment strip in `schema apply` and the trailing-slash trim of the billing `apiPrefix`. `@saasicat/ui-vue` now exports `trimTrailingSlashes`.
- Updated dependencies [c94b1fe]
    - @saasicat/types@0.2.0
