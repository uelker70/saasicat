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

| Class | Implements port | Tables |
| --- | --- | --- |
| `PrismaTransactionRunner` | `TransactionRunner` | — (`$transaction`) |
| `PrismaMfaAdapter` | `MfaPort` | `super_admin_mfa` |
| `PrismaAuditAdapter` | `AuditPort` | `audit_logs` |
| `PrismaAuditQueryAdapter` | `AuditQueryPort` | `audit_logs` |
| `PrismaAuditStatsAdapter` | `AuditStatsPort` | `audit_logs` |
| `AsyncLocalRlsBypassAdapter` | `RlsBypassPort` | (no DB access) |
| `PrismaSubscriptionRepository` | `SubscriptionRepository` | `subscriptions`, `plan_versions` |
| `PrismaPlanVersionRepository` | `PlanVersionRepository` | `plan_versions` |
| `PrismaPromoCodeRepository` | `PromoCodeRepository` | `promo_codes` |
| `PrismaPromoCodeRedemptionRepository` | `PromoCodeRedemptionRepository` | `promo_code_redemptions` |
| `PrismaPromoCodeValidationLogRepository` | `PromoCodeValidationLogRepository` | `promo_code_validation_logs` |
| `PrismaPromoSubscriptionLookup` | `PromoSubscriptionLookup` | `subscriptions` |
| `ZeroPromoRevenueDeductionAggregator` | `PromoRevenueDeductionAggregator` | — (constant `'0.00'`) |
| `PrismaSuperAdminBootstrapAdapter` | `SuperAdminProvisioningPort` | `super_admin_users` |
| `PrismaPlanCatalogReadSink` | `PlanCatalogReadSink` | `plans`, `plan_versions`, `feature_catalog_entries` |
| `PrismaPlanCatalogImportSink` | `PlanCatalogImportSink` | same |

Not shipped (custom adapters stay yours): subscription contracts, bundle
bookings, registration, tenant-billing write ports, `FirstTimeCustomerCheck`.
Absent optional repository methods degrade fail-closed as documented on the
ports (e.g. `countByBundleVersionId`).

Known limitation: subscriptions binding ONLY a `businessTypeVersionId` (no
`planVersionId`) raise a descriptive error — BusinessType aggregation needs a
custom `SubscriptionRepository`.

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
rely on real PostgreSQL semantics. If your schema differs: write your own
adapters — the platform ports stay identical.

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
