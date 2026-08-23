# @saasicat/adapter-prisma

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

- @saasicat/types@0.26.1

## 0.26.0

### Patch Changes

- @saasicat/types@0.26.0

## 0.25.0

### Patch Changes

- @saasicat/types@0.25.0

## 0.24.2

### Patch Changes

- @saasicat/types@0.24.2

## 0.24.1

### Patch Changes

- @saasicat/types@0.24.1

## 0.24.0

### Patch Changes

- @saasicat/types@0.24.0

## 0.23.0

### Patch Changes

- @saasicat/types@0.23.0

## 0.22.2

### Patch Changes

- @saasicat/types@0.22.2

## 0.22.1

### Patch Changes

- @saasicat/types@0.22.1

## 0.22.0

### Patch Changes

- @saasicat/types@0.22.0

## 0.21.0

### Patch Changes

- @saasicat/types@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [6c0d40d]
    - @saasicat/types@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [0c17a83]
- Updated dependencies [b01eaa0]
- Updated dependencies [edfbdfe]
    - @saasicat/types@0.19.0

## 0.18.1

### Patch Changes

- @saasicat/types@0.18.1

## 0.18.0

### Patch Changes

- @saasicat/types@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [cbd1737]
    - @saasicat/types@0.17.0

## 0.16.0

### Patch Changes

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

### Minor Changes

- 362a1a7: Thread the caller's `TransactionContext` through the entitlement lookup ports.

    `EntitlementService.deriveLimits` used to call
    `SubscriptionContractRepository.findActiveByTenantId`,
    `SubscriptionBundleRepository.listActiveBySubscription` and
    `BundleRepository.findVersionById` without the surrounding transaction. Inside
    `enforceLimit` — which holds the subscription row lock in an interactive
    transaction — every one of those lookups therefore had to draw an **extra**
    pool connection. Once N parallel `enforceLimit` calls occupy N pool slots, the
    lookups starve, nothing ever completes and all transactions expire
    (observed in production-like load: 10 parallel creations at the limit against
    the node-pg default pool of 10 → 0/10 succeed).

    The three port methods now accept an optional trailing `tx?: TransactionContext`
    (backward compatible — existing adapters keep working unchanged), the service
    forwards its transaction, and the Prisma adapters query on the transaction
    connection when it is provided.

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

- 30ec6c6: Make the plan-catalog snapshot deterministic, and close two gaps in the
  shared-CJS-bundle work.

    - `PrismaPlanCatalogReadSink` ordered plans and feature entries by `sortOrder`
      alone — not a total order, so rows sharing a value came back in whatever
      order Postgres picked, and the live plan-version query had no ordering at
      all. The snapshot feeds the admin-manifest hash, so two processes reading
      identical data disagreed on the hash: `GET /admin/manifest` and a CLI
      `manifest hash` could never be compared. All three queries now carry a
      deterministic tiebreaker.
    - The public entry list is derived from `package.json` `exports` instead of
      being repeated in the tsup config, the stub generator and the identity test.
      A new entry that was added to only some of those copies kept its own
      duplicated CJS bundle — silently reintroducing the split class identities the
      shared bundle exists to prevent. The build now fails with an actionable
      message instead.
    - `globalFeatureGuard`'s documentation named the wrong class. The option
      unbinds `StaticFeatureGuard`, not `FeatureGuard` — they are different
      classes backed by different entitlement paths — and neither the JSDoc nor
      the migration guide said that a replacement guard MUST be bound. An app
      following the old wording would have left every `@RequireFeature` route
      serving unlicensed traffic.
    - @saasicat/types@0.10.1

## 0.10.0

### Minor Changes

