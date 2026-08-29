# @saasicat/persistence-testing

## 1.0.0-rc.8

### Patch Changes

- Updated dependencies [1e9b842]
    - @saasicat/core@1.0.0-rc.8

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

### Minor Changes

- 9b5ca2f: Close the last gaps in `@saasicat/adapter-drizzle`: it now serves the plan
  catalogue, the tenant's own subscription writes, and subscription contracts, so
  the persistence contract runs against it with no scenario skipped.

    `drizzlePersistence()` now returns the `catalog` and `tenantBilling` slices, so
    `SaaSiCatModule.forRoot` can discover the plan catalogue, the tenant's billing
    page and the writes behind its buttons without a consumer wiring any of it by
    hand. Four classes are new: `DrizzlePlanRepository`,
    `DrizzleTenantSubscriptionWrite`, `DrizzleSubscriptionContractRepository` and
    `DrizzleSubscriptionUsageAdapter`. The `subscriptions` query map was also
    missing nineteen canonical columns, including `currentPeriodEnd`,
    `billingAnchorDay`, `minimumTermUntil` and `trialEndsAt`; a new derived test
    compares every `pgTable` against the reference schema and fails on an omitted or
    invented column.

    The persistence contract's contract-lifecycle scenario was a placeholder that
    failed if an adapter provided the repository at all. It is now two real
    scenarios — what a contract stores and what ending one does, and how a successor
    takes over — and both adapters plus the in-memory reference implementation pass
    them.

    `@saasicat/core` gains the pieces both adapters were spelling out separately:
    `toPlanRow`, `toPlanVersionRow`, `toSubscriptionContractRecord` and
    `toContractLineItemRecord` map canonical rows to records in one place,
    `previousUtcDay` and `ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES` are the window and
    status rules the adapters share, and
    `CancelSubscriptionInput`/`CancelSubscriptionResult` name a shape that was
    written out three times. `cancelSubscription` keeps the same structural
    signature.

    Two read-then-write windows in the tenant's own writes are closed in **both**
    adapters: an ordinary cancellation no longer restates the status it read a
    moment earlier — a trial going live in between came back as `TRIAL`,
    entitlements and all — and an immediate plan change now locks the row its
    decisions come from.

    One reading changes as a consequence: a `publishedChanges` column holding
    something other than an array now reads as `null` in the plan-catalogue
    projections rather than being cast, which is what the other mappers already did.

### Patch Changes

- Updated dependencies [d492281]
- Updated dependencies [89eed2b]
- Updated dependencies [9b5ca2f]
    - @saasicat/core@1.0.0-rc.7

## 1.0.0-rc.6

### Patch Changes

- Updated dependencies [a56af36]
    - @saasicat/core@1.0.0-rc.6

## 1.0.0-rc.5

### Patch Changes

- @saasicat/core@1.0.0-rc.5

## 1.0.0-rc.4

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
    - @saasicat/core@1.0.0-rc.4

## 1.0.0-rc.3

### Patch Changes

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

### Patch Changes

- Updated dependencies [9449492]
    - @saasicat/types@1.0.0-rc.0

## 0.27.0

### Minor Changes

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
