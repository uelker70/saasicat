# @saasicat/ui-vue

## 1.0.0-rc.5

### Minor Changes

- f9f19d0: Every icon in the admin UI is now a `q-icon` with a Material Icons name. The 51
  hand-drawn `<svg>` glyphs are gone.

    **Why it matters to you.** The package drew its own icons in 17 files while
    asking Quasar for the same pictures in 112 other places, and it had never chosen
    between the two — both arrived together when the package was extracted, and
    nobody looked again. The result was drift a reader cannot see from one file: one
    checkmark existed in three different geometries, and at 11px in three different
    stroke widths, so the same tick did not look the same on two pages. Twenty-six of
    the 51 declared nothing about themselves to a screen reader — not on the glyph
    and not on a wrapper — where `q-icon` marks every one decorative. And none of the
    51 set `stroke-linecap`, which the geometry they were copied from is drawn for, so
    every one rendered with cut ends and sharp corners.

    **What changed for you.** The glyphs are Material's now, so they read a little
    heavier than the thin strokes they replace, most visibly at 10 and 11px. If you
    styled one by element — `.pd-timeline-hint svg` and its kin — target `.q-icon`
    instead. The lock on a blocked delete no longer carries its own `opacity: 0.4`
    on top of the disabled button's, which had it rendering at roughly 0.24 against
    the surface, below the 3:1 a graphical element needs.

    `@saasicat/ui-vue-tenant` is untouched. It renders inside your application and
    brings no UI framework (ADR 0010), so its four glyphs stay hand-drawn — and the
    guard that keeps Quasar out of it now also refuses the `@quasar/*` scope, which
    is how the shared icon geometry would have crept back in.

    `saasicat/no-restricted-components` refuses a raw `<svg>` in this package,
    including under `src/ui/` where the path escape had been covering one.

    **The plans page reports its successes through the notify port.** Its seven
    confirmations — plan created, draft saved, version published, plan deleted and
    their kin — went through a page-local toast component that reimplemented what
    `useSuperAdminNotify()` already does for every other page, down to its own
    `setTimeout` that nothing cleared on unmount. They now go through the port, so a
    `notify` you provide to `createSuperAdminApp()` receives them like the rest, and
    the `.sa-plans__toast` classes are gone. This surfaced because taking 510 lines
    of hand-drawn markup out of the package pushed that file to the top of the
    `<style>`-share ratchet without adding a single line of CSS — the file was the
    second-worst already, and the ratchet was pointing at something real.

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

- @saasicat/core@1.0.0-rc.5

## 1.0.0-rc.4

### Minor Changes

- ed230d3: Every form control and every action button in the admin UI is now a Quasar
  component: `q-input`, `q-select`, `q-checkbox`, `q-toggle`, `q-btn`.

    **Why it matters to you.** The package had eight independent `input`
    implementations and six `button` families — 784 lines of CSS reproducing what
    Quasar and the theme already give you. A field built that way misses the theme's
    corrections (dark-mode surface, focus ring, the fix for a field inside a
    teleported dialog) and every Quasar-level setting you make: an app that themed
    `$primary` or `q-field` reached the filter rows and missed the editors. Two
    inputs on one page reacted differently to the same setting, and nothing in the
    markup said which was which.

    **What changed for you.** If you styled these by selector — `.pc-input`,
    `.bve-btn`, `.bcp-btn`, `.pcd-btn`, `.sa-btn` and their kin — those classes are
    gone; style `q-input`/`q-btn`, or the design tokens, instead. Spacing shifts by
    a rung or two in places and the paginator's buttons are 4.5px taller, which is
    Quasar's hit area.

    Twenty-one native `<button>`s remain on purpose — segmented cards, chips with a
    colour mark, a bar in a chart, a disclosure trigger — and each says at the
    element why. `saasicat/no-hand-built-controls` refuses the rest.

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

- ed230d3: The marketing catalog's plan list is reordered by dragging, and every disclosure
  in the admin UI opens the way the others do.

    **Order is a gesture now, not a number.** The "Priority" column held a number
    field per row, and the list sorted by it — so moving a plan up meant working out
    which number would put it there, in a list that re-sorted under the cursor while
    you typed. A drag handle sits on the left of each row instead: drag it, or focus
    it and press ↑/↓, and the platform computes the priorities that produce that
    order. Existing values are kept and only reassigned, so the gaps an operator
    chose (100 / 50 / 10) survive; rows that keep their value are not written. Plans
    that start out tied at `0` are pulled apart on the first move, because equal
    priorities cannot carry an order. A plan with no live version has no handle: it
    cannot hold a marketing projection, so there is no priority to write.

    **The whole row opens the editor.** Clicking anywhere in a row that is not one of
    its fields opens the teaser and top-features editor; before, only a chevron at
    the far right did. The chevron is gone, and the plan cell is still the element a
    keyboard tabs to and a screen reader hears as the disclosure. A row's status —
    `live`, `hidden`, `Featured` — now sits beside the plan name rather than in a
    column of its own, which is where the bundle list already put it.

    **Accordions animate and have lost their chevron.** `AdminAccordion`'s body
    slides open and shut through `q-slide-transition` instead of appearing, so a list
    where several rows open no longer jumps; the badge deepens to report which row is
    open. This affects every surface built on it — discovery, bundles, promotions,
    the promo-code form, the setup wizard.

    New in the package: `useRowReorder` (from `@saasicat/ui-vue/vue`) for the pointer
    half of a drag, `reorderedPriorities` (from `@saasicat/ui-vue/client`) for the
    arithmetic, and a `.sa-sr-only` utility in the theme.

    **Every page now sits in the same frame.** Two pages drew their own: the
    discovery page set a 16px page padding and the marketing catalog a 24px one
    against the theme's 28px, so the heading and the content below it sat at three
    different distances from the sidebar depending on where you were. The dashboard
    had no `AdminBody` at all, so its cards ran 20px wider than every other page's.
    Both are the shared frame now, and a rule reads the theme's own `.sa-page`
    declarations to keep it that way. The bundles and discovery pages also added a
    16px gap on top of the hero's own margin, so those two put 36px between the
    heading and the content where every other page puts 20px — and the same 16px
    again between their sections. Gone; the rule covers that too.

    **The plan matrix reads like the plan list.** Its four KPIs sit in a card above
    the table, in the same rhythm as the list's, rather than bare on the page
    background. Two contrast defects that surfaced with it are fixed: the "not
    included" dash in the matrix rendered at 1.48:1, and the _Create plan_ card's
    title and subtitle at 2.0:1 and 2.5:1 on their own tint.

### Patch Changes

