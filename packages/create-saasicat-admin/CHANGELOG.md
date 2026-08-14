# create-saasicat-admin

## 0.24.1

## 0.24.0

### Patch Changes

- fe83513: Scaffolded apps now dedupe the peer dependencies in their Vite config.

    `createSuperAdminApp()` creates the router, the Pinia instance and the Quasar
    plugin; your own pages read them back with `useRoute()`, `useRouter()` and store
    hooks. Those APIs work by module identity, so two copies of a library do not
    share one — and because the UI package ships its pages as `.vue` source, its
    imports resolve relative to the package while yours resolve relative to your app.

    With both in the bundle, `inject` returns `undefined` and the first thing that
    touches it throws somewhere unrelated:

    ```text
    TypeError: Cannot read properties of undefined (reading 'params')
    ```

    The shell renders and the content area is blank. Pages that read no route params
    keep working, so it reads as one broken page rather than a broken wiring.

    Existing apps: add `resolve: { dedupe: ['vue', 'vue-router', 'pinia', 'quasar'] }`
    to your Vite config — see handbook §8.0.

## 0.23.0

### Minor Changes

- 4102659: Three token layers, one colour system, and a dark theme

    The admin UI shipped a token file **and** 643 literal colours, 198 `rgba()`
    literals and 23 font sizes. A reader could not tell which value was a decision
    and which was a guess, so every new page guessed again. Hex colours, `rgb()`
    and `hsl()` literals, named colours and raw font sizes are all at zero now, and
    the audit (`pnpm run tokens`) keeps them there. What it still reports is 56
    colours built in script (inline `:style` bindings) and 70 distinct pixel values
    — known debt, held under a ratchet so it can only shrink.

    **The layers.** `@saasicat/ui-vue/theme.css` is the new entry
    (`./sa-theme.css` still works and is removed in 1.0):

    - **L1 primitives** — the palette and the scales. Reference nothing.
    - **L2 roles** — `--sa-color-fg-muted`, `--sa-color-negative-surface`, … The
      only layer that differs between light and dark.
    - **L3 components** — the shell chrome, reading roles.

    A component asks for a role, never for a value. That single rule is what makes
    the dark theme one file instead of sixty-two, and it is enforced: primitives may
    reference nothing, roles may hold no literal, and nothing outside the role layer
    may name a palette colour.

    **One brand, not two.** `--sa-color-accent` reads Quasar's `--q-primary`, which
    comes from your `$primary`. Set it once and the hero, the buttons, the focus
    ring, the tinted surfaces, Quasar's own components and the tenant-facing pages
    all follow. Previously the platform painted `#3f6bff` while a scaffolded app
    painted `#1e40af`, in the same screen, because each had its own source of truth.
    To change the brand at runtime, write to the root:
    `setCssVar('primary', value, document.documentElement)`. The third argument is
    not optional — Quasar's default target is `<body>`, and the accent role is
    computed on `:root`, which cannot see a value declared below it.

    **Dark mode.** `createSuperAdminApp({ theme: { scheme: 'system' } })`, plus
    `useSaTheme()` anywhere. `'system'` follows the operating system live. Quasar's
    own `$q.dark.set(true)` flips the platform as well, so an app that already has a
    dark switch needs nothing from this. Verified on all nineteen standard pages by
    a contrast check rather than by a second set of screenshots: the canvas must get
    darker, most text colours must move, and nothing may fall under 3:1 in either
    theme.

    The stylesheet itself does **not** answer `prefers-color-scheme`, deliberately.
    It paints the platform's surfaces while Quasar paints its own cards, dialogs and
    steppers, and Quasar follows only `body--dark` — so a media query there moves
    one half of the screen and leaves the other. Following the OS lives in
    `createSaTheme`, where the bridge moves both. An app that embeds tenant pages
    and wants OS-following dark opts in with
    `bindSaThemeToDocument(createSaTheme())`.

    **Also:** the spacing, type, radius, shadow, z-index and breakpoint scales;
    `--sa-radius-pill`; and a fix for `--sa-color-fg-subtle`, which was reading
    2.56:1 on a white card — captions and price units were decoration rather than
    information.

    **Teleported dialogs and menus are themed too.** Quasar appends every dialog,
    menu and tooltip to `<body>`, outside the `.sa-page` wrapper — so the theme
    never reached them, and dialog cards kept Quasar's grey surface, its 4px radius
    and its transparent outlined inputs, while every dropdown opened a `#1d1d1d`
    panel over a slate page. `createSuperAdminApp` now marks those portals
    (`config.globalNodes.class`, appended to yours if you set one) and the theme
    addresses `.sa-page` and `.sa-portal` alike.

    Be aware of the scope: `globalNodes` is document-wide, not per-owner. Every
    portal opened inside an app bootstrapped by `createSuperAdminApp` is marked —
    including a dialog opened by a page you contribute into the admin shell. That is
    intended, because a page mounted in the shell is admin UI, and `.sa-page`
    already repaints its cards. An app that does not call `createSuperAdminApp` is
    untouched. Tooltips keep Quasar's own colours.

    **Quieter row actions.** Table row icons were three different recipes across
    five pages — two painted `primary`, two carried a per-action colour, one had its
    own class — so one table read as a row of traffic lights beside another's row of
    greys. They share `.sa-icon-btn` now: muted by default, colour reserved for the
    destructive action. Rows of actions are chrome, not announcements. And the plan
    list stretches its cells to a common height, so the hover band no longer
    notches where a column happens to be shorter.

    ## What you may need to do

    **If you embed `@saasicat/ui-vue/pages-tenant/*` in your own app**, add one
    import to that app's entry:

    ```ts
    import '@saasicat/ui-vue/theme.css';
    ```

    Those pages used to carry their own colours and their own dark theme; they read
    the shared roles now, which is what lets one `$primary` brand both surfaces. The
    stylesheet is safe to load beside your own design — every selector in it is
    either a `.sa-`-prefixed class of ours or sits under `.sa-page`, and there is no
    bare element rule.

    **If you override an `--sa-*` variable in your own CSS**, reading still works;
    setting no longer does. The old names are aliases of the roles now. Set
    `$primary` for the brand — that is the whole answer for the common case.

    To override a **role**, write both of its values, on the same selectors the
    theme uses:

    ```css
    :root {
        --sa-color-negative: #a3122b;
    }
    [data-sa-theme='dark'],
    body.body--dark {
        --sa-color-negative: #ff6b81;
    }
    ```

    A role has two values, so an override has two. `:root` alone is not enough and
    fails differently per trigger — under Quasar's `body--dark` the roles are
    declared on `<body>`, and an inherited `:root` value never reaches past that.
    See the design guide.

    **Expect a visual change.** Colours that were three near-identical greens
    collapse to one success colour, the same for the browns and the reds; the type
    scale snaps 23 sizes onto nine; and the admin adopts your `$primary` instead of
    the platform's blue.