- 7145f07: Make the CommonJS entry points share one set of objects, and open the seams a
  consumer app needs when its shape does not match the standard stack's defaults.
  Each of these was previously unreachable, so an app that hit one had to abandon
  `SaaSiCatModule` entirely rather than configure around it.

    - **The CJS build now emits one shared bundle** (`dist/_entries.cjs`) with a
      thin re-export per entry, instead of a separate bundle per entry. esbuild
      cannot code-split CommonJS, so every shared module used to be copied into each
      entry — and since Nest resolves providers by class reference, two copies of a
      class are two different providers. Composing `SaaSiCatModule` (from
      `./platform`) with `SetupModule` (from the root entry) failed at boot with
      "MfaService is not available in the SetupModule module". ESM was already
      code-split and unaffected. Consumers no longer need to know which entry a
      class "really" comes from.
    - Exported DI tokens that were still plain `Symbol()` are now `Symbol.for`,
      per the rule in `CONTRIBUTING.md` — 42 of them, including
      `ADMIN_MANIFEST_CONFIG`. The catalog and billing `FEATURE_UI_REGISTRY_TOKEN`
      stay deliberately distinct and are now namespaced apart rather than colliding
      by accident.
    - `@saasicat/nest/platform` additionally re-exports the modules and services an
      app composes alongside `SaaSiCatModule` (`AdminModule`, `AdminManifestModule`,
      `AdminStatsModule`, `SetupModule`, `CheckoutOfferModule`,
      `SubscriptionContractModule` and their services), so the standard stack can be
      assembled from a single import path.
    - New `globalFeatureGuard` option. The module bound `StaticFeatureGuard` as a
      global `APP_GUARD` unconditionally. Nest runs every global guard before every
      controller-local one, so apps that authenticate in a controller-local guard
      got a 403 on all feature-gated routes before authentication had run. Set
      `false` to bind the guard behind your own auth guard instead. The quota
      interceptor stays global either way — interceptors run after all guards.
    - `includeManifestController` is now passed through to `AdminManifestModule`.
      Apps serving `GET /admin/manifest` from their own controller could not
      suppress the platform one, and two controllers on one path abort the boot with
      a duplicate-route error.
    - `prismaPersistence()` accepts a `bundle` option forwarded to both bundle
      repositories it builds. Because the bundle constructs them directly rather
      than through Nest DI, the repository's `@Optional()` options provider never
      applied, leaving `validityWindows` unreachable — bundle publishes then
      silently dropped `validFrom`.

### Patch Changes

- @saasicat/types@0.10.0

## 0.9.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [1003a52]
    - @saasicat/types@0.8.0

## 0.7.0

### Minor Changes

- 05729ce: Add explicit, backwards-compatible Prisma schema profiles for semantic
  plan-key and normalized Plan UUID bindings, configurable catalog and
  entitlement delegates, opt-in PlanVersion and BundleVersion validity windows,
  and atomic tenant plan/PlanVersion writes including onboarding rollback.
  Atomic onboarding is exposed only through an explicit schema opt-in; pending
  PlanVersion acceptance now uses a compare-and-set guard, and active-version
  selection consistently puts legacy null validity dates last.
  Opt-in SubscriptionBundle booking counts let the shared subscription adapter
  preserve BundleVersion editability without requiring the junction table.
  Active subscription counts now derive their authoritative plan identity from
  PlanVersion and Plan, stay scoped to the requested project, and ignore drifted
  denormalized Subscription plan values. The configured
  `tenantSubscription.delegate` is now honored by every subscription ORM
  operation, including transactional reads; locked reads retain the canonical
  physical `subscriptions` table contract.

    Extend the executable persistence contract with semantic identity,
    plan-binding, validity-window, auto-succession, and transactional promo
    redemption rollback scenarios. Catalog lifecycle scenarios now take their
    project identity from the required contract `projectKey` option.

    Run the optional contract freeze after every successful onboarding plan
    change, regardless of whether the adapter uses atomic onboarding or the
    legacy sequential fallback.

### Patch Changes

- Updated dependencies [05729ce]
    - @saasicat/types@0.7.0

## 0.6.0

### Minor Changes

