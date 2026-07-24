# @saasicat/adapter-prisma

The Prisma + PostgreSQL persistence adapter for SaaSiCat. Targets the
canonical schema from `@saasicat/spec` (`prisma-fragments/` +
`sql/constraints.postgres.sql`) and passes the executable persistence
contract (`@saasicat/persistence-testing`) against a real PostgreSQL — locks,
transaction rollback and atomic promo claims are verified, not asserted.

> Renamed from `@saasicat/prisma` (deprecated). Same ports, superset of the
> old exports.

## Quickstart — the bundle

```ts
import { prismaPersistence } from '@saasicat/adapter-prisma';
import { PrismaService } from './prisma/prisma.service';

SaasPlatformModule.forRoot({
    planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
    controller: { guards: [JwtAuthGuard] },
    imports: [AuthModule],
    persistence: prismaPersistence({ client: PrismaService }),
    entitlement: {},
});
```

`prismaPersistence({ client })` accepts your `PrismaService` class token (or
a ready `PrismaLike` instance in tests) and returns a
`SaasicatPersistenceAdapter` bundle: declared capabilities + provider specs
for every shipped port. `SaasPlatformModule.forRoot` validates the
capabilities fail-fast (entitlement requires transactions + row locks) and
wires the slices; individual `adapters` entries still override field by field.

Options:

- `passwordHasher` — your `PasswordHasher` (token or instance). Enables
  `core.superAdminProvisioning` (setup wizard / `user create-super-admin`).
- `rlsIntegration: true` — declare the `rowLevelSecurity` capability once
  your Prisma middleware really applies the bypass (see below).
- `schema` — explicit plan identity, delegate and optional-field capabilities
  for schemas that differ from the 0.6 canonical layout.

The bundle also ships `planCatalogReadSink` for DB hydration. To use it,
omit `planCatalog` and pass the identity the database cannot provide:
`SaasPlatformModule.forRoot({ persistence, dbCatalog: { projectKey,
currency, vatRate } })` — without `dbCatalog` the module refuses to boot
(the sink would otherwise load an empty catalog for project key `''`).

Slices the mega module does not wire (promo) spread into the domain module:

```ts
PromoCodesModule.forRoot({
    ...prismaPersistence({ client: PrismaService }).promo,
    transactionRunner: bundle.core.transactionRunner,
    firstTimeCustomerCheck: MyFirstTimeCustomerCheck, // app semantics — always yours
});
```

## Shipped adapters

