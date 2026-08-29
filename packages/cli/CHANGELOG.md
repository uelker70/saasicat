# @saasicat/cli

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [1e9b842]
- Updated dependencies [a3a298e]
    - @saasicat/core@1.0.0-rc.8
    - @saasicat/nest@1.0.0-rc.8
    - @saasicat/spec@1.0.0-rc.8

## 1.0.0-rc.7

### Major Changes

- 89eed2b: **`projectKey` leaves the data model.** One installation serves one application,
  so a plan key, a bundle key, a feature key and a quota key are unique for the
  whole installation — and nothing carries a project above them any more.

    The column never had a second value to hold. `config/saas.yaml` named one
    project, the module resolved it once at boot, and there was no per-request
    switch; `subscriptions.tenantId` is unique installation-wide, so a customer of
    two applications in one database could not exist. What it did do was contradict
    the schema beside it: `plan_versions.planId` holds the plan **key** and no
    project, so two plans sharing a key shared one version lineage, and
    `plan_versions_draft_per_plan` then stopped the second one from opening a draft
    at all.

    **Ten tables lose the column** — `plans`, `bundles`,
    `capability_/feature_/quota_catalog_entries`, `marketing_projections`,
    `marketing_settings`, `promotions`, `checkout_offers`,
    `subscription_contracts` — and every `(projectKey, <key>)` unique index becomes
    `(<key>)`. `marketing_settings` becomes a singleton, capped by a constant
    primary key rather than by its project.

    **Run one SQL file against an existing database:**

    ```bash
    psql "$DATABASE_URL" -f node_modules/@saasicat/spec/sql/1.0-remove-project-key.postgres.sql
    ```

    It starts with a guard. Where the catalogue holds rows under more than one
    project key — in one table or spread across several — it stops and names which
    table held which, rather than merging rows that would then collide on the new
    unique index. It is a one-way door, and safe to run again: a table whose column
    has already gone is skipped.

    Each table's changes are made only where that table exists, so an app that
    adopted a subset of the Prisma fragments migrates what it has. The file also
    adds a `CHECK` keeping `marketing_settings` to one row — that was a convention
    resting on a column default, and a default does not apply to a caller that
    supplies the value.

    If your dev setup uses `prisma db push`, run the file **before** it. `db push`
    refuses to drop a column that still holds data, and adding `--accept-data-loss`
    would arm every future change to discard data unasked.

    The codemod reads your `schema.prisma` as well and reports what it finds there:
    a schema you copied the platform's models into still declares the columns, and
    a client generated from it would query them.

    **For your code**, `saasicat codemod v1` gained a third pass —
    `v1-project-key`. It removes the `?projectKey=` query part from a `/catalog/`
    URL and the key from `config/saas.yaml`, and it _reports_ every object member
    by file and line rather than removing it: in TypeScript an object literal and a
    type literal are the same tokens, so a scan that rewrote members would sometimes
    delete one of your own declarations. The upgrade guide's table says what each
    reported shape becomes.

    **What changes at the surface:**

    - `app.name` is **required** in `config/saas.yaml`; it is the one place the
      application names itself, and what the manifest and login page display.
      `dbCatalog` takes `{ app, currency, vatRate }`.
    - `SuperAdminEndpoints`, every catalogue composable and every admin resource
      drop the field; the catalogue endpoints no longer read `?projectKey=`.
    - `PlanRow`, `BundleRow`, `PromotionRow`, the catalog-entry rows,
      `MarketingProjectionRow`, `MarketingSettingsRow`, `CheckoutOfferRow`,
      `SubscriptionContractRecord` and their create/filter DTOs lose it;
      `findByKey`, `retireMissing`, `findFeature`/`findQuota`, the review, i18n and
      base setters, `countActiveByPlanKey` and `loadSnapshot` lose their first
      argument. `PromotionFilter` and `unambiguousPlanKeys` are gone.
    - Four error messages drop the phrase — `Plan 'STANDARD' already exists` — and
      the `params` entry with it. Nothing read that parameter.
    - `saasicat init --project-key` and `pnpm create saasicat-admin --project-key`
      are `--app-key`: the slug of the application, which is what they always were.

    **Three new guards, because a removal leaves no trace.** The persistence
    contract now proves a key is taken once for the installation, and that retiring
    a plan does not free it — a rule `adapter-drizzle` did not follow, and now does.
    `tests/a-key-belongs-to-the-installation.test.js` fails on the identifier coming
    back anywhere in the repository. And the migration refuses ambiguous data rather
    than merging it.

    Migration guide: [`docs/guides/upgrade-to-1.0.md`](https://github.com/uelker70/saasicat/blob/main/docs/guides/upgrade-to-1.0.md).

### Patch Changes

- Updated dependencies [2754055]
- Updated dependencies [d492281]
- Updated dependencies [89eed2b]
- Updated dependencies [9e42ff1]
- Updated dependencies [9b5ca2f]
    - @saasicat/nest@1.0.0-rc.7
    - @saasicat/spec@1.0.0-rc.7
    - @saasicat/core@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- Updated dependencies [a56af36]
    - @saasicat/core@1.0.0-rc.6
    - @saasicat/nest@1.0.0-rc.6
    - @saasicat/spec@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- @saasicat/spec@1.0.0-rc.5
- @saasicat/core@1.0.0-rc.5
- @saasicat/nest@1.0.0-rc.5

## 1.0.0-rc.4

### Patch Changes

- ed230d3: The README's CLI module example wired `PlanCatalogModule.forRoot({ path })`, an
  option the module has not taken since the catalogue moved into the database. It
  now shows the four options it actually requires, with the Prisma read sink.
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

- ed230d3: `schema apply`'s own header comment said it does not carry enums. It has since
  `1.0.0-rc.2`, and the sentence sent readers looking for a step that no longer
  exists.
- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
- Updated dependencies [09fa5f1]
- Updated dependencies [ed230d3]
- Updated dependencies [ed230d3]
    - @saasicat/nest@1.0.0-rc.4
    - @saasicat/spec@1.0.0-rc.4
    - @saasicat/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

- @saasicat/spec@1.0.0-rc.3
- @saasicat/core@1.0.0-rc.3
- @saasicat/nest@1.0.0-rc.3

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

- Updated dependencies [3ebc363]
    - @saasicat/nest@1.0.0-rc.2
    - @saasicat/spec@1.0.0-rc.2
    - @saasicat/core@1.0.0-rc.2

## 1.0.0-rc.1

### Patch Changes

- Updated dependencies [8aced6f]
    - @saasicat/core@1.0.0-rc.1
    - @saasicat/spec@1.0.0-rc.1
    - @saasicat/nest@1.0.0-rc.1

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

### Minor Changes

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
    - @saasicat/nest@1.0.0-rc.0
    - @saasicat/types@1.0.0-rc.0
    - @saasicat/spec@1.0.0-rc.0

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
    - @saasicat/nest@0.27.0
    - @saasicat/types@0.27.0
    - @saasicat/spec@0.27.0

## 0.26.1

### Patch Changes

- @saasicat/spec@0.26.1
- @saasicat/types@0.26.1
- @saasicat/nest@0.26.1

## 0.26.0

### Patch Changes

- Updated dependencies [bea2423]
    - @saasicat/nest@0.26.0
    - @saasicat/spec@0.26.0
    - @saasicat/types@0.26.0

## 0.25.0

### Patch Changes

- @saasicat/spec@0.25.0
- @saasicat/types@0.25.0
- @saasicat/nest@0.25.0

## 0.24.2

### Patch Changes

- @saasicat/spec@0.24.2
- @saasicat/types@0.24.2
- @saasicat/nest@0.24.2

## 0.24.1

### Patch Changes

- @saasicat/spec@0.24.1
- @saasicat/types@0.24.1
- @saasicat/nest@0.24.1

## 0.24.0

### Patch Changes

- @saasicat/spec@0.24.0
- @saasicat/types@0.24.0
- @saasicat/nest@0.24.0

## 0.23.0

### Patch Changes

- @saasicat/spec@0.23.0
- @saasicat/types@0.23.0
- @saasicat/nest@0.23.0

## 0.22.2

### Patch Changes

- Updated dependencies [4a0b534]
    - @saasicat/nest@0.22.2
    - @saasicat/spec@0.22.2
    - @saasicat/types@0.22.2

## 0.22.1

### Patch Changes

- Updated dependencies [2348568]
- Updated dependencies [854fb16]
    - @saasicat/nest@0.22.1
    - @saasicat/spec@0.22.1
    - @saasicat/types@0.22.1

## 0.22.0

### Minor Changes

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

- Updated dependencies [9599214]
    - @saasicat/nest@0.22.0
    - @saasicat/spec@0.22.0
    - @saasicat/types@0.22.0

## 0.21.0

### Patch Changes

- @saasicat/spec@0.21.0
- @saasicat/types@0.21.0
- @saasicat/nest@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [6c0d40d]
    - @saasicat/types@0.20.0
    - @saasicat/nest@0.20.0
    - @saasicat/spec@0.20.0

## 0.19.0

### Minor Changes

- 0c17a83: Translate all user-facing strings to English

    Exception messages, log output, validation messages and CLI output were partly
    German. For an open-source package the shipped language has to be English, so
    consuming apps can localise on their own terms.

    Both feature guards keep `Feature` as the leading word of their 403 message
    (`Feature X is not included in the current plan.`). Consumers that classify the
    403 by matching the message text — autohauspro does — keep working. That text
    match is a fragile contract, and the follow-up is to give every exception a
    stable `code` so consumers can resolve their own i18n by code instead of by
    message.

    No API, no behaviour and no error-code change; only message text.

### Patch Changes

- b01eaa0: Give every exception a stable error code

    Consumers had to classify errors by matching the message text — autohauspro
    still does, with `data.message.includes('Feature')`. While the message is the
    contract, no message can be reworded safely, and a package that ships English
    text cannot be localised by its consumers.

    `@saasicat/types` now exports a catalogue of 127 codes grouped by domain, plus
    `PlatformErrorCode` and `PlatformErrorBody`. Every exception in
    `@saasicat/nest` carries `{ code, message, params }`: the code is the
    contract, `message` is an English developer-facing fallback, and `params`
    holds the values previously only interpolated into the text, so a consumer can
    render a translated sentence without scraping ids back out of the message.

    Guards that reported through a `reason` field (MFA, promo rate limit,
    IP rate limit, the limit-exceeded filter) now send `code` **and** `reason`.
    `reason` is deprecated but retained, so nothing breaks.

    Wire-shape note: NestJS turns a string argument into
    `{ message, error, statusCode }` but passes an object argument through
    verbatim. Coded errors therefore carry no `error`/`statusCode` in the body —
    the HTTP status is on the response itself. No consumer in this workspace reads
    those fields from the body.

    Two known defects are documented in the catalogue and deliberately left for a
    separate release, because fixing either changes the wire format:
    `PLAN_VERSION_NOT_LIVE` covers two distinct causes, and
    `SUBSCRIPTION_BUNDLE_ALREADY_CANCELED` spells "cancel" with one L beside a
    sibling that uses two.

    Also repairs 28 strings that the previous translation left half-German
    ("is notehr buchbar", "not foundefunden") or untranslated.

- Updated dependencies [0c17a83]
- Updated dependencies [b01eaa0]
- Updated dependencies [edfbdfe]
    - @saasicat/nest@0.19.0
    - @saasicat/types@0.19.0
    - @saasicat/spec@0.19.0

## 0.18.1

### Patch Changes

- @saasicat/spec@0.18.1
- @saasicat/types@0.18.1
- @saasicat/nest@0.18.1

## 0.18.0

### Patch Changes

- @saasicat/spec@0.18.0
- @saasicat/types@0.18.0
- @saasicat/nest@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [cbd1737]
    - @saasicat/nest@0.17.0
    - @saasicat/types@0.17.0
    - @saasicat/spec@0.17.0

## 0.16.0

### Patch Changes

- @saasicat/spec@0.16.0
- @saasicat/types@0.16.0
- @saasicat/nest@0.16.0

## 0.15.1

### Patch Changes

- Updated dependencies [de0fc7c]
    - @saasicat/nest@0.15.1
    - @saasicat/spec@0.15.1
    - @saasicat/types@0.15.1

## 0.15.0

### Patch Changes

- Updated dependencies [c970673]
    - @saasicat/nest@0.15.0
    - @saasicat/spec@0.15.0
    - @saasicat/types@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [76d99a5]
    - @saasicat/nest@0.14.0
    - @saasicat/spec@0.14.0
    - @saasicat/types@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [362a1a7]
    - @saasicat/types@0.13.0
    - @saasicat/nest@0.13.0
    - @saasicat/spec@0.13.0

## 0.12.1

### Patch Changes

- da8aa64: Fix four parsing defects in `schema check`, all found by review of the previous
  two releases. Each let the check pass on a schema it should have flagged, or
  skip a declaration it should have compared.

    **Commented-out block attributes counted as present.** A consumer with
    `// @@unique([tenantId])` or `// @@map("subscriptions")` was reported `ok`,
    defeating exactly the correctness gate those attributes exist for. Attribute
    parsing now strips comments first. A production consumer had consequently
    never applied its canonical partial unique indexes at all.

    **A brace inside a string literal closed the model early.** `@default("}")`
    counted as structure, so every field below it looked missing — or spec fields
    after it were silently dropped and the check returned a false success. Brace
    counting now blanks string contents. `stripLineComment` became string-aware in
    the same move, so `@default("http://x")` no longer loses everything after `//`.

    **Indexed field arguments were skipped entirely.** In
    `@@index([title(sort: Desc)])` the capture stopped at the argument's closing
    paren before reaching `]`, so the index never entered the parsed set and a
    consumer lacking it got no finding. The field list is now matched to its
    closing bracket.

    **Unknown fragment selectors were silently discarded.** `--fragments=01,99`
    checked only fragment 01 and exited 0, so a typo in a CI gate left part of the
    schema surface unverified. Unknown selectors now fail with the available list.
    - @saasicat/spec@0.12.1
    - @saasicat/types@0.12.1
    - @saasicat/nest@0.12.1

## 0.12.0

### Minor Changes

- c78e1f0: `schema check` now compares block-level attributes too — `@@index`, `@@unique`
  and `@@map`.

    Comparing only fields and enum values left a whole class of divergence
    invisible. Multiple consumer schemas were missing declared indexes while
    still reporting "no drift". Worse, the same blind spot hid a missing
    `@@unique`: nothing in the field comparison can tell you that a constraint
    the platform relies on was never created.

    The two kinds are not treated alike. A missing index costs query time but
    breaks nothing, so it is reported as information and does not fail the run. A
    missing `@@unique` or a diverging `@@map` does fail: the platform relies on the
    constraint holding, and on finding the table under its canonical name.

    Attribute options and whitespace are normalised, so `@@index([a,b], map: "x")`
    matches `@@index([a, b])`. Indexes a consumer adds on top are never reported —
    same rule as for fields.

    Note the remaining gap: constraints Prisma's DSL cannot express at all (the
    partial unique indexes in `sql/constraints.postgres.sql`) still live outside
    any schema comparison. Consumers must apply them separately.