- 98274fe: Ship the catalog-plane Prisma repositories so a consumer can wire the full
  SuperAdmin surface without hand-writing adapters.

    `@saasicat/adapter-prisma` previously covered only the core/entitlement/promo
    slices; every app that wanted the plans/bundles/discovery-review/
    marketing pages had to implement ~2000 lines of catalog repositories itself. The
    package now exports them:

    - `PrismaPlanRepository` (`PlanRepository`)
    - `PrismaBundleRepository` (`BundleRepository`)
    - `PrismaCatalogEntryRepository` (`CatalogEntryRepository`)
    - `PrismaMarketingProjectionRepository` (`MarketingProjectionRepository`)
    - `PrismaMarketingSettingsRepository` (`MarketingSettingsRepository`)
    - `PrismaPromotionRepository` (`PromotionRepository`)
    - `PrismaSubscriptionContractRepository` (`SubscriptionContractRepository`)

    Wire them into `CatalogModule.forRoot({ planRepository: { useFactory: (p) => new
PrismaPlanRepository(p), inject: [PrismaService] }, … })`. Each targets the
    canonical `@saasicat/spec` schema; the generic `PrismaModelDelegateLike<Row>`
    helper is also exported for adapters that need a narrow client view.

    Methods that depend on columns the canonical fragments do not carry
    (`PlanVersion`/`BundleVersion` validity windows, plan `terminate`) throw a
    descriptive error rather than silently misbehaving — the same fail-closed policy
    the shipped `PrismaSubscriptionRepository` already uses.

    **`@saasicat/spec`:** the `QuotaCatalogEntry` fragment (06) gained `replaces
String[]` and `successorKey String?`, aligning it with the
    `QuotaCatalogEntryRow` / `UpsertQuotaEntryData` port contract (features already
    had them) so the discovery sync can persist quota succession. The generated
    `sql/reference-schema.postgres.sql` is regenerated to match.

- 0c08fc3: Remove the BusinessType catalog concept across the public contracts, NestJS
  modules, persistence adapters, UI, OpenAPI specification, and canonical database
  schema. Subscriptions now always reference a plan version; bundles remain the
  only composable catalog add-on.

### Patch Changes

- Updated dependencies [0c08fc3]
    - @saasicat/types@0.6.0

## 0.5.0

### Patch Changes

- @saasicat/types@0.5.0

## 0.4.0

### Patch Changes

- @saasicat/types@0.4.0

## 0.3.0

### Minor Changes

- d758318: PostgreSQL-first, ORM-agnostic persistence: ship the complete Prisma golden path and make its semantics verifiable.

    - **`@saasicat/adapter-prisma`** (renamed from `@saasicat/prisma`, which is now deprecated): ships every previously missing adapter — `PrismaTransactionRunner`, `PrismaSubscriptionRepository` (row-locked `findByTenantIdLocked`), `PrismaPlanVersionRepository`, the three promo repositories with atomic `claimSlot`/`releaseSlot`/`markExhaustedIfFull`, `PrismaAuditAdapter` (now targeting the canonical `audit_logs` table incl. `actorTag`), `PrismaAuditQueryAdapter`, `PrismaAuditStatsAdapter`, `PrismaSuperAdminBootstrapAdapter`, `PrismaPlanCatalogReadSink`/`ImportSink` — plus the new `prismaPersistence({ client })` bundle factory.
    - **`@saasicat/types`**: new persistence bundle contract — `SaasicatPersistenceAdapter` with core/entitlement/promo slices, `PersistenceCapabilities` + `assertPersistenceCapabilities` (fail-fast `PersistenceCapabilityError`), `PersistenceProvider<T>`; `PasswordHasher` moved here from `@saasicat/nest/registration` (re-exported there).
    - **`@saasicat/nest`**: `SaasPlatformModule.forRoot({ persistence })` consumes adapter bundles (individual `adapters` entries still override field by field) and refuses to boot entitlement without transactions + pessimistic locking.
    - **`@saasicat/persistence-testing`** (new): the executable persistence contract — one node:test suite every adapter must pass against a real database (row-lock serialization, transaction rollback, exactly-once promo claims, unique redemption guard, tenant isolation, audit/MFA roundtrips). CI runs it for adapter-prisma against PostgreSQL 16.
    - **`@saasicat/spec`**: the data model is now normatively anchored in `docs/data-model.md` + `sql/constraints.postgres.sql`, with `sql/reference-schema.postgres.sql` generated from the prisma-fragments (drift-guarded in CI). Fragment fixes: `AuditLog.actorTag` column, new fragment `10-super-admin.prisma`, `FeatureCatalogEntry.core/requires/replaces/successorKey`, missing `BusinessTypeVersion↔Subscription` opposite relation.

### Patch Changes

- Updated dependencies [d758318]
    - @saasicat/types@0.3.0

## 0.2.1

### Patch Changes

- @saasicat/types@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [c94b1fe]
    - @saasicat/types@0.2.0