## 0.22.2

## 0.22.1

## 0.22.0

## 0.21.0

## 0.20.0

## 0.19.0

## 0.18.1

## 0.18.0

## 0.17.0

## 0.16.0

## 0.15.1

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.1

## 0.12.0

## 0.11.0

## 0.10.1

## 0.10.0

## 0.9.0

### Minor Changes

- 6524f04: Require Quasar >= 2.22.0. Earlier releases are affected by the prototype
  pollution in Quasar's `extend()` utility (GHSA-3r53-75j5-3g7j), so the
  `@saasicat/ui-vue` peer range and the generated admin scaffold now start at the
  patched version. Consumers still on Quasar 2.18–2.21 need to upgrade.

## 0.8.0

## 0.7.0

## 0.6.0

### Minor Changes

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

## 0.4.0

## 0.3.0

## 0.2.1

### Patch Changes

- 41000d3: Fix the scaffolder doing nothing when run via `npm create` / `npx`.

    The entry-point guard compared `import.meta.url` against `` `file://${process.argv[1]}` ``. Package managers expose the bin through a symlink in `node_modules/.bin/`, so under `npm create saasicat-admin` the invoked path and the module path differ, the comparison failed, and `main()` never ran — the command exited 0 without writing a single file. Published `0.2.0` is affected.

    The guard now compares real paths via `realpathSync`, which resolves the bin symlink. A regression test invokes the bin through a symlink the way npx does, and fails against the old guard.

## 0.2.0

### Patch Changes

- db10ab9: Fix scaffolded projects pinning a platform version that never gets published.

    `templates/package.json.tpl` hardcoded `@saasicat/types` and `@saasicat/ui-vue` at `^0.1.0`. Because caret pins the minor for `0.x` versions, `^0.1.0` resolves to `>=0.1.0 <0.2.0` and would not match the published `0.2.0` — every scaffolded project would fail to install. The template now uses a `__PLATFORM_VERSION__` token that the scaffolder fills from its own `package.json` version, so the pin tracks each lockstep release automatically.

    Also: ship `cli-conventions.md` in `@saasicat/spec` (the `@saasicat/cli` README links to it), point package README links at absolute GitHub URLs so they resolve on npm, and translate the scaffolder's CLI output to English.