### Patch Changes

- @saasicat/spec@0.12.0
- @saasicat/types@0.12.0
- @saasicat/nest@0.12.0

## 0.11.0

### Minor Changes

- bded377: Rename the CLI binary from `saas-platform` to `saasicat`.

    **Breaking for anyone invoking the binary by name.** `pnpm exec saas-platform …`
    becomes `pnpm exec saasicat …`. No alias is kept: the audited integrations
    use `@saasicat/cli` as a library for their `nest-commander` commands and ship
    their own binary.

    The old name was the last user-facing place where the package still announced
    itself as "saas-platform" while shipping as `@saasicat/cli`, which made it
    easy to confuse this framework with superseded `saas-platform-*` packages.
    The header comment `schema apply` writes into a consumer's `schema.prisma`
    now names `saasicat schema apply` too.

    Deliberately unchanged: the DI token namespace (`Symbol.for('saas-platform/…')`,
    `Symbol.for('saas-platform-cli/…')`). Those strings are identity, not
    branding — renaming them would break token equality between package versions.
    CONTRIBUTING.md documents the namespace as historical.

- bded377: Add `saasicat schema check` — reports what a consumer's `schema.prisma`
  is missing relative to the canonical prisma-fragments, and exits 1 on drift so
  CI can gate on it.

    `schema apply` only ever adds whole models: it carries no enums, and a model
    that already exists is skipped rather than updated. After a package upgrade a
    consumer schema therefore falls behind silently, and the gap only surfaces as a
    runtime error. Run against reference and consumer schemas, the new check
    finds missing `PlanVersion`/`BundleVersion` fields and field mismatches that
    were previously invisible.

    The check distinguishes two situations that look alike:

    - A field or enum value missing from a declaration the consumer **does** carry
      fails the check — platform code reads it with the spec's type. Type,
      optionality and list changes fail for the same reason.
    - A model or enum the consumer does not carry at all is reported as
      information. Not adopting a fragment is a decision, not drift.

    Fields a consumer adds on top of a platform model are never reported:
    extending them is supported, so a drift check has to tolerate it. Replacing a
    spec `String` with a locally declared enum stays allowed too — the fragments
    document that substitution explicitly.

    The block parser `schema apply` used moved to `prisma-blocks.ts` and now
    handles `enum` declarations as well; `extractModelNames`/`extractModelBlocks`
    keep their signatures.

