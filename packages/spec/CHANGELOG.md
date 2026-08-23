# @saasicat/spec

## 1.0.0-rc.2

## 1.0.0-rc.1

## 1.0.0-rc.0

### Patch Changes

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

## 0.26.1

## 0.26.0

## 0.25.0

## 0.24.2

## 0.24.1

## 0.24.0

## 0.23.0

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

## 0.10.1

## 0.10.0

## 0.9.0

## 0.8.0

### Minor Changes

- 1003a52: Remove the obsolete `PlanVersionsPage`, its standard navigation manifest key,
  and the synthetic client-side catalog snapshot projection. Plan lifecycle and
  per-plan version history remain in `PlansPage`; `MarketingCatalogPage` remains
  the separate marketing projection.

    Retain the reusable catalog timeline and diff components behind a presentation
    contract that can consume immutable Publication Archive / Catalog History
    snapshots from issues #30 and #35.

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

## 0.6.0

### Minor Changes

- 0c08fc3: Remove the BusinessType catalog concept across the public contracts, NestJS
  modules, persistence adapters, UI, OpenAPI specification, and canonical database
  schema. Subscriptions now always reference a plan version; bundles remain the
  only composable catalog add-on.

### Patch Changes

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

## 0.5.0

## 0.4.0

## 0.3.0

### Minor Changes

- d758318: PostgreSQL-first, ORM-agnostic persistence: ship the complete Prisma golden path and make its semantics verifiable.

    - **`@saasicat/adapter-prisma`** (renamed from `@saasicat/prisma`, which is now deprecated): ships every previously missing adapter — `PrismaTransactionRunner`, `PrismaSubscriptionRepository` (row-locked `findByTenantIdLocked`), `PrismaPlanVersionRepository`, the three promo repositories with atomic `claimSlot`/`releaseSlot`/`markExhaustedIfFull`, `PrismaAuditAdapter` (now targeting the canonical `audit_logs` table incl. `actorTag`), `PrismaAuditQueryAdapter`, `PrismaAuditStatsAdapter`, `PrismaSuperAdminBootstrapAdapter`, `PrismaPlanCatalogReadSink`/`ImportSink` — plus the new `prismaPersistence({ client })` bundle factory.
    - **`@saasicat/types`**: new persistence bundle contract — `SaasicatPersistenceAdapter` with core/entitlement/promo slices, `PersistenceCapabilities` + `assertPersistenceCapabilities` (fail-fast `PersistenceCapabilityError`), `PersistenceProvider<T>`; `PasswordHasher` moved here from `@saasicat/nest/registration` (re-exported there).
    - **`@saasicat/nest`**: `SaasPlatformModule.forRoot({ persistence })` consumes adapter bundles (individual `adapters` entries still override field by field) and refuses to boot entitlement without transactions + pessimistic locking.
    - **`@saasicat/persistence-testing`** (new): the executable persistence contract — one node:test suite every adapter must pass against a real database (row-lock serialization, transaction rollback, exactly-once promo claims, unique redemption guard, tenant isolation, audit/MFA roundtrips). CI runs it for adapter-prisma against PostgreSQL 16.
    - **`@saasicat/spec`**: the data model is now normatively anchored in `docs/data-model.md` + `sql/constraints.postgres.sql`, with `sql/reference-schema.postgres.sql` generated from the prisma-fragments (drift-guarded in CI). Fragment fixes: `AuditLog.actorTag` column, new fragment `10-super-admin.prisma`, `FeatureCatalogEntry.core/requires/replaces/successorKey`, missing `BusinessTypeVersion↔Subscription` opposite relation.

## 0.2.1

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

- db10ab9: Fix scaffolded projects pinning a platform version that never gets published.

    `templates/package.json.tpl` hardcoded `@saasicat/types` and `@saasicat/ui-vue` at `^0.1.0`. Because caret pins the minor for `0.x` versions, `^0.1.0` resolves to `>=0.1.0 <0.2.0` and would not match the published `0.2.0` — every scaffolded project would fail to install. The template now uses a `__PLATFORM_VERSION__` token that the scaffolder fills from its own `package.json` version, so the pin tracks each lockstep release automatically.

    Also: ship `cli-conventions.md` in `@saasicat/spec` (the `@saasicat/cli` README links to it), point package README links at absolute GitHub URLs so they resolve on npm, and translate the scaffolder's CLI output to English.