| Class                                    | Implements port                    | Tables                                                              |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `PrismaTransactionRunner`                | `TransactionRunner`                | — (`$transaction`)                                                  |
| `PrismaMfaAdapter`                       | `MfaPort`                          | `super_admin_mfa`                                                   |
| `PrismaAuditAdapter`                     | `AuditPort`                        | `audit_logs`                                                        |
| `PrismaAuditQueryAdapter`                | `AuditQueryPort`                   | `audit_logs`                                                        |
| `PrismaAuditStatsAdapter`                | `AuditStatsPort`                   | `audit_logs`                                                        |
| `AsyncLocalRlsBypassAdapter`             | `RlsBypassPort`                    | (no DB access)                                                      |
| `PrismaSubscriptionRepository`           | `SubscriptionRepository`           | `subscriptions`, `plan_versions`, optionally `subscription_bundles` |
| `PrismaSubscriptionBundleRepository`     | `SubscriptionBundleRepository`     | `subscription_bundles`                                              |
| `PrismaTenantSubscriptionWriteAdapter`   | `TenantSubscriptionWritePort`      | `subscriptions`, `plans`, `plan_versions`                           |
| `PrismaPlanVersionRepository`            | `PlanVersionRepository`            | `plan_versions`                                                     |
| `PrismaPromoCodeRepository`              | `PromoCodeRepository`              | `promo_codes`                                                       |
| `PrismaPromoCodeRedemptionRepository`    | `PromoCodeRedemptionRepository`    | `promo_code_redemptions`                                            |
| `PrismaPromoCodeValidationLogRepository` | `PromoCodeValidationLogRepository` | `promo_code_validation_logs`                                        |
| `PrismaPromoSubscriptionLookup`          | `PromoSubscriptionLookup`          | `subscriptions`                                                     |
| `ZeroPromoRevenueDeductionAggregator`    | `PromoRevenueDeductionAggregator`  | — (constant `'0.00'`)                                               |
| `PrismaSuperAdminBootstrapAdapter`       | `SuperAdminProvisioningPort`       | `super_admin_users`                                                 |
| `PrismaPlanCatalogReadSink`              | `PlanCatalogReadSink`              | `plans`, `plan_versions`, `feature_catalog_entries`                 |
| `PrismaPlanCatalogImportSink`            | `PlanCatalogImportSink`            | same                                                                |
| `PrismaPlanRepository`                   | `PlanRepository`                   | `plans`, `plan_versions`                                            |
| `PrismaBundleRepository`                 | `BundleRepository`                 | `bundles`, `bundle_versions`                                        |
| `PrismaCatalogEntryRepository`           | `CatalogEntryRepository`           | capability, feature and quota catalog tables                        |
| `PrismaMarketingProjectionRepository`    | `MarketingProjectionRepository`    | `marketing_projections`                                             |
| `PrismaMarketingSettingsRepository`      | `MarketingSettingsRepository`      | `marketing_settings`                                                |
| `PrismaPromotionRepository`              | `PromotionRepository`              | `promotions`                                                        |
| `PrismaSubscriptionContractRepository`   | `SubscriptionContractRepository`   | `subscription_contracts`, `contract_line_items`                     |

Not shipped (custom adapters stay yours): registration persistence,
consumer-specific payment/invoice integrations, and `FirstTimeCustomerCheck`.
Absent optional repository methods degrade fail-closed as documented on the
ports (e.g. `countByBundleVersionId`).

## Manual wiring (custom setups)

All classes inject the Prisma client via `PRISMA_CLIENT_TOKEN`:

```ts
providers: [
    { provide: PRISMA_CLIENT_TOKEN, useExisting: PrismaService },
    { provide: PASSWORD_HASHER_TOKEN, useExisting: Argon2Hasher }, // bootstrap only
    PrismaMfaAdapter,
    // ...
];
```

`PrismaLike`/`PrismaTxLike` are structural sub-interfaces — the package
builds without `prisma generate`, and any client generated from the
canonical schema satisfies them.

## Schema assumptions

The canonical schema: copy the models from
`@saasicat/spec/prisma-fragments/` (or apply
`@saasicat/spec/sql/reference-schema.postgres.sql`) **plus**
`sql/constraints.postgres.sql` — the partial unique indexes and the
subscription CHECK are part of the contract, `claimSlot`/`findByTenantIdLocked`
rely on real PostgreSQL semantics. Use the explicit schema options below for
supported differences; for other shapes, override only the affected adapter —
the platform ports stay identical.

### Plan identity and split PlanVersion delegates

The default is the SaaSiCat 0.6 layout: `PlanVersion.planId` stores the
semantic `planKey`, both catalog and entitlement reads use the `planVersion`
delegate, and optional validity columns are not queried. There is no schema
auto-detection.

An app with a normalized UUID foreign key opts in explicitly. Port inputs and
outputs still use the semantic key:

```ts
const schema = {
    planBinding: {
        mode: 'normalized-plan-id',
        projectKey: 'vereinsfux',
    },
    planVersionFields: {
        validityWindows: true,
        endsAt: true,
    },
    tenantSubscription: {
        subscriptionBundleDelegate: 'subscriptionBundle',
        synchronizePlanVersion: true,
        atomicOnboardingSelection: true,
        activeVersionSelection: 'validity-window',
        withEndsAt: true,
    },
} satisfies PrismaSchemaOptions;

const persistence = prismaPersistence({ client: PrismaService, schema });
const plans = new PrismaPlanRepository(prisma, schema);
const subscriptionWrites = new PrismaTenantSubscriptionWriteAdapter(prisma, schema);
```

