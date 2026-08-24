# @saasicat/ui-vue-tenant

## 1.0.0-rc.5

### Minor Changes

- 5eec494: The tenant components no longer need a UI framework

    `@saasicat/ui-vue-tenant` renders inside your application, so it stopped deciding
    what your application is built from. `quasar` is gone from its peer
    dependencies; the plan section, the plan-change wizard, the bundle store and the
    package snapshot are plain elements on the theme's CSS custom properties. If you
    installed Quasar only to embed a plan section, it can go — with
    `@quasar/vite-plugin` and the Sass setup beside it.

    Breaking for anyone who styled around the old markup or rendered the inner
    components directly: the `q-*` class names are gone, `TenantPlanCardHeader` takes
    `statusTone` instead of `statusColor`, and the feature matrix hands the
    registry's icon to a `#feature-icon` slot rather than drawing a Quasar icon name
    that needed Quasar's icon font. `docs/guides/upgrade-to-1.0.md` has the details.

    Two composables are new in `@saasicat/ui-vue`, both framework-free and both
    usable outside the tenant package: `useDialog` (focus trap, focus return,
    escape, `aria-modal`, `aria-labelledby`, scroll lock, settable teleport target)
    and `useSteps` (a linear wizard's position, its guard, and moving focus to the
    new step's heading). `bindSaThemeAttribute` joins them: it writes the one
    attribute the role tokens key off, so an app can follow the OS theme without
    installing Quasar for it.

### Patch Changes

- Updated dependencies [f9f19d0]
- Updated dependencies [5eec494]
    - @saasicat/ui-vue@1.0.0-rc.5
    - @saasicat/core@1.0.0-rc.5

## 1.0.0-rc.4

### Minor Changes

- ed230d3: Spacing, radii and tracking in the shipped components now read the design
  tokens instead of pixel literals — 1,165 declarations across both packages.

    **What moves.** Values that sat between two rungs snap to the nearer one, and
    ties round down: `gap: 6px` becomes `var(--sa-space-2)` (4px), `padding: 14px`
    becomes `var(--sa-space-4)` (12px), `border-radius: 6px` becomes
    `var(--sa-radius-control)` (7px). Nothing moves by more than 2px, and the visual
    suite confirms no page overflows at any breakpoint.

    **Why it matters to you.** These are the subpaths that ship source, so your
    build compiles them — and from here, overriding `--sa-space-*` or
    `--sa-radius-*` changes the whole surface at once rather than the one component
    that happened to read a token already. See
    [design tokens](https://github.com/uelker70/saasicat/blob/main/docs/reference/design-tokens.md).

    If you override individual component paddings in your own stylesheet, check
    them once: the value they sit next to may have shifted by a rung.

### Patch Changes

- ed230d3: Every package README now answers the same three questions in the same order:
  what this is, what this is **not**, and where to go next.

    The middle one is the addition. `@saasicat/core` is not a types-only package,
    `@saasicat/spec` does not run your migrations, `@saasicat/cli` has no binary of
    its own for the flows it ships, and `@saasicat/ui-vue-tenant` renders in your
    application rather than in the admin — each of those was a question rather than
    a sentence.

    `@saasicat/nest` and `@saasicat/ui-vue` list all twelve and thirteen of their
    entry points with what is in each and when to take it; the previous tables
    covered one and four. A repository test checks those tables against the export
    map in both directions.

- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
    - @saasicat/ui-vue@1.0.0-rc.4
    - @saasicat/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- Updated dependencies [08d1f52]
- Updated dependencies [b1aa10e]
    - @saasicat/ui-vue@1.0.0-rc.3
    - @saasicat/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- Updated dependencies [3ebc363]
    - @saasicat/ui-vue@1.0.0-rc.2
    - @saasicat/core@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies [8aced6f]
    - @saasicat/core@1.0.0-rc.1
    - @saasicat/ui-vue@1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- 9449492: **One name for everything — and a codemod that applies it.** Phase 5 of the 1.0 cut.

    `npx @saasicat/cli@latest codemod v1 --dir=.` does the surface cut from the previous
    candidates and everything below in one run. `docs/migrating-to-1.0.md` is the written
    form, with before/after for each change.

    **`SaasPlatformModule` is gone; `SaaSiCatModule` is the class**, not an alias of it.
    The thirteen `SaasPlatform*` option types are `SaaSiCat*` — `SaaSiCatModuleOptions`,
    `SaaSiCatAdapters`, `SaaSiCatCatalogOptions` and so on. `createSaasPlatformTestModule`
    is `createSaaSiCatTestModule`; `SaasicatPersistenceAdapter` and its six slice types are
    `SaaSiCatPersistenceAdapter` and `SaaSiCatPersistence*`. There is one spelling of the
    product name left: `SaaSiCat` in types and prose, `saasicat` in packages and files,
    `SAASICAT_` in constants.

    **Every registry key is `saasicat/<package>/<Name>`.** Four prefixes —
    `saas-platform/`, `saas-platform-nest/`, `saas-platform-cli/`, and `@saasicat/ui-vue/` for
    the Vue injection keys — became one. This matters only if your code calls `Symbol.for`
    with one of those strings itself; the exported token constants are unchanged in name and
    resolve as before. The keys will not be renamed again: the rule in `CONTRIBUTING.md` says
    why, and a repository test refuses any other prefix.

    **`FEATURE_UI_REGISTRY_TOKEN` has two names now**, because it meant two registries:
    `BILLING_FEATURE_UI_REGISTRY_TOKEN` from `@saasicat/nest/billing` and
    `CATALOG_FEATURE_UI_REGISTRY_TOKEN` from `@saasicat/nest/catalog`. The codemod picks by
    the entry you imported from and reports an import it cannot decide.

    **`@saasicat/ui-vue/testing-e2e/*` is `@saasicat/ui-vue/testing/*`** — the Playwright
    helper consumers run their admin pages through. Nothing else about it changed.

    Inside the repository, for anyone who reads it: the package directories are the package
    names (`packages/nest`, not `packages/saas-platform-nest`), Nest files follow
    `<area>/<name>.module.ts`, adapter files end in `.repository.ts` or `.adapter.ts`, and test
    directories are `tests/{integration,component,e2e}`. None of that reaches a consumer's
    imports.

- 9449492: **Every standard page reads its own data.** Twelve pages took sixty-one callback
  props between them — `loadTenants`, `submitCreate`, `reviewFeature`,
  `classifyDiff` — and every consumer app wrote them all again. They now ask the
  platform's resource registry by name. Function props in pages: **64 → 2**, and
  `tests/pages-take-no-callbacks.test.js` now holds that number: it resolves each
  prop's type through the compiler, so a callback reached through a type alias
  fails the build the same way an inline one does.

    An app that mounted a standard page with the standard wiring can delete that
    wiring. An app that needs one call diverted passes `:resources` to that page,
    or `resourceOverrides` to `createSuperAdminApp()`, and keeps the rest — the
    property
    a prop-based page cannot offer, because its props are all or nothing.

    The example's glue shows the size of it: `AdminBundlesPage` went from 145 lines
    to 16, `AdminDiscoveryPage` from 72 to 16.

    The two remaining function props are on `AdminManifestErrorPage`, deliberately:
    that page renders when the manifest failed to load, so pointing it at the
    registry would point it at the thing whose absence put it on screen. Each says
    so in its own JSDoc, which is what the guard reads — an exception is declared
    where the prop is, not collected in a list somewhere else.

    **`DashboardPage` joins them.** It kept `loadManifest`, `http` and `formatKpi`
    after the other twelve moved. The manifest comes from the shell's guard, the
    client from the registry, and the third is now a resource:

    ```diff
    -<DashboardPage :manifest="m" :load-manifest="load" :http="client"
    -                :format-kpi="myFormat" :distributions="rows" />
    +<DashboardPage :options="{ distributions: rows }" />
    ```

    An app whose KPI endpoints answer in a shape the default reader does not
    recognise overrides `dashboard.kpi` once, instead of threading a formatter to
    the one page that took it. `subtitle`, `distributions`, `shortcuts` and
    `shortcutDescriptions` moved into `options`.

    **Pages no longer take `adminEndpoint`, `projectKey`, `http` or
    `getAuthToken`.** They come from the shell, which already knew them.
    `BundlesPage` in particular
    took a `projectKey` prop while its resources read a different one from the
    context — two answers to one question.

    **Four resources are new**, and none of them invents an endpoint. The platform
    ships pages for pilots, SMTP providers and the send log but serves no route for
    any of them: those belong to your backend. The descriptors record the paths
    every consumer already calls, so the pages need no callbacks and you override
    an operation instead of supplying one.

    **Fixed: five defects the route split left behind.** The plan editor and the
    review became child routes, and the page that hosts them kept state and
    operations written for the modes they used to be:

    - Publishing from the review wrote nothing. The operation read the page's copy
      of the draft, which only a _save_ had ever written, so a publish before a save
      returned at its first guard while the step cleared the form and navigated
      away. `publishDraft` now takes the draft — and the checklist's force flags,
      which were dropped on the way out.
    - A rejected save looked exactly like a successful one: the error was recorded,
      but the step had already cleared the form and left. `saveDraft` and
      `publishDraft` answer `boolean`; a step leaves only on `true`.
    - The plans page drew its own hero and body underneath the step, putting two
      complete plan views on one screen. It reads the route now.
    - `PromoCodeDetailPage` read `route.params.id` while its route declares
      `promo-codes/:code`, so every navigation asked for `/promo-codes/` — the list.
    - `UsersPage`'s one-time-password dialog sat in a row slot and opened once per
      rendered user, stacking overlays and focus traps.

    **Fixed: three defaults that grouping the props into `options` dropped.**
    `withDefaults` carried them; `props.options?.x` reads `undefined` as "off", and
    an optional boolean makes that a legal value rather than a type error. Every app
    that had never named the option lost the surface:

    | Page               | Option           | What went missing                |
    | ------------------ | ---------------- | -------------------------------- |
    | `TenantsPage`      | `showPlanColumn` | the plan column                  |
    | `TenantDetailPage` | `showUsers`      | the users section                |
    | `PromoCodesPage`   | `statusOptions`  | the status filter's four choices |

    **Fixed: the status pill had lost its shape.** Promoting `StatusPill` onto the
    roster moved its tones into the theme and left the base rule behind, so
    `.sa-pill` had no radius, no padding and no weight — every status marker in the
    admin rendered as plain body text while its colours stayed correct. Its vertical
    padding now sits on the spacing scale (2px, from 3px) and its radius has a token
    of its own, so a pill is one pixel shorter than it was in 0.27.

    **Fixed: two standard pages crashed while mounting in an assembled app.**
    `PromoCodeDetailPage` threw on a code that does not exist — its title read
    `data?.promo.code`, and a response without a `promo` is still truthy — and
    `EmailHistoryPage` handed its table `rows=undefined` when the body was not the
    paginated envelope. Both render their empty state now.

    **Fixed: the shell header overflowed on a phone.** Eleven pixels, and the same
    eleven at 320px, 390px and 600px: Quasar pads the toolbar title 12px per side
    and padding does not shrink, so the title was already down to nothing while
    those 24px pushed a `position: fixed` row past its box. The locale and theme
    switchers also drop their labels one breakpoint earlier — at the `sm` lower edge
    the badge, both labels and the identity block all came back at once.

    **Fixed: `auditResource` sent parameters the endpoint ignores.** It spoke
    `AuditQuery` (`actorTag`, `from`, `to`, paginated) at `GET /admin/audit`, which
    accepts `actor`, `action`, `entity`, `since`, `limit` and answers with a bare
    array. Filtering the audit list by actor would have returned an unfiltered list
    that looked filtered. `AuditListFilter` is now `AdminAuditListFilter`, and
    `useResourceList('audit')` no longer compiles — call
    `useResource('audit').list(filter)`.

    **A fully redeemed promo code no longer renders red.** Both copies of the page's
    status-to-colour function fell through to `negative` for `EXHAUSTED`, so the
    campaign that worked best looked like a fault.

    ***

    **The plan editor and review are their own routes.**
    `/admin/plans/version/edit` and `/admin/plans/version/review` — deep-linkable,
    and children of the plans route so the unsaved draft survives moving between
    them. Nothing is written to the server until you publish or save, which is the
    point of the review step.

    ***

    **`pages-tenant/*` moved to `@saasicat/ui-vue-tenant`.**

    ```diff
    -import TenantPlanSection from '@saasicat/ui-vue/pages-tenant/TenantPlanSection.vue';
    +import TenantPlanSection from '@saasicat/ui-vue-tenant/TenantPlanSection.vue';
    ```

    `saasicat codemod v1-imports` rewrites these for you along with the rest of the
    1.0 import moves.

    **Fixed while splitting it: the package's export map answered no `.ts` file.**
    It read `"./*": "./src/*"`, and the package ships source, so
    `import { … } from '@saasicat/ui-vue-tenant/tenant-i18n.js'` resolved to a
    `.js` that is not there. `./*.js` now maps to `./src/*.ts`, `./*.vue` to
    `./src/*.vue`.

    Why: different audience, different release schedule. Those components render
    inside your customers' product under their branding and in their language, and
    folding them into the admin package meant every breaking change in the admin
    forced a migration in the middle of a customer-facing product. It also shipped
    4,300 lines to every admin consumer who never renders a tenant page.

    Add the package alongside the platform one:

    ```bash
    pnpm add @saasicat/ui-vue-tenant
    ```

    It takes `@saasicat/ui-vue` as a peer and reads the same design tokens, so
    `import '@saasicat/ui-vue/theme.css'` still covers both.

    ***

    **Breaking: the default UI locale is English.** `DEFAULT_SA_LOCALE` was `'de'`.
    It is also the fallback for `Intl`, so an app that names no locale now formats
    dates and currency the English way. German remains a complete catalog — pass
    `createSuperAdminApp({ i18n: { locale: 'de' } })`.

### Patch Changes

- Updated dependencies [9449492]
- Updated dependencies [9449492]
- Updated dependencies [9449492]
- Updated dependencies [9449492]
    - @saasicat/types@1.0.0-rc.0
    - @saasicat/ui-vue@1.0.0-rc.0