### Patch Changes

- bded377: Align `PromoCode.createdById` with the types the platform already publishes, and
  stop `schema check` from flagging consumers that are stricter than the spec.

    The prisma fragment declared `createdById String` (NOT NULL) while
    `PromoCodeRecord.createdById` in `@saasicat/types` is `string | null` — the read
    contract explicitly allows a missing creator, so the column must too. Creation
    is unaffected: `CreatePromoCodeData.createdById` stays `string`. The fragment
    and the generated `reference-schema.postgres.sql` now say `String?` / `TEXT`.

    `schema check` treated nullability as a symmetric mismatch, which made this a
    zero-sum change: relaxing the spec simply moved the warning between consumer
    schemas. Only one direction can actually break — a consumer column that is
    nullable where the spec is not, because platform code reads it with the
    spec's non-null type and a NULL row reaches it as `null`. The reverse is a
    deliberate tightening by the consumer, and if the platform ever wrote NULL
    there the insert would fail loudly rather than silently. Only the breaking
    direction is reported now.

- Updated dependencies [bded377]
    - @saasicat/spec@0.11.0
    - @saasicat/types@0.11.0
    - @saasicat/nest@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [30ec6c6]
    - @saasicat/nest@0.10.1
    - @saasicat/spec@0.10.1
    - @saasicat/types@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [7145f07]
    - @saasicat/nest@0.10.0
    - @saasicat/spec@0.10.0
    - @saasicat/types@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [b30a110]
    - @saasicat/types@0.9.0
    - @saasicat/nest@0.9.0
    - @saasicat/spec@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [1003a52]
    - @saasicat/spec@0.8.0
    - @saasicat/types@0.8.0
    - @saasicat/nest@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [05729ce]
    - @saasicat/nest@0.7.0
    - @saasicat/spec@0.7.0
    - @saasicat/types@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [98274fe]
