# @saasicat/nest

## 0.12.1

### Patch Changes

- @saasicat/spec@0.12.1
- @saasicat/types@0.12.1

## 0.12.0

### Patch Changes

- @saasicat/spec@0.12.0
- @saasicat/types@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [bded377]
    - @saasicat/spec@0.11.0
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
    - @saasicat/spec@0.10.1
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

- @saasicat/spec@0.10.0
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
    - @saasicat/spec@0.9.0

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
    - @saasicat/spec@0.8.0
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
    - @saasicat/spec@0.7.0
    - @saasicat/types@0.7.0

## 0.6.0

### Minor Changes

- 0c08fc3: Remove the BusinessType catalog concept across the public contracts, NestJS
  modules, persistence adapters, UI, OpenAPI specification, and canonical database
  schema. Subscriptions now always reference a plan version; bundles remain the
  only composable catalog add-on.

### Patch Changes

- Updated dependencies [98274fe]
- Updated dependencies [0c08fc3]
    - @saasicat/spec@0.6.0
    - @saasicat/types@0.6.0

## 0.5.0

### Patch Changes

- @saasicat/spec@0.5.0
- @saasicat/types@0.5.0

## 0.4.0

### Patch Changes

- 5802454: Three wiring bugs surfaced by booting the new `examples/notesapp` reference app (the existing tests only inspected `forRoot()` results without compiling them — a Nest DI boot-smoke test now guards this):

    - `SaasPlatformModule` no longer re-exports `ADMIN_MANIFEST_CONFIG` directly — exporting an imported module's token is an `UnknownExportException` at boot; the token still travels via the exported `AdminManifestModule`.
    - `LimitExceededFilter` now matches by the realm-safe `isLimitExceededError` guard (new export) and falls back to Nest's default handling via `BaseExceptionFilter`. The previous `@Catch(LimitExceededError)` never matched throws from other sub-bundles (tsup duplicates the class per entry), turning quota hits from `@EnforceQuota` into HTTP 500 instead of 402. Register it as an `APP_FILTER` provider.
    - `@saasicat/nest/testing` re-exports `StaticEntitlementService`, `StaticFeatureGuard`, `EnforceQuotaInterceptor` and the plan-resolver token: `moduleRef.get(X)` after `createSaasPlatformTestModule` only resolves when X comes from the same bundle entry.

    Docs: quickstart corrected (`policy: 'hardCap'` — `'hard'` never existed; quota responses are HTTP 402, not 429; auth guards must be registered globally BEFORE the platform module so `request.user` is populated for the feature guard/quota interceptor).
    - @saasicat/spec@0.4.0
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
    - @saasicat/spec@0.3.0

## 0.2.1

### Patch Changes

- @saasicat/spec@0.2.1
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

- Updated dependencies [db10ab9]
- Updated dependencies [c94b1fe]
    - @saasicat/spec@0.2.0
    - @saasicat/types@0.2.0
