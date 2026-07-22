# @saasicat/nest

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