- Updated dependencies [0c08fc3]
    - @saasicat/spec@0.6.0
    - @saasicat/types@0.6.0
    - @saasicat/nest@0.6.0

## 0.5.0

### Patch Changes

- @saasicat/spec@0.5.0
- @saasicat/types@0.5.0
- @saasicat/nest@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [5802454]
    - @saasicat/nest@0.4.0
    - @saasicat/spec@0.4.0
    - @saasicat/types@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [d758318]
    - @saasicat/types@0.3.0
    - @saasicat/spec@0.3.0
    - @saasicat/nest@0.3.0

## 0.2.1

### Patch Changes

- @saasicat/spec@0.2.1
- @saasicat/types@0.2.1
- @saasicat/nest@0.2.1

## 0.2.0

### Patch Changes

- 32cca3b: Replace two backtracking-prone regexes with linear string scans (CodeQL `js/polynomial-redos`): the Prisma `//`-comment strip in `schema apply` and the trailing-slash trim of the billing `apiPrefix`. `@saasicat/ui-vue` now exports `trimTrailingSlashes`.
- Updated dependencies [db10ab9]
- Updated dependencies [c94b1fe]
    - @saasicat/spec@0.2.0
    - @saasicat/types@0.2.0
    - @saasicat/nest@0.2.0