For direct Nest registration, bind the same object once:

```ts
providers: [
    { provide: PRISMA_CLIENT_TOKEN, useExisting: PrismaService },
    { provide: PRISMA_SCHEMA_OPTIONS_TOKEN, useValue: schema },
    PrismaPlanRepository,
    PrismaPlanVersionRepository,
    PrismaTenantSubscriptionWriteAdapter,
];
```

Split schemas can name catalog and entitlement delegates independently. This
keeps, for example, `catalogPlanVersion` with validity columns separate from a
legacy billing `planVersion`:

```ts
const schema = {
    delegates: {
        catalogPlanVersion: 'catalogPlanVersion',
        entitlementPlanVersion: 'planVersion',
    },
    planVersionFields: {
        catalog: { validityWindows: true },
        entitlement: { validityWindows: false },
    },
} satisfies PrismaSchemaOptions;
```

Delegate selection is field-level and backwards-compatible; an app whose
billing version stores fixed quota columns instead of JSON can continue to
override only the entitlement repository.

### Atomic tenant plan binding

`PrismaTenantSubscriptionWriteAdapter` exposes the optional
`applyOnboardingSelection` capability only when
`tenantSubscription.atomicOnboardingSelection: true`. The default is `false`,
preserving the 0.6 sequential fallback. When enabled, the subscription update
and optional promo callback share one Prisma transaction. With
`tenantSubscription.synchronizePlanVersion: true`, immediate changes and
onboarding also resolve the target PlanVersion and update `plan`,
`planVersionId`, cycle and stale pending-version fields atomically. The default
is `false`, preserving the 0.6 plan-only write until an app opts in.

`tenantSubscription.delegate` selects the Prisma model delegate used for all
subscription ORM operations, including the read that follows a row lock.
`findByTenantIdLocked` deliberately locks the canonical physical
`subscriptions` table with raw SQL, so a differently named Prisma model must
map to that table via `@@map("subscriptions")`.

When `tenantSubscription.subscriptionBundleDelegate` names the app's
SubscriptionBundle delegate, `PrismaSubscriptionRepository` also exposes
`countByBundleVersionId`. This keeps published-but-future BundleVersion
editability aligned with real active bookings. Without the option the method
is absent and the catalog service remains fail-closed.

### Bundle validity windows

`PrismaBundleRepository` keeps its 0.6-compatible behavior by default and does
not require `bundle_versions.validFrom` / `validUntil`. After applying the
additive columns from the current `@saasicat/spec` bundle fragment, enable them
explicitly:

```ts
const bundles = new PrismaBundleRepository(prisma, {
    validityWindows: true,
});
```

The enabled mode persists and returns both dates. Publishing also sets the
predecessor's `validUntil` to one UTC calendar day before the successor starts,
and wraps supersede + publish in a transaction when the caller did not already
provide one. It also exposes the optional
`BundleRepository.findActiveBundleVersion(bundleId, asOf?)` capability, using
inclusive UTC-day boundaries and preferring the highest `validFrom`, then
`version`. In the default legacy mode that optional capability is `undefined`.

## RLS bypass

`AsyncLocalRlsBypassAdapter` only toggles an `AsyncLocalStorage` flag — your
`PrismaService` must apply it:

```ts
this.$use(async (params, next) => {
    if (rls.isBypassActive()) {
        await this.$executeRawUnsafe('SET LOCAL row_security = off');
    }
    return next(params);
});
```

Only then pass `rlsIntegration: true` to `prismaPersistence`.

## Tests

```bash
pnpm --filter @saasicat/adapter-prisma test              # unit (fake client)
SAASICAT_TEST_DATABASE_URL=postgresql://postgres:test@localhost:5432/postgres \
pnpm --filter @saasicat/adapter-prisma test:integration  # contract vs. real PG
```

The integration run builds its schema from the normative reference SQL,
generates a client from the composed fragments and executes the
`@saasicat/persistence-testing` contract — CI does the same against a
postgres service. **The database is disposable: the harness drops and
recreates its `public` schema.**
