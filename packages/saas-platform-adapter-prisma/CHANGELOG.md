# @saasicat/adapter-prisma

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