- ed230d3: The handbook is gone, and its twelve chapters are documents you can enter
  directly: guides for a task, reference for a name, explanation for a why.
  [`docs/README.md`](https://github.com/uelker70/saasicat/blob/main/docs/README.md)
  is the map.

    If you linked to a numbered section — `handbook.md#87-ui-language-i18n` and its
    kin — the sections carry names now. The comments in the scaffolded files and in
    `examples/notesapp` point at the new documents, and the numbered references they
    used to carry are gone: a number was exactly what broke every time a section was
    inserted.

    Two contradictions the split removed, both of which sent readers the wrong way:
    the architecture chapter presented seven individual `forRoot` calls as the way to
    wire the backend while the quickstart used `SaaSiCatModule.forRoot`, and the
    sub-entry rule said "never import the root" while the platform composition is
    exported from there deliberately.

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

- ed230d3: `@saasicat/ui-vue/testing/mount-with-quasar` mounts a component with Quasar's
  components registered — the fixture the platform's own component tests use.

    `app.use(Quasar)` installs the plugin but registers nothing, so without it every
    `q-*` in the component under test stays an unresolved element and assertions
    pass or fail for reasons that have nothing to do with the component. Two
    packages in this repository had a byte-identical copy of it; a consumer testing
    a page they mounted needs the same one.

- Updated dependencies [ed230d3]
    - @saasicat/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- 08d1f52: **"Weiter · Review" reaches the review again.** The plan editor navigated to `/admin/plans/review`
  while the standard route table registers `plans/version/review`, so step 2 → 3 of the plan wizard
  landed on the manifest catch-all in every consumer app. The editor pushes the registered path now,
  and a test reads every `router.push` target out of the plan pages and refuses one the route table
  does not know.
- b1aa10e: **`runAdminPagesSuite` finds the dashboard distributions again.** Phase 4 replaced the dashboard's
  hand-rolled distribution rows with `AdminSection`, and the shipped Playwright suite kept asking
  for the old `.sa-dashboard__row-head h2` — so every consumer with `expectedDistributionTitles`
  failed the dashboard test against 1.0 with "Distribution '…' missing" while the page rendered it.
  The selector is one exported constant now, and a component test asks the suite's question of the
  mounted page, so the two cannot drift apart unseen again.
    - @saasicat/core@1.0.0-rc.3

## 1.0.0-rc.2

### Patch Changes

- 3ebc363: **`saasicat schema apply` now appends the enums a fragment declares, above the models that use
  them.** It used to copy models only, so a fresh schema ended up with `Subscription.billingCycle`
  and no `BillingCycle` — twenty Prisma validation errors at quickstart step 3 for anyone who had
  not pasted the enums in by hand. An enum the schema already declares is left untouched, as models
  are. Found by installing the 1.0 candidate from npm into an empty project; the example app had
  carried the enums since before the command existed, so nothing in the repository saw the gap.

    **Every package with an exports map now exports `./package.json`.** Seven did not, and a bundler
    plugin, `vue-tsc` or pnpm reading the manifest got `ERR_PACKAGE_PATH_NOT_EXPORTED`.
    **`saasicat init` names two more things the generated wiring needs.** The `forRoot` block now
    carries `imports: [YourPrismaModule, YourAuthModule]` the way it carries `YourAuthGuard` — it does
    not compile until you name them — because `prismaPersistence({ client: PrismaService })` is
    resolved inside the platform module, which sees only what that list holds or what is `@Global`.
    Left out, the generated app compiled and stopped on its first boot with "Nest can't resolve
    dependencies of … (PrismaService)". And `init` now refuses a `tsconfig.json` whose
    `moduleResolution` is `node`: the files it writes import subpath exports, which only `node16`,
    `nodenext` or `bundler` resolve. The quickstart says so too.

    **`create-saasicat-admin` scaffolds an app that type-checks.** Its `platform-loaders.ts` still
    passed `getAuthToken` to `createPlatformLoaders`, an option the 1.0 line no longer has, so every
    fresh admin failed `vue-tsc` on its first run. The scaffolder's tests now type-check a scaffolded
    app against the `@saasicat/ui-vue` it was scaffolded for.
    - @saasicat/core@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies [8aced6f]
    - @saasicat/core@1.0.0-rc.1

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

- 9449492: **The UI package has one name for each thing again.** Its export map went from
  37 entries to 13, and the surface it hands out is now the one the architecture
  describes rather than the one that accumulated.

    **`./pages-standard/*` is gone.** It was a second spelling of `./pages/*` —
    same files, two names, and both consumer apps used both. Import from `./pages/`.

    **`./components/*` is gone.** What it published was everything that happened to
    sit in one directory: page skeleton primitives beside domain components beside
    page-private parts. The primitives are `./ui/*.vue` now — `AdminPage`,
    `AdminTable`, `AdminHero` and the rest, plus `FeatureGate` and
    `MfaPromptDialog`. The domain and page-private components are not published at
    all; they were never meant to be a public surface, and importing them tied your
    app to our internal structure.

    **Three files moved out of `./pages/`:** `AdminLayout.vue` is `./layouts/`,
    `SuperAdminLoginPage.vue` and `SuperAdminSetupWizard.vue` are `./auth/`.

    **Source subpaths end in `.vue` now** — `./pages/*.vue` rather than `./pages/*`.
    A subpath that hands out a directory hands out everything in it.

    **New: `./vue`.** The package is three layers — `client` (framework-free),
    `vue` (composables), `quasar` (bootstrap) — and until now only two of them had
    an entry. The main entry still works and is wider: it re-exports the `client`
    layer as well. `./vue` is the narrow door.

    ### Migrating

    ```bash
    npx @saasicat/cli@latest codemod v1-imports --dir=./src
    ```

    It rewrites every subpath that has a new home and reports the ones that no
    longer have one — for those, copy what you need into your own repository. Add
    `--dry-run` to see what it would do first.

    The rules come from the same table the platform's own move ran on, shipped with
    the CLI, so what your imports become cannot disagree with where the files went.
    Measured against the two apps we know: 2 imports in one, 42 in the other, and
    neither imports anything that became unreachable.

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

### Minor Changes

- 9449492: **Twelve admin primitives, and every hand-built copy of them is gone.**

    New in `@saasicat/ui-vue/ui/*.vue`:

    - `AdminBanner` — an inline notice, in one of four tones
    - `AdminErrorBanner` — the failure case of that. One prop, and it renders
      nothing when there is no error, so a page binds it unconditionally
    - `AdminEmptyState` — what a list shows when it has nothing to show
    - `AdminDialog` — the chrome under every dialog
    - `AdminFormDialog` — a dialog whose point is a write. Owns the submit
      lifecycle: disabled while pending, failure shown without closing
    - `AdminConfirmDialog` — a dialog that asks before something irreversible
    - `AdminToolbar` — the action row above a table that is not the hero
    - `AdminRowActions` — the per-row controls in a table's `row-actions` slot
    - `AdminField` / `AdminFieldGrid` — a labelled control, and the grid it sits in
    - `AdminStatusPill` — a status, as a word plus a tone

    `AdminStatusPill` is promoted out of a private directory where one page used
    it while nine other places rendered their own status display. Its `PillTone`
    type is exported from `@saasicat/ui-vue/vue`, along with `PROMO_STATUS_TONE` —
    the one status vocabulary shared across pages.

    **What this replaces.** Nineteen hand-written banners in six different colour
    recipes, nineteen raw `<q-dialog>` sites in seventeen files, five word-for-word
    copies of the same `errMsg()` helper, and the four pages that reached for
    `useQuasar()` because the confirm port had no consumer. All four numbers are now
    zero. Two dialogs keep their own submit handler on purpose: they route a failure
    to the MFA prompt or to themselves depending on the response reason, and a
    component that owns the error cannot make that split.

    **One behaviour fix rides along.** A fully redeemed promo code rendered red —
    both copies of the page's status-to-colour function fell through to `negative`
    for `EXHAUSTED`. The campaign that worked best looked like a defect. It is now
    muted.

    **Breaking: the default UI locale is English.** `DEFAULT_SA_LOCALE` was `'de'`
    and is now `'en'`. It is also the fallback for `Intl`, so an app that names no
    locale now formats dates and currency the English way as well. German remains a
    complete, first-class catalog — an app that wants it passes
    `createSuperAdminApp({ i18n: { locale: 'de' } })`, and a missing English
    translation is still a compile error.

    **Also fixed:** dialogs teleport out of the page, so the package's page-wide
    `box-sizing: border-box` never reached them. Hand-built modals each carried
    their own reset; the shared dialog chrome now carries it once.

    ***

    **Two standard pages read their data themselves.** `PromoCodesPage` and
    `AuditPage` no longer take loader or submit props — they ask the platform's
    resource registry by name. `PromoCodesPage` drops `loadPromos`, `submitCreate`,
    `submitEdit` and `submitDelete`; `AuditPage` drops `loadAudit`. An app that
    rendered either with the standard wiring can delete that wiring; an app that
    needs one call diverted passes `:resources` instead of re-supplying all of them.

    **`useResource(key, override?)`** takes a per-page override now, layered over the
    app-wide one rather than replacing it — platform, then app, then instance. An app
    that wraps an operation app-wide keeps that wrapper when a single page is pointed
    somewhere else.

    **Fixed: the audit resource sent parameters the endpoint ignores.**
    `auditResource.list` spoke `AuditQuery` (`actorTag`, `from`, `to`, paginated) at
    `GET /admin/audit`, which accepts `actor`, `action`, `entity`, `since`, `limit`
    and answers with a bare array. `AuditQuery` belongs to `AuditQueryPort`, one
    layer below HTTP — the adapter translates. Filtering the audit list by actor
    would have returned an unfiltered list that looked filtered. Nothing consumed the
    descriptor yet, so no released version shipped the wrong request; it is corrected
    before the page reaches it.

    Two consequences for anyone who did use it: `AuditListFilter` is now
    `AdminAuditListFilter`, and `useResourceList('audit')` no longer compiles —
    the operation returns an array, not a page, so `audit` is not a list resource.
    Call `useResource('audit').list(filter)`.

    **`PromoRow` lost its `[extra: string]: unknown`.** It was there so rows arriving
    through a `loadPromos` prop could carry anything an app returned. The resource
    decides the shape now, and the index signature was what kept a typo from being
    distinguishable from a field the server had started sending.

### Patch Changes

- Updated dependencies [9449492]
    - @saasicat/types@1.0.0-rc.0

## 0.27.0

### Minor Changes

- 0a46f7f: Backend integration: a generator, a boot that refuses a broken licence chain,
  and configuration errors that arrive all at once.

    **`saasicat init`** scaffolds the platform wiring — app config, persistence
    bundle, feature-UI registry, manifest contribution, admin module, one provider
    per `--quota=key:Model`, a password hasher — and adds
    `SaaSiCatModule.forRoot(...)` to an existing `src/app.module.ts`. What was
    thirteen files to create by hand is now none: what stays yours is what each
    quota counts, the hasher if scrypt is not enough, and your auth guard. The
    command prints all three as next steps and refuses to overwrite an existing
    file. A value flag written without `=` is a usage error rather than an internal
    one, `--app-name="My App"` produces `MyAppAdminModule` while the catalogue keeps
    the words, and a root module whose last import spans several lines is no longer
    cut open at its opening brace.

    The generated module does not compile until you name that guard — it writes
    `controller: { guards: [YourAuthGuard] }`, a symbol that does not exist, and
    `tsc` says so once. An empty array would have compiled, and `[]` is this
    platform's word for _deliberately_ unauthenticated: the discovery and manifest
    endpoints would have answered to anyone.

    **`saasicat init` refuses what the platform would refuse, before it writes
    anything.** Everything in `config/saas.yaml` is validated against the catalogue
    schema at boot, so every rule the generator skipped was one the integrator met
    after every file had been written and `app.module.ts` patched. Three of them
    each produced an application that could not start: a project key outside
    `^[a-z][a-z0-9-]{1,30}$`, a quota key with a separator (`active-seats` — the
    plan's `quotas` object forbids additional properties), and no `--quota` at all,
    which wrote `quotas: {}` where the schema requires at least one. `--quota` is
    therefore required now. All three rules are read off the schema rather than
    restated, and the suite loads the generated catalogue with the platform's own
    loader.

    **A broken enforcement chain no longer boots.** `@RequireFeature` and
    `@EnforceQuota` with nothing able to resolve a tenant to a plan used to be
    silent — the routes answered, the quotas read as unlimited, and the first signal
    was a customer using something they never bought. `EnforcementChainCheck` now
    refuses the boot, after bootstrap where the annotated routes are visible, and
    names them. Same for `globalFeatureGuard: false` with a route that has no
    feature guard in front of it. An application with no annotations at all still
    boots: a catalogue without enforcement is a real shape.

    **Breaking:** an application in any of those states will stop starting. Neither
    known consumer is affected: every `@RequireFeature` in both sits in a file that
    also binds a feature guard, and neither has a single `@EnforceQuota` route, so
    the quota branch cannot fire for them. `FeatureGuardCoverageCheck` is renamed to
    `EnforcementChainCheck`.

    Quotas are asked about separately from features, because only the static stack
    registers `EnforceQuotaInterceptor`: an application on the V3 entitlement path
    with no plan resolver enforces `@RequireFeature` correctly and cannot enforce
    `@EnforceQuota` at all. That combination used to boot with every quota reading
    as unlimited.

    Two shapes the check cannot recognise and correctly enforces anyway: a feature
    guard of your own that wraps ours without carrying `FEATURE_GUARD_MARKER`, and
    one bound globally as an `APP_GUARD` rather than per controller. Set
    `enforcementChainCheck: false` if that is you — it turns off this check and
    nothing else.

    **Configuration problems arrive together.** The fifteen checks in `forRoot` are
    a rule table now: a misconfigured application gets the complete numbered list on
    the first boot, each entry with its rule id and a link to
    `docs/reference/options.md` — which is generated from that table. Five missing
    bindings used to cost five restarts.

    **`saasicat schema migrate`** writes the migration with `--create-only`,
    appends the constraints Prisma's DSL cannot express, and then applies it — or
    stops before applying, if appending failed, because the advice it prints then
    (add the SQL by hand first) is only followable while the migration is unapplied
    —
    instead of asking you to paste them in. Only the constraints whose tables that
    migration creates, so a run scoped with `--fragments` is not failed by an index
    on a table it never made.

    And `schema apply`/`schema migrate` take `--tenant-model` / `--user-model` to
    enable the foreign keys from the platform tables to your own models. A name your
    schema does not declare is refused, with the list of names it does; a relation
    whose opposite field your model does not carry stays commented and the command
    prints the exact line to add, because writing it would produce a schema Prisma
    refuses.

    **`PrismaAdminResourcesAdapter` takes a mapping.** `adminResources: { delegates:
{ tenant: 'organization' }, fields: { tenant: { isActive: 'enabled' } } }` — an
    application whose models are named differently no longer has to set
    `adminResources: false` and lose every SuperAdmin endpoint. A mapped delegate
    the client does not have fails at construction and lists the ones it does. The
    shape is still the boundary: an m:n tenant/user relation implements
    `AdminResourcesPort` itself.

    **`@saasicat/ui-vue`** completes the resource descriptors: bundles, bundle
    versions, catalogue entries, discovery, marketing, promo codes, promotions,
    users, subscriptions, and the by-slug tenant operations — 13 descriptors over 54
    operations, each held to the same request as the composable or admin client it
    mirrors.

    Internal: `saas-platform.module.ts` is 244 lines instead of 1,240, with one
    composer file per feature; two redundant port barrels are gone from
    `@saasicat/types`; and ESLint now enforces the nest domain boundaries with no
    exemptions.

- 40e270c: **The license changes from Apache-2.0 to PolyForm Shield 1.0.0.** SaaSiCat is
  source-available from this release on, not OSI open source.

    What stays permitted, and it is nearly everything: reading the code, running it,
    changing it, redistributing it, and building and selling your own SaaS product on
    top of it. What is not permitted is offering a product that competes with
    SaaSiCat itself, or with a product its author provides using it. There is no time
    limit and no reversion to a permissive license.

    **Versions up to and including 0.26.1 remain Apache-2.0.** Rights granted with a
    published version cannot be withdrawn, and npm versions are immutable — if you
    depend on 0.26.1 or earlier, nothing about your terms changes until you upgrade.

    Practically: if you use SaaSiCat to build an application, this changes nothing
    for you. If you were planning to repackage SaaSiCat itself as a product, it does.

    The reasoning, the alternatives that were weighed, and the consequences are in
    [ADR 0001](https://github.com/uelker70/saasicat/blob/main/docs/adr/0001-source-available-licensing.md).

### Patch Changes

- Updated dependencies [0a46f7f]
- Updated dependencies [40e270c]
    - @saasicat/types@0.27.0

## 0.26.1

### Patch Changes

- f9c322d: Keep the shipped source compiling under ES2021

    Four of this package's export subpaths hand out `.vue` and `.ts` straight from
    `src/` rather than from a build — `pages/*`, `pages-standard/*`, `pages-tenant/*`
    and `components/*`. (Four more serve stylesheets: three from `src/ui/theme/`,
    which carries no TypeScript, and `sa-theme.css` from `src/pages-standard/`.)
    That is deliberate: a consumer needs the source for
    Quasar and Sass theming. The consequence is easy to miss, and 0.26.0 missed it:
    **your** `tsconfig` compiles those files, not ours. Ours says `lib: ES2023`.

    `AdminError`, new in 0.26.0, used `new Error(message, { cause })` — an ES2022
    constructor overload. Any app importing one of those subpaths with a `lib` below
    ES2022 got `error TS2554: Expected 0-1 arguments, but got 2` in a file it never
    wrote. Measured on a real consumer targeting ES2021: clean on 0.23.0, one error
    on 0.26.0.

    Two older spots had the same defect without anyone reaching them yet:
    `Object.hasOwn` in `nav-builder.ts`, and another `{ cause }` in
    `SuperAdminSetupWizard.vue`. All three are fixed. `attachCause()` in
    `src/client/attach-cause.ts` sets the property afterwards, which reads
    identically to anything inspecting `error.cause` and needs nothing above ES5.

    `AdminError` also declares `cause` now. It was only ever set at runtime, and
    `Error.cause` is itself ES2022 — so on the floor this release declares, an app
    could hand a cause in through `AdminErrorInit` and never read it back out.

    **The floor is now stated and checked.** It is **ES2021** (`lib: ES2021, DOM`),
    and `test:shipped-source` compiles the whole closure reachable from the
    source-shipping subpaths at that level in CI. It is set the way a Vite consumer
    sets it rather than to a bare language level — `isolatedModules`,
    `useDefineForClassFields` and `strictPropertyInitialization`, the last two of
    which this package's own config would otherwise leave milder than its subject.

    The directory list comes from the export map rather than from a hand-written
    list, so a new source subpath is covered the day it is added; a subpath whose
    shape the derivation cannot express fails the check instead of being skipped.

    One thing the check does not pin is the compiler version: `satisfies` in the
    shipped source needs TypeScript 4.9 or newer whatever `lib` says. **TypeScript
    5.0 or newer** is the supported minimum, stated in `CONTRIBUTING.md` — as prose,
    because verifying it would mean installing old compilers.

    Raising the floor is a breaking change for consumers below it and will be
    announced as one.

    Nothing else changes: `dist/` is built at the repo's own level as before, and
    this only constrains code that consumers compile themselves.
    - @saasicat/types@0.26.1

## 0.26.0

### Minor Changes

- b81519c: Add the theme switcher to the shell chrome. Light, dark and system were already
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

- b4703b7: Give the admin one error type instead of five copies of a guess

    `@saasicat/ui-vue` describes its HTTP seam as a bare function type — `HttpClient`
    is `(url, init) => Promise<HttpResponse>` and nothing more. An error can
    therefore arrive in whatever shape the consumer's client produces. Five pages
    each answered that with the same nine lines:

    ```ts
    type AxiosShape = { response?: { data?: { message?: string } } };
    (err as AxiosShape)?.response?.data?.message ??
        (err as Error)?.message ??
        msg.value.errorAction;
    ```

    That reads one shape: an axios rejection. Pass a `fetch`-based client — which
    the package's own `defaultHttpClient()` is — and the first branch never matches.
    It is not that the wording is wrong; it is that a consumer on the documented
    default contract sees the platform's generic fallback for every failure, and no
    test noticed because every fixture threw an axios-shaped object.

    `AdminError` is now the one shape, and `toAdminError()` is the one conversion
    into it. It recognises an axios rejection, any of the package's own `*ApiError`
    classes (they all carry `status`, most carry `body`), a bare `Error`, a thrown
    string, and a thrown nothing.

    **The two ideas the old helper conflated now have separate names.** `message` is
    the diagnostic — `GET /api/v1/admin/plans → HTTP 403 (PLAN_LOCKED)`, shaped like
    the one `admin-resource-client.ts` already writes, so logs read the same whichever
    layer threw. `detail` is what the failing side actually said, and it is
    `undefined` when it said nothing. Only `detail` is a candidate for showing a
    user; `adminErrorMessage(err, msgs)` is the single place that decides between it
    and a translated fallback, and it never leaks a diagnostic into the UI.

    A NestJS `ValidationPipe` rejection carries `message: string[]` — one entry per
    failed constraint. Nothing in the repository handled that: the grep for
    `Array.isArray(message)`, `message.join` and `message[0]` returned zero across
    `packages/` and `examples/`, so a malformed request rendered as a comma soup or
    fell through to the generic fallback. It is now joined deliberately, in
    `readErrorDetail()` — exported rather than private because both paths that
    build an `AdminError` have to give the same answer. They did not on the first
    attempt: the JSON helper read the body a second, narrower way and accepted only
    a string, so a validation rejection arriving through `getJson`/`postJson` lost
    its constraints and showed the generic fallback anyway. Review found it; a test
    now holds it.

    New i18n namespace `errors`, eleven keys, one per branch `adminErrorMessage` can
    take — `network`, `emptyResponse`, `unexpected`, `unauthorized`, `forbidden`,
    `notFound`, `conflict`, `validation`, `rateLimited`, `server`, and a `{status}`
    template for everything else. Nothing here restates a key `common` already owns:
    those name an action ("Failed to load"), these name a cause. German and English
    ship together, and `defineMessages` makes a missing English key a compile error.

    **Three of those keys describe the same absent status and must not be swapped.**
    A request that never left says `network` — check the connection. One the server
    accepted and answered without the body it owed says `emptyResponse` — check
    whether the change was applied, because it may well have been. A failure nobody
    knows anything about says `unexpected`. None of them has an HTTP status to
    reason from, so no number can tell them apart, and each is reached only because
    the seam that knew declared it:

    - the client that could not send the request calls `markTransportFailure()` —
      `defaultHttpClient` does it for every `fetch` rejection, and the JSON helpers
      do it for a client that reports the same by RESOLVING with `status: 0`;
    - the mutation that needed a body and did not get one wraps its sentinel in
      `markEmptyResponse()`.

    `toAdminError` reads both back through `isTransportFailure()` and
    `isEmptyResponse()`, and everything else with no status falls to `unexpected`.
    All four functions are exported, because a consumer whose own client can produce
    those cases needs the same vocabulary.

    Every one of those facts was a guess first, and each guess was wrong in a way
    its shape could not reveal:

    - **"one of ours, and `status: 0`" for an empty response.** That is a fact about
      the class, and one class hosts both kinds of throw site: `BootLoader`,
      `ManifestLoader` and `useDiscovery` raise their branded errors with whatever
      status the consumer's client reported, so a client that resolves a transport
      failure as `status: 0` — which XHR and axios do, and which the `HttpClient`
      contract permits — turned a failed read-only GET into "check whether the
      change was applied".
    - **`if (!data)` for an empty response, in all 24 mutation sentinels.** The
      helpers under them only threw at `status >= 400`, so a status-0 resolve fell
      through and `null` meant two things at once. `usePlans().create()` answered
      "the change may have been applied" for a POST that never left the machine.
      The helpers now rule that out before they read a body: `requireServerAnswer()`
      is exported for a consumer writing its own.
    - **`err instanceof TypeError` for a transport failure.** `TypeError` is also
      every ordinary null dereference, so a bug in page code was reported as a
      connection problem — `rows.map` on a `null` sent the operator after their
      router. An unrecognised `TypeError` now keeps its engine text on `message`,
      where a log reads it, and the operator is told `unexpected` rather than shown
      a stack-trace line.

    A consumer's own status-0 error is unaffected throughout: it never carried a
    brand, and its own message still outranks anything the platform would say.

    **`HttpJsonError` is now `AdminError`** — the same class object, not a subclass,
    so an existing `instanceof HttpJsonError` check keeps working and now also
    matches errors raised elsewhere in the package. Construction changed:
    `AdminError` takes one options object where `HttpJsonError` took
    `(status, code)`. Nothing in this repository or in the two sibling consumer apps
    constructs it — a response error is thrown at an app, not by one. For a
    TypeScript caller the change is a compile error; for a JavaScript one it is
    silent, producing an error with `status: 0` and no `code`. That asymmetry is the
    reason to say it here rather than to keep a compatibility constructor for a
    caller no search could find.

    **`ManifestLoader` repairs a broken ETag cache instead of reporting it.** Its two
    storage keys can come apart — a quota eviction, another tab clearing one of them
    — and the conditional request built from the surviving ETag then earns a 304 for
    a body that is gone. That used to throw `ManifestLoadError(304, '… call
clearCache() and reload')`: an instruction addressed to whoever was looking at
    the admin screen, who has neither a console nor a loader handle. The loader now
    drops the pair and repeats the request once without `If-None-Match`, which is
    the same recovery, performed where it is possible. A 304 to a request that
    carried no `If-None-Match` is a server fault and is still reported — with a
    message that says that, and no retry loop.

    Separating the two ideas above made the old behaviour visible: the instruction
    was reaching users only because it was mistaken for something the failing side
    had said, and it would have been shown in English to a German operator. Neither
    half was right, so neither was kept.

    **The diagnostics are English again, and five catalog keys are gone with
    them.** `useDiscovery`, `useCatalogEntries`, `usePromotions` and
    `useMarketingProjections` built the `message` of their branded errors through
    the i18n layer, which made it a translated sentence — German by default — while
    the brand on the class states the opposite: that this text is a diagnostic for
    the log. Both halves were wrong, and one was visible: `DiscoveryPage` renders
    that message, so a 500 reached the screen as the platform's internal wording
    rather than as the catalog's.

    The five keys that produced it are removed, because nothing reaches them any
    more and a key that silently does nothing is worse than one that is gone:
    `discovery.errorDiscoveryHttp`, `discovery.errorRescanHttp`,
    `discovery.errorCatalogHttp`, `promos.apiErrorHttpStatus` and
    `marketing.errors.projectionsApi`. An app that overrode one of them gets a
    compile error from `SaMessagesOverrides` and should drop the override: the
    sentence its users see now comes from the `errors` namespace, which is
    overridable in one place for every seam.

    **Two standard pages stop rendering `error.message`.** `DiscoveryPage` and
    `MarketingCatalogPage` put the caught error's own text in their banner; with
    diagnostics no longer translated that would have shown an English internal line
    to a German operator. Both now call `adminErrorMessage()`, which is what the
    type exists for — what the failing side said when there is such a text, the
    catalog's sentence when there is not. The remaining page-level copies belong to
    the page migration and are untouched.

    ***

    Found while building it, and the reason `isAdminError()` exists rather than a
    plain `instanceof`: **esbuild code-splits ESM but not CJS**, so `dist/index.cjs`
    and `dist/client/index.cjs` each carry their own copy of the class. Verified,
    not assumed:

    ```text
    CJS same class object:            false
    CJS instanceof across entries:    false
    ```

    An app that reaches the package through both entries holds two `AdminError`s.
    Without a brand, `toAdminError` would treat one copy's error as an unknown
    thrown value and re-wrap it — dropping the `status`, `code` and `body` it was
    carrying, which is the failure the type exists to prevent. The brand is a
    `Symbol.for` key, so every copy resolves the same symbol through the process-wide
    registry. Counter-checked by swapping it for a plain `Symbol()`: the
    cross-copy recognition test fails and the "two separate classes" test still
    passes, which is the discrimination that makes the test worth having.

    The same argument holds for the three declarations, which is why they are
    `Symbol.for` keys too: a consumer's HTTP client usually comes from `./client`
    while the page that renders the error reaches `toAdminError` through `.`, so a
    brand that did not resolve across copies would drop the fact and take the
    wording with it.

    The five page-level `errMsg()` copies are not removed here — they belong to the
    page migration. The two banners named above are changed because leaving them
    alone would have been the regression, not because the migration started.

- 17e5247: Let the shell hold the endpoint, and let an app change one call without taking
  over all of them

    `SuperAdminEndpoints` gains `projectKey`. It is app-wide and constant, which is
    why it belongs there: today every page takes it as a prop and every consumer
    passes the same value again per route, with nothing keeping the copies in step.
    Optional, defaulting to `''`, so an app that administers no catalogue need not
    name one.

    `createResourceRegistry` binds the platform's endpoint definitions to one
    `(http, context)` and hands a page the operations already knowing where they
    go. `useResource('plans')` is the whole of what a standard page needs to reach
    its data, and it is typed against the roster: `useResource('plans').update(id,
data)` carries the argument types the descriptor declares, and an unknown key is
    a compile error. The first attempt got that exactly backwards — the key
    parameter erased the operations to a constraint whose `never[]` arguments made
    every call with an argument a type error, while any misspelled resource name was
    accepted. Review caught it; both directions are now checked.

    The bootstrap installs the registry **only when the app names its client**. It
    otherwise has a `defaultHttpClient()` fallback for its own `SUPER_ADMIN_HTTP_KEY`,
    and handing that to the registry would have defeated the guarantee below from
    the inside: existing pages would keep working through their own `getAuthToken`
    options while anything reaching for `useResource()` collected 401s. Without a
    client the registry is simply absent, and `useResource` says which of the two
    reasons applies.

    **`http` is required, with no fallback.** A registry that quietly reached for
    `fetch` when nobody passed a client would send every request without the app's
    `Authorization` header, and that failure is silent: the call 401s, one card
    renders an em dash, and nothing is logged. Three such call sites existed in this
    package and had to be found by reading. The error names the two clients the
    package ships, so the fix is in the message.

    **An override wraps rather than replaces**, and that is the property a
    prop-based page cannot offer. A page that takes its behaviour as twenty-four
    function props takes all of it or none: an app needing one call diverted must
    supply the other twenty-three itself. Here it names the one:

    ```ts
    createSuperAdminApp({
        resourceOverrides: {
            planVersions: {
                ops: {
                    publish: async (next, id, options) => {
                        await recordApproval(id);
                        return next(id, { ...options, forceRegressive: false });
                    },
                },
            },
        },
    });
    ```

    Everything else keeps the platform's implementation. A resource can also be
    pointed at another path (`context: { apiBase: '/api/legacy/admin' }`) or sent
    through a different client, each on its own.

    Overriding an operation that does not exist fails at boot with the list of the
    ones that do — a typo in an override is otherwise a call that silently keeps
    the platform behaviour until someone notices the approval was never recorded.

    Also collapsed here: two copies of the endpoint-defaulting logic, in the
    bootstrap and in `createPlatformLoaders`. The compiler found them, because
    `projectKey` was added to one and not the other — which is exactly what a
    second copy of a default is for.

    Nothing is removed. Pages keep their `projectKey` prop and their endpoint
    options; this adds the place those will move to.

- 17e5247: Give a page one way to hold an async call, and one way to ask before it acts

    Two composables and a port, all additive. No page changes behaviour in this
    release; they are what the page migration will be built on.

    **`useAsyncAction`** holds the shape the pages write out by hand roughly twenty
    times: a flag set true before a call and false in `finally`, an error ref
    cleared before and written in `catch`, and a toast on one or both outcomes.
    Written out each time, the parts drift — some clear the error first and some do
    not, some toast a failure and some only render it, and each one re-derives its
    message from a raw `unknown`.

    `run` does **not** re-throw. A wrapper that recorded the failure and threw it
    again would leave every call site with the `try`/`catch` this exists to remove,
    so the outcome is in the return value: `{ ok: true, value }` or
    `{ ok: false, error }`. That is a deliberate departure from the sketch this was
    planned against, which had it returning `Promise<T>`.

    The first attempt returned `T | undefined`, and review caught that it cannot
    answer for the actions this package has most of. `softDelete`, `discardDraft`
    and `remove` resolve `Promise<void>`, so a successful call already produces
    `undefined` and "undefined means it failed" was a signal that did not exist
    there. Worse, TypeScript narrows the success branch of `void | undefined` to
    `never` — the wrong call site compiles, lints clean, and silently never runs
    its follow-up.

    The success continuation runs **before** the success toast, and `pending` is
    counted rather than set. Both came out of review: announcing success first meant
    a continuation that failed produced "Saved" and then "reload failed" in that
    order, and a second `run` before the first settled let the first one's `finally`
    clear `pending` — releasing a button that was disabled precisely to stop the
    second submit.

    It carries an `errorMessage` hook, and that is not decoration. Five call sites
    map a status and an error code to a specific sentence — a 422 carrying
    `STRICT_MODE_VIOLATIONS` reads out the violations, a 401 says the session
    expired. `AdminError` carries `status`, `code` and `body`, so that mapping is a
    pure function of the error, and the hook is where it attaches. Without it those
    five sites could not move.

    **`useAsyncData`** is the read counterpart. On failure it puts `data` back to
    `initial` rather than leaving what was there — which is what `useApiList`
    already does, and the safer of the two: stale rows under an error message read
    as current data, and nothing on the page says which reload they came from.

    Loads are numbered, so a request a filter change abandoned cannot write over the
    one that replaced it. Review found that gap: the older result won when it
    resolved last, its `finally` cleared `pending` while the newer request was still
    running, and — worst of the three — its `catch` reset `data` to `initial` and
    raised an error for a filter the operator had already left.

    **`UiConfirm`** is the seam a page asks through before doing something it cannot
    undo, alongside the notify port it mirrors. `createSuperAdminApp({ confirm })`
    replaces it; the default is Quasar's `Dialog`.

    It resolves `{ ok, value? }` rather than a boolean, and that shape came from
    counting the calls rather than from taste. Four pages reach for `useQuasar()`
    today, and between them they raise **seven** dialogs, not four. Only three are
    plain yes/no questions. Two more ask for an audit reason the backend requires
    before it will reset a password or deactivate a user, and one asks for the date
    a pilot is extended to. A port returning a boolean would have covered three of
    seven and left the other four on a direct Quasar call — which is the thing the
    port exists to remove. The wider shape matches the confirm provider
    `useTenantActionFlow` already defines, so this is one idea in the codebase
    rather than two.

    One dialog is deliberately not modelled: `UsersPage` shows a generated one-time
    password behind a single acknowledge button. It asks nothing, and giving it a
    cancel button would let an operator dismiss a password that cannot be retrieved
    again.

    The Quasar default is safe as a fallback only because it still asks. An
    implementation that resolved `{ ok: true }` outright would silently approve
    every delete, revoke and deactivation — so there is no such default, and the
    type says so.

    ***

    The package README documented the opposite of this in the section next to the
    notify port — _"Confirm dialogs inside the reference pages intentionally keep
    using Quasar's `Dialog` — the pages are the Quasar layer."_ That decision is
    reversed here, and the sentence is replaced rather than left to contradict the
    code beside it.

- 17e5247: Define an admin endpoint once — starting with the plan catalogue

    A resource is a named set of operations over `(http, ctx, ...args)`:
    framework-free, so `node --test` can drive it against `dist/` like the rest of
    the client layer. `defineResource` declares one, `bindResource` supplies
    `(http, ctx)` and hands back the callable operations.

    It exists because the same URL is currently assembled in several places.
    `catalog/plans/:planId/versions` is built by `usePlanVersions` and again by
    `useLivePlanVersions`; the JSON request/response dance around it — a `204`
    means empty, a 2xx body may not parse, `>= 400` throws with the parsed body
    attached — is written out **four** times in this package, twice byte-identically
    inside one file. That is one decision, so it is written once.

    Landing with it: `plansResource` and `planVersionsResource`, twelve operations.
    The two path stems are the server's asymmetry, not a tidiness problem — reading
    and creating versions goes through the plan, every mutation of an existing
    version addresses the version directly — and they are preserved rather than
    normalised.

    **Partial on purpose.** The roster covers the whole admin surface eventually,
    and the descriptors land family by family as the composables that own those
    endpoints are rebuilt on them. A descriptor nothing calls has nothing keeping it
    honest.

    The behaviour is deliberately identical, including two things that look like
    defects and are not fixed here: path parameters are interpolated without
    encoding, and a project key is appended to some operations and not others. Both
    are what the composables do today. Changing either would send a different
    request than the one that goes out now, which is a behaviour change and belongs
    in a change that says so.

    ***

    Found while writing it, and worth more than the descriptors: **`usePlans` and
    `usePlanVersions` had no test at all**, and they own twelve endpoints. Two
    suites now cover them.

    One drives the composable and the descriptor with the same arguments and
    compares what each puts on the wire, rather than asserting a hand-written list
    of URLs twice. It failed on the first run: `terminateVersion(versionId, endsAt)`
    takes the date as a string and wraps it as `{ endsAt }`, while the descriptor
    had been written to pass its argument through. A hand-written assertion would
    have enshrined the mistake instead of catching it.

    The other pins what each operation does with the answer — create appends,
    update replaces in place, a rejected delete leaves the row where it was, and
    `loadTenantCounts` swallows its failure on purpose without touching the page's
    error state. That half is what a rebuild could quietly change, and it is now
    held.

    Line coverage 79.53 → 82.68, functions 80.47 → 82.86. Branch measured 0.29pp
    lower; the baseline keeps its previous, stricter value rather than recording
    the looser one.

- ec0d10e: Add `useResourceList`, the typed way to page through a platform list, plus the
  first two list descriptors — `tenants` and `audit` — for it to run on.

    A list built on `useApiList` needs an endpoint per call site, which is why every
    page that renders one carries an `endpoint` prop and every consumer app spells
    `/api/v1/admin/tenants` again. `useResourceList('tenants')` asks the resource
    registry instead, which already knows the API base, the project and the locale,
    and the row type comes from the operation rather than from a type argument the
    caller asserts:

    ```ts
    const list = useResourceList('tenants', { filter, pageSize: 25 });
    // list.items is Ref<TenantDto[]> — no endpoint, no generic, no glue.
    ```

    It returns `items`, `total`, `page`, `pageSize`, `pending`, `error`, `reload`,
    `goToPage` and `setPageSize`. `error` is an `AdminError`, so a page can branch on
    `status` and `code`, and the state around the load is `useAsyncData`'s — including
    its generation guard, so two quick filter changes can no longer let the older
    answer land last, which is what happens on `useApiList` today.

    Three details worth knowing before you migrate a page:

    - **`pageSize` is an option.** A page that had a page size to apply called
      `setPageSize()` in setup — and that loads, while the first load was already
      queued, so the list fetched the same rows twice on every mount. Passing the
      size removes the second request.
    - **`page` and `pageSize` are not filter keys.** `TenantListFilter` and
      `AuditQuery` still declare them, and because a filter is serialised after the
      pagination, such a key wins on the wire while `page.value` keeps the number
      `goToPage()` set — the list then reports a page it is not showing.
      `useResourceList` refuses that filter and says so; the descriptors' filter
      types leave the two keys out.
    - **`total` is what the endpoint reports**, and falls back to the rows in hand
      when it reports nothing. Several admin controllers answer with a bare array,
      including `GET /admin/tenants`, so a paginator bound to it is showing "rows
      received" for those.

    `useApiList` is unchanged as the untyped escape hatch for an app's own endpoints,
    and `useTenants` and `useAuditEntries` keep their signatures. What both now share
    is one implementation of the query string, the page bounds and how an answer is
    read — `createAdminResourceClient` had a third copy of the "omit empty values"
    rule, and three copies of one decision is three chances for one of them to start
    sending `status=null`. `ApiListResponse` is now an alias of `ResourceListPage`
    and marked deprecated; it is the same shape, so nothing that imports it breaks.

    One edge of `useApiList` did change with that consolidation: an envelope whose
    `items` is not an array — `{ items: "three" }` — now yields an empty list
    instead of being passed to the table as rows. Everything else it sends and
    records is unchanged, and the descriptors are held to that by a test that drives
    both sides and compares what reaches the client.

- 01f963e: Ship the HTTP adapter every app was writing by hand

    `@saasicat/ui-vue` declares an `HttpClient` contract and shipped exactly one
    implementation of it: `defaultHttpClient()`, a bare `fetch` passthrough with no
    auth. Every real app therefore wrote its own — and wrote the same one. Counted
    across this repository and the three known consumer apps: **eight** hand-written
    adapters, 22 to 64 lines each. Six axios, two `fetch`. The handbook printed a
    ninth as the thing you are supposed to write, and the example app kept two
    copies of it, one for `admin/` and one for `web/`.

    They differ in the prefix they strip. That is the whole variation.

    ```ts
    // before — in every app, and in §8.1 of the handbook
    const httpClient: HttpClient = async (url, init) => {
        const stripped = url.startsWith('/api/v1') ? url.slice(7) : url;
        const r = await api.request({/* … 18 more lines … */});
    };

    // after
    const platformHttp = createAxiosHttpClient(api, { stripPrefix: '/api/v1' });
    ```

    `createAxiosHttpClient(instance, opts?)` is typed **structurally** — it declares
    the one method it uses and does not import axios, so the package still installs
    with `@saasicat/types` as its only dependency. `createFetchHttpClient(opts?)`
    takes a `baseUrl` and a per-request `headers` hook, which is what the two
    `fetch` shims needed: a token read at request time, not at construction, so a
    refresh is picked up without rebuilding the client. The hook may return a
    promise, because one of them awaits its token.

    `defaultHttpClient()` now delegates to `createFetchHttpClient()` rather than
    calling `fetch` itself. One implementation to reason about instead of two that
    drift — and it keeps the ESLint exemption for `fetch` exactly one file wide.
    It gains an `Accept: application/json` header, which is what stops a
    content-negotiating gateway from answering the admin API with HTML.

    **Neither adapter throws on an HTTP status.** The shims used
    `validateStatus: s < 500`, which let a server error escape as an axios
    rejection — a second error shape, out of the one seam whose entire purpose is to
    have one. The platform reads statuses itself: a 304 is a manifest cache hit, a
    402 carries a limit payload, a 409 a conflict. It can only do that for statuses
    it is handed. Only a transport failure rejects now, and `toAdminError()` gives
    it `status: 0`.

    The axios adapter reaches that by **adapting the rejection**, not by overriding
    `validateStatus`. The override was the first attempt and it was wrong: axios
    decides resolve-vs-reject from `validateStatus`, and its response interceptors
    are chained as `then(onFulfilled, onRejected)` — so a config that never rejects
    makes the **rejection half unreachable for every status**. That is the
    conventional place a consumer puts token refresh and retry, and an expiring
    session would have been handed to the platform as a 401 instead of being
    refreshed. The instance now runs its own chain to the end; a rejection that
    still carries a response is adapted, and only a genuine no-response failure
    escapes.

    **"Genuine" is axios's own word for it, not a shape that resembles one.** The
    escaping rejection is marked with `markTransportFailure` — so that `status: 0`
    becomes "check your connection" rather than raw error text — and which
    rejections earn that mark was measured against axios 1.18.1 driven at a real
    `node:http` server, because two readings of the same `catch` disagree and no
    amount of reasoning settles which is right. axios states the answer itself,
    in the three-way split its README documents: `response` set means the server
    answered; `request` set without it means the request was made and nothing came
    back; neither means the failure happened while the request was still being set
    up. A refused connection, a DNS failure, a timeout and an abort all land in the
    middle group, and still do when a rejection interceptor rethrows them.

    Everything else propagates unmarked and keeps its own message. That matters most
    for the case a `config`-based reading got backwards: an interceptor that handles
    a 401 and rejects with `new Error('session expired')` had those words replaced
    by the network sentence, misreporting an expired session as a broken connection.
    `config` is echoed on every axios rejection, answered ones included, and it is
    the field an interceptor is most likely to carry over — it never was a statement
    about whether a response arrived. The same now holds for the failures axios files
    under "setting up the request" (an unsupported protocol, a signal aborted before
    the call, a throwing `paramsSerializer`): their message names the actual fault,
    which beats sending an operator after their router for a configuration mistake.

    The one case nothing here can decide is a client that replaced the rejection
    without saying which case it was in — a bare `Error` out of a structural
    `AxiosLike`, or out of an interceptor. Offline and "session expired" are the
    same object down to the last own property, so the platform declines to guess and
    the message survives. A client that knows says so with `markTransportFailure`,
    which is why that is exported; `isAxiosNoResponseError(err)` is now exported too,
    for a consumer that wants the same reading in its own interceptor.

    Three details the copies got wrong, fixed here once:

    - **Prefix stripping respects path boundaries.** Four of the shims wrote
      `url.slice(7)` — a hardcoded `'/api/v1'.length`. `startsWith` alone matches
      `/api/v10/x` and would cut it to `0/x`. Caught by the test before it shipped.
    - **Response headers read under any casing.** The manifest loader asks for
      `ETag` and then again for `etag`, because it could not rely on the shims
      agreeing. Both adapters answer either.
    - **`json()` decodes the body once.** A normal axios instance has already
      decoded it, so `response.data` may be a string because the body _was_ a JSON
      string — a body of `"ready"` arrives as `ready`. Decoding that again throws,
      and a body of `"null"` would quietly become `null`. The adapter reads which of
      the two it is off the config axios echoes on the response, so `res.json()`
      yields the value that was on the wire for every instance that still runs
      axios's own response transform — the default, `responseType: 'json'`,
      `responseType: 'text'`, `transformResponse: []`, `transformResponse: null` and
      `transitional: { forcedJSONParsing: false }` alike. The last two are read from
      the same fact rather than listed: `transformResponse` is the collection axios
      hands to its own `forEach`, and `forEach` runs nothing for an empty array and
      nothing for a nullish collection, so either is proof the body was not touched.
      An **absent** `transformResponse` is not — that is a structural stand-in that
      never spoke, and it keeps being read as decoded.

        That reading stops where the transform does. An instance carrying its own
        non-empty `transformResponse` echoes the same config a stock instance
        echoes — one opaque function, same array length, same arity — and
        `[(data) => data]` and `[(data) => JSON.parse(data)]` are indistinguishable
        on the response while needing opposite answers. The only field that differs
        is `content-length`, which gzip or a chunked reply makes meaningless. So
        that instance says which it is, with the new `responseBody` option: `'raw'`
        when the pipeline hands the body over as it arrived, `'decoded'` when it
        parses, `'auto'` (the default) to read the response, which is what everyone
        who left `transformResponse` alone wants and has to configure nothing for.

        **The declaration is read before the body is looked at**, and that ordering
        is the whole point of having one. There is a second undecidable case hiding
        in the empty body: axios's transform leaves the same empty `data` behind for
        a zero-byte response and for the two bytes `""`, which are valid JSON meaning
        the empty string. Under `'auto'` the adapter reads an empty `data` as no body
        and `json()` throws, as `Response.json()` does — the honest answer when the
        two cannot be told apart. Under `'decoded'` the consumer has said `data` is
        the value, so `''` is the empty string and is handed over; under `'raw'` it
        is an empty body and still throws.

        **A body axios never turned into text is turned back.** `responseType:
`'arraybuffer'`and`'blob'`switch the decoding off the way`'text'`does;
only the shape differs, so the bytes are decoded as UTF-8 and read like any
other undecoded body.`json()`used to hand back the buffer itself and
 `text()`its serialization —`{"type":"Buffer","data":[123,…]}`for a body
reading`{"slug":"acme"}`. A `'stream'` response is refused with a message
        naming the option to change, because a stream is consumable once and never
        synchronously: returning it satisfied the type and broke the promise.

        The adapter does not force the transform off to make the answer knowable.
        That would work, and it would hand the consumer's own response interceptors
        a string where they had an object — the same mistake as the
        `validateStatus` override above, in a different place.

    `stripPrefix` accepts a list as well as a string, because one consumer strips
    `/api/v1` and then `/api` — apps there mount under both conventions. Order
    matters and the shorter prefix must come last; it is documented on the option.

    Migrated in this release: both notesapp apps, the scaffolder template, and
    handbook §8.1, which now shows the two adapters instead of printing a shim.
    Duplication across `packages/` and `examples/` moves 2.89 % → 2.85 %.

    Existing hand-written clients keep working unchanged — the contract they satisfy
    did not move.

- b64496b: Move the last hand-rolled disclosures onto `AdminAccordion`, and guard the rule

    `AdminAccordion` shipped with three of eight disclosure surfaces migrated. Two
    of the remaining five move here — the promotions list in the marketing catalog,
    whose row was a `<div>` with a click handler, and the advanced section of the
    promo-code form, whose state lived in an icon swap and nowhere else. Both are
    now a real button that reports `aria-expanded` and names the body it controls.

    The promotions list also loses a defect the two idioms hid between them: its row
    and its editor styled themselves as one joined block while the list's `6px` gap
    sat between them.

    Three surfaces stay out, each with the reason written in its own source: the
    marketing catalog's admin rows (`display: contents` cells in a six-column grid,
    with a `grid-column: 1 / -1` editor, and a header full of inputs that cannot go
    inside a `<button>`), the tenant package snapshot (outside the admin, a raw-JSON
    toggle rather than a row), and the first-run wizard's native `<details>`. The
    first two gain `aria-expanded` and `aria-controls` where they are.

    A twentieth rule in `admin-page-shell.test.ts` now fails the build on a click
    that flips a value the same template renders a body on, and on a view that
    declares itself a disclosure with a hand-written `aria-expanded` or a
    `<details>`, unless the file says why. The exemption notes are also the rule's
    fixtures: a note left behind after its surface was migrated fails too.

- b188c06: Refuse a project-scoped resource that has no project, at boot

    A shell configured without `endpoints.projectKey` bound the plan catalogue to an
    empty one, and nothing downstream objected. `?projectKey=` is a perfectly valid
    request: an admin API that filters on it answers for no project at all, so the
    catalogue rendered as an empty catalogue — no error, no empty-state hint, nothing
    saying the shell was misconfigured. The same context put `projectKey: ''` into a
    create body, where it finally failed validation, one operator action and one
    screen later than the mistake. `usePlans()` has refused this at construction from
    the start; a page reaching the same endpoints through the registry did not.

    `bindResource` now refuses it where the resource is bound — which is boot, for
    both `createResourceRegistry()` and `createSuperAdminApp()` — naming the option:

    ```text
    Resource "plans" is project-scoped, but the context it is bound to names no
    project. … Name the project this admin administers — `endpoints.projectKey` for
    createSuperAdminApp(), `context.projectKey` for createResourceRegistry().
    ```

    **Per descriptor, not per registry.** A descriptor declares `projectScoped`, and
    only those are refused. That is not a stylistic choice: of the four platform
    resources exactly one reads `ctx.projectKey`, so a demand made once for the whole
    registry would refuse an admin that lists tenants and reads the audit trail over
    a value those endpoints never send. `defineResource()` takes the declaration as
    a third argument, and a test drives every operation through a recording context
    and fails when a declaration and what the operations actually read disagree in
    either direction — so the flag cannot go stale as the roster grows.

    **What an app has to do:** name `projectKey` in the endpoints it hands
    `createSuperAdminApp()` if it also passes `http`. The scaffolded template now
    does, and `examples/notesapp/admin` — which had been running with an empty one —
    sets `projectKey: 'notesapp'`. An app that passes no `http` client gets no
    registry and needs no project.

### Patch Changes

- 7943cb6: Discovery feature cards: two meta texts move off the disabled colour.

    The separator between a feature's owner and its capability count, and the
    `n · read-only` count above the code-capability list, were painted
    `--sa-color-fg-disabled`. Nothing there is disabled — that role is the bottom of
    the palette, not the bottom of the readable text ladder — and on the card's own
    surface it measured **1.48:1** and **1.42:1**. Both now take
    `--sa-color-fg-subtle`, the quietest readable rung, at 3.50:1 and 3.35:1. They
    stay a step quieter than the line around them, which was the point of the
    distinction in the first place.

    Neither reading was a regression. They had been there since the cards were
    written, and no check had ever looked: the visual fixture handed `DiscoveryPage`
    an empty catalog, so the contrast reader saw the page's empty state and nothing
    else. It now renders real feature and quota rows, and reported both on the first
    run.

- b64496b: Make the promotions timeline bar a control, and let the rule see it

    The promotions list moved onto `AdminAccordion`, but the timeline above it kept
    its own way in: each bar opened the matching editor from a `<div>` with a click
    handler — no keyboard, nothing announceable — which is the shape that migration
    existed to remove. Each bar is now a `<button>` that reports whether the row it
    charts is open.

    The guard walked past it. It collected the states a body is rendered by from
    `v-if`/`v-else-if`/`v-show` only, and once a body is `AdminAccordion`'s the
    condition lives in an `:open` binding instead, where no `v-if` mentions it. It
    now reads those bindings too — and which props count is derived from the
    components themselves, so a second disclosure component is covered without
    anyone remembering to add it here.

    Two further defects in the same detector: tags were matched with a pattern that
    ends at the first `>` in the source, so a `v-if="rows.length > 0"` hid every
    attribute written after it on that element, `@click` included; and the rule had
    no counter-proof, which is why three rounds of it could ship believing they
    asked about disclosures while asking about spelling. Both are fixed.

- dc068a8: Give the seven design values in inline `style` attributes their tokens

    `packages/saas-platform-ui-vue/src` ships as source, so the `.vue` files a
    consumer imports carried four literal font sizes and three literal spacings in
    inline `style="…"` attributes. They now read the scale:
    `--sa-text-2xl` for the two marketing price tags, `--sa-text-2xs` for the
    version status chip, `--sa-space-3` for the hint below the "allow zero price"
    toggle and for the top margin of the promo-code duration input, and
    `--sa-gap-inline` for an optional-field hint's left margin.

    Three of the seven change rendered geometry, all by 1–2px, because the value
    that was written has no rung on the scale:

    - the `∞` in the plan-versions validity column drops from 14px to 13px. Its
      inline override sat on `.pd-arrow-inf`, and the `→` beside it on the same line
      carries the same class at `--sa-text-md` — the two were a pixel apart for no
      stated reason. The override is gone rather than tokenised.
    - two 6px margins become 8px (`--sa-space-3`, which `--sa-gap-inline` also
      resolves to): the hint below the "allow zero price" toggle in the bundle
      publish dialog, and the "optional" hint beside the quotas heading in the
      bundle create panel.

    If you override `.pd-arrow-inf`, `.bvpd__label` or `.bcp-field-hint`, those are
    the three to look at.

- 9a4d25a: Say the batch-column diagnostics in English

    Two errors an integrator reads in a browser console were German, and one JSDoc
    comment on a public prop was too. The repository requires English for
    developer-facing text; nothing checked it, so these travelled through several
    releases.

    `BatchColumnDriftError` said `Spalte "x": …` and now says `Column "x": …`. The
    non-200 diagnostic in `fetchOne` said `Spalte "x" — Endpoint /y antwortete HTTP
503` and now says `Column "x" — endpoint /y responded with HTTP 503`, which is
    the phrasing `BootLoadError` already uses. Both are `message` text, not an
    error class, code or status: a consumer that matches on the class, on
    `instanceof`, or on the status is unaffected; one that matches the German
    sentence is not, and that is the reason this is called out rather than left
    silent.

    The third is the `savePill` prop of `PlanCycleToggle`, whose JSDoc reaches a
    consumer's editor tooltip. Besides being German, it named a German label —
    `"Jährlich"` — for a pill that sits beside a _localized_ yearly label, so the
    example was wrong in every other locale as well.

    Both diagnostics are now asserted in full by the package suite rather than by a
    `/HTTP 503/` fragment, which is what let the German sit there while the test
    stayed green. The JSDoc has no such check, and no cheap honest one was added:
    the obvious umlaut scan sees neither of the two throw sites — `antwortete` has
    no umlaut — while flagging ten legitimate files, among them the `Türkçe`
    endonym and the transliteration maps.
    - @saasicat/types@0.26.0

## 0.25.0

### Minor Changes

- 1cbc4f8: `AdminAccordion` — one row-that-opens, instead of eight.

    Eight surfaces in the admin opened a body from a header, in three incompatible
    idioms, sharing no code. They agreed on nothing measurable: three header
    paddings, three body paddings, two radii, two colours for the open border, two
    transition durations, and hover feedback on exactly one of six despite five
    setting `cursor: pointer`. That is not eight decisions — it is none. There is an
    `AdminTable` and an `AdminSection`, and for "open this" there was nothing, so
    every page wrote it again.

    **The accessibility half matters more than the styling half.** Four of the eight
    were a `<div>` with a click handler: no keyboard, no `tabindex`, nothing an
    assistive technology could announce as a control. A grep for `aria-expanded`
    across the whole package returned zero. A shared component wins that argument
    once; eight surfaces had to win it eight times, and the score was 4:4.

    ```vue
    <AdminAccordion :open="openId === row.id" @update:open="select(row.id)">
        <template #header><!-- the row --></template>
        <template #header-actions><!-- controls that must NOT toggle it --></template>
        <!-- the body, rendered only while open -->
    </AdminAccordion>
    ```

    Two of its three rules are structural rather than cosmetic. `header-actions`
    renders **outside** the trigger, so a control there cannot fire the toggle on
    the way past — the discovery cards relied on an `@click.stop` for that, and
    interactive content nested in a `<button>` has no defined behaviour anyway. And
    the page keeps `open`: five of the eight take it from outside, and the bundle
    list ties opening one row to closing another and loading that bundle's versions
    — a component that owned a boolean would fight it.

    The bundle list and both discovery cards move onto it in this release. The
    remaining surfaces follow; the marketing catalogue's row lives in a CSS grid
    with `display: contents` and needs its own arrangement rather than this one.

    **The badge is the component's, the glyph is the page's.** The row icon was
    drawn three ways — a 34px accent-tinted square, a bare 22px glyph, and a bare
    20px glyph coloured through a Quasar **palette** prop (`color="negative"`, which
    reaches past the role layer entirely) — so the same kind of row did not look
    like the same kind of row from one page to the next. `#mark` takes the glyph and
    `AdminAccordion` draws the frame. `markTone` exists for the one row whose state
    the badge should report, and it moves nothing but the colour.

### Patch Changes

- @saasicat/types@0.25.0

## 0.24.2

### Patch Changes

- 9c12734: Five markers that painted white on a light colour are readable again, and the
  audit that said there were none can now see the place they were written.

    **The report was wrong, and that is the more useful half.** Its headline read
    `hard-coded hex colours 0 in 0 files` while twelve literals sat in six
    templates: three browser-chrome dots written out twice, three diff markers, and
    three `p.color ?? '#94a3b8'` fallbacks that answered one question with two
    different greys. The audit had only ever read `<style>` blocks and `<script>`
    blocks — a colour in a template belonged to no category at all. A zero that is
    wrong is worse than a number that is large, because it ends the search.

    There is now a `colours in templates` category with a floor of zero, and it
    reads the SFC's own parse rather than its text. That distinction is the whole
    value: a slot is `#actions`, an input mask is `mask="######"`, an anchor is
    `href="#top"` and a pull request is `(#124)` in a comment — none of them is a
    colour, all of them look like one to a pattern, and this repo's numbers are
    already four digits. Twenty-six cases pin both halves: what it finds, and what
    it stays quiet about.

    **The literals themselves said something.** Every one resolved to a primitive
    the theme already names, and the three in the version diff were reaching past
    the token layers because there was nothing to reach for: `feature` had a
    `-surface` and an `-fg`, `quota` and `bundle` had no `-fg`. Both are added, and
    they complete the entity family to the shape a tone has. A missing rung does not
    stay missing — it becomes a literal somewhere.

    **White does not sit on a status colour.** Every rung of `--sa-color-<tone>` and
    `-strong` is chosen to be legible _as_ a colour against its own theme's surface,
    which puts it in the middle of the lightness range — and nothing reads on the
    middle. The diff panel's marker paired `--sa-color-fg-on-accent` with
    `--sa-color-positive-strong` and measured **2.54:1 in both themes**, so it was
    never a dark-mode defect and no amount of dark-mode review would have found it.
    Its inline siblings measured 2.77:1 and 2.15:1. All of them are now the tint
    plus the tone's `-fg`, which is what that slot is for: 4.84 / 9.21 for `add`,
    5.98 / 10.80 for a feature row.

    Two more of the same family: the bundle editor's selected feature key kept the
    bare `--sa-color-accent` (2.92:1 on its own tint in dark) when the states around
    it moved to `-strong`, and a marketing chip's `<em>` held `--sa-color-fg-subtle`
    while `:hover` moved the surface underneath it to a 22 % accent tint (2.92:1).
    The `<em>` now takes no colour of its own — the mono face and the smaller step
    already set it apart, and a colour that does not follow its own background is a
    pair nothing can check.

    That shape is why these lasted. All five declared a foreground in one place and
    its background in another — one rule further down, on an ancestor, or in a
    template attribute — and the source checker needs both in one rule body to
    measure anything; the browser checker never mounted the panel and never hovers.
    The diff marker's rules now each carry both halves, so the checker reads them:
    moving the geometry off the base rule is the fix, not a tidy-up.
    - @saasicat/types@0.24.2

## 0.24.1

### Patch Changes

- db43596: The brand colour no longer disappears in dark mode.

    `--sa-color-accent` is the host's `$primary`, and it is the one role that does
    **not** change between themes — that is what a brand is. Everything around it
    does. So it reads at about 4.5:1 on a light card, near 3.4:1 on the dark theme's
    slate, and worse on a tint of itself — which is exactly what a selected state is
    made of. Six rules paired the two, and every one of them looked right in light
    mode: the promo dialog's chosen duration and plan chips, the dashboard's KPI and
    shortcut icons, a status pill, an onboarding eyebrow.

    They now use `--sa-color-accent-strong`, which the design guide already names for
    "accent text on a tint" and which mixes the brand toward the theme's own extreme
    — darker in light, lighter in dark. Branding still follows `$primary`. Measured
    on the promo dialog's selected state: 3.99 → 5.35:1 light, 3.40 → 4.20:1 dark.

    A rule in `theme-layer-discipline` fails the build on the pairing from now on.

    **Plan and tenant chips get the same treatment, and they needed it more.**
    `identityChipStyle()` painted its accent as text on an 8 % wash of that same
    accent, and it does so from an inline `style`, which beats the class rules above
    — so a plan carrying its own `color` kept the unreadable pairing. It also takes
    a colour nobody curates: a stored plan colour, or anything a consumer passes in
    `planAccents`. The text is now mixed halfway toward `--sa-color-fg-heading`,
    which is near-black in light and near-white in dark. All six colours the
    promotion editor itself stores were under 3:1 on a raised dark card (1.99–2.75)
    and four of them on a plain one; they now read 5.48–7.78. Chip backgrounds,
    borders and the plan dot are unchanged, so
    each plan keeps its identity. `theme-role-contrast` measures the helper across
    the whole sRGB cube, not a sample, because the input is not a role.

    **Quasar's own accent text is painted too.** The focused field's floating label
    and the selected item in an open select are coloured `--q-primary` by Quasar, on
    surfaces the theme darkened — the shrunk label is small text and read as
    decoration rather than as the name of the field being edited. Both now take the
    same readable role, including inside teleported
    menus — except while a field is invalid, where Quasar's error colour still wins.
    That carve-out is deliberate: the label inherits the error red from the control,
    and colouring it at all cut that inheritance, so an invalid field looked normal
    while every other error indicator stayed red.

    **Two more, reported from a running admin.** The promo dialog's status buttons
    had no styles at all and rendered as raw browser buttons on a dark dialog; they
    share the segmented-control recipe with the duration row next to them now. And
    the marketing catalogue's open editor ended on the same colour and the same
    hairline as an ordinary row, so the next plan read as part of the plan being
    edited — it is a recessed well with an accent edge and a real closing border.

- 3ab6f56: `DiscoveryPage` no longer takes the route down when the discovery payload is not
  a snapshot.

    `useDiscovery` assigns the response body with an unchecked
    `as DiscoverySnapshot`, so anything a server answers 200 with reaches the page —
    an older backend, a proxy's JSON error page, a partial response. The page read
    `props.snapshot?.app.key`: the optional chain covered `snapshot` being nullish
    and stopped there, so a body that is non-null but has no `app` threw inside a
    computed. A throw in a computed does not degrade a component, it takes the route
    down — the admin shell rendered and the content area stayed blank.

    The three fallbacks already in that file (`—`, `Discovery`, `0.0.0`) are what
    should happen instead; the chain simply did not carry that intent far enough.

    The fields are now narrowed to their **type**, not merely to "present". The type
    says `app.key` is a string; the runtime value is whatever the server sent. A
    truthy non-string — `{"app":{"key":1}}` — passes an existence check and then
    throws on `.charAt`, which is the same white screen one step further in.

- db43596: The three screens outside the admin shell are inside the theme.

    The component layer corrects Quasar's own DOM — the outlined control's
    transparent background, the 4px radii, the `#1d1d1d` card Quasar paints in dark
    mode — and it reaches that DOM through exactly two classes: `.sa-page`, rendered
    by `AdminPage`, and `.sa-portal`, which `createSuperAdminApp` sets on every
    teleported node. The login screen, the first-run setup wizard and the
    fail-closed manifest-error page render outside the shell and carried neither, so
    no rule in `ui/theme/components/` had ever applied to them. They are the screens
    a user sees before and instead of the admin.

    Measured against the visual fixture rather than read off the source: of the
    gated rules, five reached those screens once the marker was there. They now take
    the theme's body colour instead of the browser's black and its body font instead
    of Quasar's Roboto; their outlined inputs take `--sa-radius-field` and a real
    surface instead of a transparent 4px control; the focused field's label takes
    `--sa-color-accent-strong` rather than the raw brand; and the error page's card
    takes `--sa-radius-card` and the slate surface, which is what removes the
    neutral grey card from a dark page. The heading reset applies too: Quasar's
    element-level `h1` had been giving the login and error titles a 96px line box.

    Each screen keeps its own frame — its root class is more specific than
    `.sa-page`, so the login's full-viewport height and padding are untouched.

    Two consequences the marker exposed are fixed with it: the login's form now sits
    the same distance below the heading whether or not the optional subtitle is
    there (the gap used to be Quasar's stray line-height), and the error card no
    longer stretches to the full height of the page frame.

    `tests/theme-reaches-every-page.test.js` derives the reach markers from the
    stylesheets — a class the component layer only ever prefixes and never styles —
    and fails when a page under `pages-standard/` renders a root carrying none of
    them.
    - @saasicat/types@0.24.1

## 0.24.0

### Minor Changes

- 492dd21: One categorical colour ramp, contrast checks that see gradients and dialogs, and
  reflow points that agree with Quasar.

    **One identity ramp instead of five.** `PlanList`, `PlanMatrix`,
    `tenants/format.ts`, `PromoCodesPage`, `MarketingPromotionsTab` and
    `discovery-ui.ts` each carried their own six-colour palette of hex literals —
    two of them byte for byte identical, and the tenants one silently different, so
    the same plan was violet on the plans page and brand blue on the tenants page.
    There is now one ramp in the theme (`--sa-color-identity-1…6`, plus
    `-identity-neutral`), with a value per theme, and one module that reads it:

    ```ts
    import { identityAccentFor, identityChipStyle } from '@saasicat/ui-vue/client';

    const style = identityChipStyle(identityAccentFor(plan.planKey, props.planAccents, index));
    ```

    Consumer colours still win — `planAccents` takes any CSS colour, and the helpers
    mix rather than concatenate.

    The ramp ships in two forms, and which one you want depends on where the colour
    goes. `IDENTITY_ACCENTS` are token references and follow the theme — use them to
    paint. `IDENTITY_ACCENT_VALUES` are concrete colours — use them wherever the
    colour is **stored**, such as a picker whose choice is sent to an API. A test
    binds the two so they cannot drift.

    This closes the `.sa-plan-list-plan-mark` contrast exception: those accents were
    applied as inline styles built by gluing hex digits onto a colour
    (`accent + '15'`), so they could not follow the theme and the plan mark measured
    2.96:1 on a dark surface. Every rung is now chosen to be readable as text in its
    own theme.

    **Two contrast blind spots closed.**

    - Both checkers now read a **gradient's colour stops** and judge the foreground
      against each. The header, the drawer logo, both logo badges and the production
      banner had never been judged: their backgrounds are
      `var(--knob, linear-gradient(…))`, which the source checker resolved to
      `null`, and the browser one skipped any element with a `background-image`.
      It found the plan timeline's draft hatch at 2.34:1 in light and 1.34:1 in dark.
    - The browser checker now looks inside **teleported nodes**. Quasar moves every
      dialog to `<body>`, so a checker walking the page root had never judged one of
      the package's twenty-one dialog sites. It found Quasar's inactive stepper
      labels at 2.68:1, which the theme now paints from a role.

    **Reflow points agree with the thing they have to fit into.** Five of the six
    ad-hoc breakpoints (540, 600, 980, 1280 and one of the 1100s) are on Quasar's
    bands, so a component no longer reflows in a band where the host application's
    grid does not.

    The plan-version editor is the exception, and deliberately: it reflows on a
    **container query** rather than a viewport width. A viewport threshold is wrong
    in one of the admin drawer's two states by construction — with the 240px drawer
    open at 1024–1100px, `320px 1fr 360px` had only 784–860px to sit in, leaving the
    middle column at 104–180px and clipping its form controls behind
    `overflow: hidden`. If you embed `PlanVersionEditor` in a narrower shell than the
    admin's, it now stacks earlier than before; that is the point of the change.

    Two more layout fixes came with it. The plan list **scrolls horizontally**
    instead of being cut off — its six-column grid needs about 790px, and below that
    the wrapper's `overflow: hidden`, which is there for the corner radius, simply
    removed the far columns. And Quasar's **stepper** takes its colours from the
    theme: its inactive step titles were a hard-coded grey at 2.68:1 on a white card.
    The active step keeps Quasar's `text-primary` accent — that is the "you are here"
    affordance.

    **Tenant-facing fixes.** `MySubscriptionBundlesPage` takes an `http` prop like
    every other tenant component — without one it fell through to a bare `fetch()`,
    so an app using an axios adapter with an auth interceptor got an unauthenticated
    request from this page and nowhere else. `planChangeWizardI18n()` is exported,
    so mounting `PlanChangeWizard` directly no longer means reproducing a 44-key
    string mapping by hand. The marketing toolbar wraps instead of pushing content
    off the side of the page below 672px.

### Patch Changes

- @saasicat/types@0.24.0

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

### Patch Changes

- @saasicat/types@0.23.0

## 0.22.2

### Patch Changes

- @saasicat/types@0.22.2

## 0.22.1

### Patch Changes

- @saasicat/types@0.22.1

## 0.22.0

### Minor Changes

- 9dc78b3: Give statistics one tile and sections one surface

    Seven tile implementations existed across the admin pages. Two of them —
    `sa-discovery__kpi` and `sa-bundles__kpi` — were byte identical. Three lived in
    unscoped page-level `<style>` blocks, which is the construction that produced
    the `sa-bundles__head` leak. There was no test on any of them.

    `AdminStatistics` and `AdminKpi` replace all seven:

    ```vue
    <AdminStatistics :columns="4">
      <AdminKpi label="Live" :value="liveCount" sub="published" tone="positive" />
    </AdminStatistics>
    ```

    `action` decides interactivity: with one the tile is a `<button>` carrying
    `aria-pressed`, without one a `<div>`. The three filter strips never announced
    their selected state before. `emphasis` keeps the one difference that was
    real — filter pills colour the number, discovery and draft tiles tint the whole
    tile, because there the colour is the statement. Two tiles set that tint with
    inline `style` and were immune to theming; they use the tone now.

    **Surfaces moved one level down.** `.sa-page` was the only thing painting the
    canvas, so a page could not be transparent. The canvas now sits on the layout —
    covering the gutters beside `max-width: 1600px` too — and sections carry the
    surface, rounded, with a head that echoes the hero one shade lighter. Eight
    sections that also carried `.sa-card` painted twice; the card is gone from them,
    since a section is one.

    **Breaking for CSS overrides.** `.sa-stat*` is gone (use `AdminKpi`), and
    `components/KpiCard.vue` is deleted — it had no importer in this repo or in
    either known consumer. An app that restyled `.sa-stat__num` should move to
    `.sa-kpi__value`.

    Five radius tokens (`--sa-radius-hero|section|card|head|tile`) replace the
    scattered literals; `--sa-radius-tile` is the single declaration requirement
    every tile resolves to. `--sa-bg-surface-2` names the `#f8fafc` inset grey.

    The plans page finally has a hero subtitle.

    **`components/plan-cockpit/` is deleted** — eight files, 1745 lines. It is an
    earlier implementation of the plan drill-in that `plan-detail/` superseded:
    `PlansPage` renders `PlanDetail` for `mode === 'cockpit'`, and nothing anywhere
    imports `PlanCockpit`. Like `KpiCard.vue` it was reachable through the
    `./components/*` subpath, so it belongs in this note. The two `planDetail`
    message keys only it consumed (`kpis.noDraft`, `kpis.createNewDraft`) go with
    it.

- 9599214: Fix four defects that only showed up in a running admin

    **A route-mounted page cannot require props.** `AdminManifestErrorPage`
    declared `onRetry` and `onLogout` as required, but `createAdminRoutes()`
    mounts it as a plain route record and Vue Router passes nothing to such a
    component. The props were unsatisfiable by construction, and this is the
    fail-closed screen — it renders precisely when the app is already in
    trouble, and both of its buttons called `undefined`. They are now optional
    with defaults that work standalone.

    **An expired session is not a broken manifest.** A 401/403 from the
    manifest load sent the operator to the error page — "the manifest could not
    be loaded" — when the truth was "log in again". This is the normal path
    after a token expires, because `isAuthenticated()` in practice only checks
    that a token exists. The guard now separates the two, and offers the
    re-login exactly once: a consumer's `onUnauthenticated` typically clears the
    session, so a manifest that keeps rejecting for a reason logging in cannot
    fix would otherwise produce an unbreakable login loop.

    **Signing out did not sign anyone out.** Both platform affordances are
    reached through components every consumer mounts as bare route records:
    `AdminLayout` at `/admin` and `AdminManifestErrorPage` at `/admin-error`.
    A route record attaches no props and no listeners, so the layout's
    `emit('logout')` reached nobody at all, and the error page's fallback only
    called `router.replace('/login')`. Since `isAuthenticated()` reads a token
    out of storage, the session survived and the next navigation to `/admin`
    walked straight back in — the operator saw a login form and was still
    signed in. `SuperAdminLoginAdapter` gained an optional `logout()`, and both
    components now end the session through it before navigating; apps that pass
    `@logout` or `onLogout` keep full control, and an app that supplies neither
    gets a console warning rather than silence.

    **The fail-closed page was a dead end.** Its retry reloaded `/admin-error`
    in place — a route that is `meta.public` by necessity, so the navigation
    guard returns before it ever reaches `ensureLoaded()`. The manifest was
    never fetched again and the operator stayed stuck even after the backend
    recovered. Retry now boots into a guarded route (`retryPath`, default
    `/admin`).

    **Requests bypassing the HttpClient seam.** Three call sites used a bare
    `fetch()`, dropping the Authorization header the app registered via
    `createSuperAdminApp({ http })`. One of them was unreachable code that
    looked like a safeguard; two were live.

    **The dashboard dropped the auth token it was given.** `DashboardPage`
    declared `getAuthToken` and documented it as the token provider for the
    default client — and never read it. Removing the page's bare `fetch()` had
    taken the Authorization header with it, so an app mounting the page the
    documented way sent every KPI request unauthenticated and rendered an error
    in all of its cards. The token now travels as a header the way `useApiList`
    and the other standard pages do it.

    **`@RequireFeature` failing silently.** `SaaSiCatModule` documented a boot
    warning for the case where no plan resolver is configured — and never
    emitted one. Annotated routes then served everyone, quotas read as
    unlimited, and nothing said so. Two warnings now, each naming what is inert
    and how to fix it.

    Also: the primary `saasicat` CLI now speaks English (it was entirely German,
    against the README's own promise), and `@saasicat/ui-vue` emits the
    declaration files its `./testing-e2e/*` export has always promised — a
    concurrent `clean` in the build deleted them after writing.

### Patch Changes

- @saasicat/types@0.22.0

## 0.21.0

### Minor Changes

- 3d29936: Make the admin page structure a component contract

    The repo had already tried to hold the admin pages to one page structure, as a
    CSS naming convention: `sa-theme.css` asked pages to use `.sa-page-head`
    "instead of creating their own BEM variants". Of the eighteen pages, seven
    did. Four copied the header into their own BEM variant, four pushed it into a
    sub-component, and one shipped its title in a `<div>` with no heading element
    at all. `.sa-toolbar` had no users anywhere. A class name is advice, and advice
    does not hold a structure together.

    The structure is now three components in `components/admin-page/`, and the part
    that makes it a contract is that `title` is a required prop: a page cannot
    forget to instantiate `AdminHero` the way it could forget to add a class,
    because `vue-tsc` rejects it.

    ```vue
    <AdminPage>
      <AdminHero title="Plans & versions" subtitle="…">
        <template #actions><q-btn … /></template>
      </AdminHero>
      <AdminSection title="Active plans"> … </AdminSection>
    </AdminPage>
    ```

    `AdminHero` renders the page's only `<h1>`; `AdminSection` renders a
    `<section>` whose `aria-labelledby` points at its own `<h2>`. The wiring is the
    reason the section is a component: an unnamed `<section>` is not a landmark at
    all, and naming one by hand needs an id unique per instance — the step
    hand-written markup forgets.

    **`<main>` now exists, once.** No page rendered one, and `AdminLayout` wrapped
    the router view in a plain `<div>`, so the admin UI had no main landmark.
    `PlansPage` was the sole exception via `<q-page>`, which renders `<main>`
    itself — so moving the landmark into the layout would have nested one `<main>`
    inside another. The layout owns it now and `PlansPage` no longer uses `QPage`.

    **Breaking for CSS overrides: `.sa-toolbar` and `.sa-toolbar__search` are
    gone.** They had no users in this repo or in either known consumer. `.sa-page`
    and `.sa-section*` are new, and `.sa-page-head*` is unchanged — the classes
    stay unscoped so a consumer app can still restyle `.sa-page-head__title` from
    its own CSS.

    Page props, emits and slots are unchanged, so wrappers around the standard
    pages keep working untouched.

    **Two collisions fixed.** `.sa-bundles__head` / `__title` / `__head-actions`
    were defined in `BundlesPage`'s unscoped `<style>` but appeared nowhere in its
    own template — they styled its child header, and their only other effect was
    leaking onto `plans-page/PlanBundleOverview`, which reuses the same class
    names and got `display: flex` plus `justify-content: space-between` it never
    asked for. The rules are gone with the markup they styled.
    `MarketingCatalogPage` was the second: `mc-` is now `sa-marketing-`, and
    `plan-list/PlanList`'s `pl-` is `sa-plan-list-`, so the admin surface has one
    prefix again.

    **Also.** The first-run setup wizard's title is an `<h1>` instead of a `<div>`.
    The landing-page preview inside the marketing catalog no longer uses `<h1>` for
    its mock-up hero — assistive technology cannot tell a mock-up from the document
    around it. `bundles-page/BundlesHeader.vue` is now `BundlesToolbar.vue` (it no
    longer renders a header) and `discovery-page/DiscoveryHeader.vue` is gone,
    absorbed into the page's hero. Neither was imported outside this package.

    `tests-component/admin-page-shell.test.ts` holds the line: it mounts the
    components and then reads every page source, failing on a hand-written
    `.sa-page-head`, a stray `<h1>`, a `<main>` or a `QPage`.

### Patch Changes

- @saasicat/types@0.21.0

## 0.20.0

### Patch Changes

- 6c0d40d: Make the error contract hold what it promises

    Breaking. A review of the error-code release found the contract stated more
    than the wire delivered.

    **`message` is now always present.** `PlatformErrorBody` declared it required,
    but 36 throw sites passed only `{ code }` — most of the registration funnel,
    every OTP failure. NestJS hands an object argument through verbatim, so those
    responses shipped without a message: a consumer typing the body read
    `undefined`, and `body.message.includes(...)` threw. A new `codedError(code,
params?)` derives the message from the shipped English catalogue, which also
    makes the fallback text identical to the shipped default by construction.

    **One params shape per code.** The same code carried different keys depending
    on which service threw it — `versionId` here, `bundleVersionId` there. Since a
    consumer's translation interpolates by key name, half the throw sites left the
    placeholder unfilled. `error-params-contract.test.js` now fails if a throw site
    omits a placeholder its template names, or if two sites disagree on a key.

    **`FEATURE_NOT_LICENSED` has one shape.** Both feature guards always emit the
    full `FeatureNotLicensedBody`; without a resolver `offers` is `[]` rather than
    absent, so a consumer can rely on the declared type. The code is now part of
    `PLATFORM_ERROR_CODES`, so an exhaustive switch covers it.

    **Renamed / split codes** — update any consumer that matches these strings:

    | before                                 | after                                                    |
    | -------------------------------------- | -------------------------------------------------------- |
    | `PLAN_VERSION_NOT_LIVE`                | `PLAN_VERSION_NOT_PUBLISHED` / `PLAN_VERSION_SUPERSEDED` |
    | `SUBSCRIPTION_BUNDLE_ALREADY_CANCELED` | `SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED`                  |
    | `SUBSCRIPTION_BUNDLE_NOT_CANCELED`     | `SUBSCRIPTION_BUNDLE_NOT_CANCELLED`                      |

    The split matters: one code covered both "was never published" and "already
    superseded", which a consumer could not tell apart.

    Also: `QUOTA_DIMENSION_UNKNOWN` is emitted instead of a bare `Error` (still
    500 — the dimension comes from the calling code, not from user input), the
    promo rate limiter sends the `retryAfterSeconds` its catalogue entry promises,
    and `requireSubscriptionPk` gained `SUBSCRIPTION_PK_MISSING` so a wiring error
    is distinguishable from a missing subscription.

    `reason` remains alongside `code` everywhere it existed.

- Updated dependencies [6c0d40d]
    - @saasicat/types@0.20.0

## 0.19.0

### Patch Changes

- edfbdfe: Ship default error texts in English and German

    An error body carries a code and an English developer message. That leaves a
    consumer two bad options: show English to end users, or translate 128 strings
    before showing anything. For the 21 codes thrown as a bare `{ code }` —
    most of the registration funnel, including every OTP failure — there is no
    message at all, so the code itself was the only thing to display.

    `ERROR_MESSAGES_EN` and `ERROR_MESSAGES_DE` now ship a text per code, and
    `resolveErrorMessage` renders one: consumer override first, then the shipped
    default, then the `message` from the body, and only then the bare code. Since
    every coded exception carries a message, that last step is unreachable in
    practice — a consumer that has not yet translated a new code shows English
    prose, never `PLAN_VERSION_NOT_LIVE`.

    The English texts are derived from the messages the backend actually sends, so
    the shipped default cannot drift from the real one. Placeholders read `params`
    first and the remaining body fields second, so a value already on the wire is
    not duplicated into `params` just to be interpolated.

    `error-messages.test.js` fails if any code lacks a text in any shipped locale,
    or if two locales interpolate different values for the same code.

    `formatMessage` in `@saasicat/ui-vue` now delegates to the same implementation
    instead of keeping a byte-identical copy.

- Updated dependencies [0c17a83]
- Updated dependencies [b01eaa0]
- Updated dependencies [edfbdfe]
    - @saasicat/types@0.19.0

## 0.18.1

### Patch Changes

- 2c487b2: PilotEditDialog now uses the same class names as PilotCreateDialog. The styles
  are scoped, so the rename has no effect on consumers — it only makes visible
  that both dialogs draw the same building blocks.
- 2c487b2: The pilot dialogs now share their building blocks through one stylesheet
  instead of two identical copies. The emitted CSS is unchanged.
- 2c487b2: The promo-code dialogs now share their form body through one internal
  component. Create and edit had kept byte-identical copies of it. The public
  surface of both dialogs — props, emits, class names — is unchanged.
    - @saasicat/types@0.18.1

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
