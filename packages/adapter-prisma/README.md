# @saasicat/adapter-prisma

## What this is

The Prisma + PostgreSQL persistence adapter for SaaSiCat. Targets the
canonical schema from `@saasicat/spec` (`prisma-fragments/` +
`sql/constraints.postgres.sql`) and passes the executable persistence
contract (`@saasicat/persistence-testing`) against a real PostgreSQL — locks,
transaction rollback and atomic promo claims are verified, not asserted.

> Renamed from `@saasicat/prisma` (deprecated). Same ports, superset of the
> old exports.

## What this is not

Not a Prisma schema. It targets the canonical tables from `@saasicat/spec`;
`saasicat schema apply` puts them into your `schema.prisma`, and Prisma
migrates them. This package reads and writes them.

Not a place for domain rules. An adapter translates a port to a store — which
rows, which order, which lock — and every decision above that lives in
`@saasicat/nest`, so the two adapters stay interchangeable.

## Quickstart — the bundle

```ts
import { prismaPersistence } from '@saasicat/adapter-prisma';
import { aesGcmSecretSealer } from '@saasicat/nest/platform';
import { PrismaService } from './prisma/prisma.service';

SaaSiCatModule.forRoot({
    planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
    controller: { guards: [JwtAuthGuard] },
    imports: [AuthModule],
    persistence: prismaPersistence({ client: PrismaService }),
    // Not the bundle's to supply: the key that seals the SuperAdmin's second factor.
    adapters: { secretSealer: aesGcmSecretSealer(process.env.SECRET_SEALER_KEY) },
    entitlement: {},
});
```

`prismaPersistence({ client })` accepts your `PrismaService` class token (or
a ready `PrismaLike` instance in tests) and returns a
`SaaSiCatPersistenceAdapter` bundle: declared capabilities + provider specs
for every shipped port. `SaaSiCatModule.forRoot` validates the
capabilities fail-fast (entitlement requires transactions + row locks) and
wires the slices; individual `adapters` entries still override field by field.

Options:

- `passwordHasher` — your `PasswordHasher` (token or instance). Enables
  `core.superAdminProvisioning` (setup wizard / `user create-super-admin`).
- `rlsIntegration: true` — lift your row policies for what the platform does
  across tenants (see [RLS bypass](#rls-bypass)).
- `schema` — explicit plan identity, delegate and optional-field capabilities
  for schemas that differ from the 0.6 canonical layout.
- `notAdopted` — the canonical models your schema leaves out, as
  `saasicat schema check` prints them (it hands over the list it can use). The
  bundle leaves out what needs them, and a model it cannot do without is
  refused with the ones it can. Leaving out `SuperAdminMfa` means passing your
  own `MfaPort` in `adapters`; a start without one is refused. A ready client
  passed as `client` needs no delegate of a model named here.
- `transactions` — `maxConcurrent`, the most platform transactions open at
  once, and Prisma's `timeout` and `maxWait` for each. Unset, nothing is
  bounded and Prisma's defaults apply; see
  [Transactions under load](#transactions-under-load).

The bundle also ships `planCatalogReadSink` for DB hydration. To use it,
omit `planCatalog` and name the file the settings come from:
`SaaSiCatModule.forRoot({ persistence, dbCatalog: { path: 'config/saas.yaml' } })`
— without `dbCatalog` the module refuses to boot, because branding, currency,
VAT and the commercial settings cannot come from the database.

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
| `PrismaPromoCodeHoldRepository`          | `PromoCodeHoldRepository`          | `promo_code_holds`, `promo_codes`                                   |
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
| `PrismaSubscriberLedgerRepository`       | `SubscriberLedgerRepository`       | `subscriber_ledger_entries`                                         |
| `PrismaAppliedSettingsRepository`        | `AppliedSettingsPort`              | `applied_settings`, `settings_changes`                              |
| `PrismaMaintenanceWindowRepository`      | `MaintenanceWindowPort`            | `maintenance_windows`                                               |
| `PrismaSubscriptionNoticeRepository`     | `SubscriptionNoticeRepository`     | `subscription_notices`                                              |

`PrismaMfaAdapter` stores the secret it is handed. The platform seals it first with the
`SecretSealer` bound in `adapters`, which this bundle does not supply: the key belongs to the
installation, not to the database.

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

## Transactions under load

The platform's transactions take row locks and then read further, and each
holds a pooled connection for its whole life. Opened for every request at
once, they can end up holding every connection while waiting for a lock or for
a read that needs one — and the service stalls until Prisma's `timeout` aborts
them with `P2028`. `maxConcurrent` keeps some connections free: transactions
beyond it wait in arrival order before they open, and that wait does not count
against `timeout`.

```ts
prismaPersistence({
    client: PrismaService,
    // A pool of 20 connections (`connection_limit` in the database URL).
    transactions: { maxConcurrent: 15, timeout: 30_000, maxWait: 10_000 },
});
```

Your pool size minus five is a sound start; too low a value queues work that
could have run side by side. `timeout` bounds what runs inside a transaction,
including the wait for a row lock, so a burst at a quota limit wants more than
Prisma's five seconds.

What is counted is what runs through `transactionRunner`. A repository called
without a transaction opens its own for that one call; it works on its own
handle only, so it cannot hold a connection while waiting for another, and it
is not counted. A transaction opened inside another — `run` called again rather
than `tx` passed on — needs a second place, and with every place taken waits
for the one its caller holds; pass `tx` on.

The bound belongs to the pool, not to a runner: every runner on one client
shares it, however many modules Nest builds one for, and a second, different
bound for the same client is refused. A transaction waits for its place as long
as it takes — the wait has no deadline, so a sustained overload queues rather
than fails; leave the bound headroom against your request timeouts. Wired by
hand, provide the options beside the runner:

```ts
{ provide: PRISMA_TRANSACTION_OPTIONS_TOKEN, useValue: { maxConcurrent: 15 } },
PrismaTransactionRunner,
```

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
semantic `planKey`, and both catalog and entitlement reads use the `planVersion`
delegate. Every plan-version model carries `validFrom`, `validUntil` and
`endsAt`, as the canonical schema does: they decide which version is on sale,
for a catalogue, a price and a booking alike. There is no schema
auto-detection.

An app with a normalized UUID foreign key opts in explicitly. Port inputs and
outputs still use the semantic key:

```ts
const schema = {
    planBinding: { mode: 'normalized-plan-id' },
    tenantSubscription: {
        subscriptionBundleDelegate: 'subscriptionBundle',
        synchronizePlanVersion: true,
        atomicOnboardingSelection: true,
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
keeps, for example, `catalogPlanVersion` separate from a billing `planVersion`;
both carry the date columns:

```ts
const schema = {
    delegates: {
        catalogPlanVersion: 'catalogPlanVersion',
        entitlementPlanVersion: 'planVersion',
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
and optional promo callback share one Prisma transaction.

Immediate changes and onboarding bind the subscription to the version they
sell: they resolve the target plan's live PlanVersion and update `plan`,
`planVersionId` and cycle together. That is what
the entitlements read and what a contract freeze records, and it is the
default. It needs a schema that carries it — a `planVersionId` column on the
subscription model, the plan-version model (`schema.delegates.entitlementPlanVersion`,
`planVersion` unless mapped) and a published, live version for every plan a
tenant can change to. The adapter resolves the plan-version model when it is
constructed, so a schema without one stops the start rather than the first
plan change; a subscription model without the column cannot be seen from the
client, and the first plan change that tries to write it says which option to
set.

`tenantSubscription.synchronizePlanVersion: false` opts out and writes `plan`
and cycle alone, for a schema whose `planVersionId` is kept some other way. The
adapter then declares `bindsPlanVersion: false`, and a contract freeze refuses
to start beside it — a contract records the version a subscription is bound
to, and nothing would bind it.

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

`PrismaBundleRepository` writes and reads `bundle_versions.validFrom` and
`validUntil`, as the canonical schema carries them: they decide which add-on
version is on sale, as they do for plans. Publishing sets the predecessor's
`validUntil` to one UTC calendar day before the successor starts, and wraps
supersede + publish in a transaction when the caller did not already provide
one. `BundleRepository.findActiveBundleVersion(bundleId, asOf?)` answers the
version on sale, using inclusive UTC-day boundaries and preferring the highest
`validFrom`, then `version`; a version superseded without a last day is not on
sale.

## RLS bypass

An operator's lists, the nightly sweeps and the platform's boot checks work
across tenants. Under a row policy that filters on the tenant they see nothing
of the others — an empty list, a count of 0, an update of no row — unless the
policy is lifted for them. `rlsIntegration: true` does that for every statement
the bundle's adapters run inside the platform's `runWithBypass`: a read, a
write, a raw statement, a batch, and an interactive transaction the platform's
runner or one of its repositories opens.

```ts
prismaPersistence({ client: PrismaService, rlsIntegration: true });
```

PostgreSQL has no per-statement switch for this. `SET row_security = off`
makes a query the policy would filter fail rather than see more, and a role
with `BYPASSRLS` skips every policy for every statement it runs. What the
bundle does instead is set `app.bypass_rls` to `'true'` for one transaction —
the statement's own, a batch's, or an interactive transaction's opened inside
the bypass — and your policy accepts that setting beside the tenant:

```sql
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_rows ON subscriptions
    USING ("tenantId" = current_setting('app.tenant_id', true)
           OR current_setting('app.bypass_rls', true) = 'true')
    WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)
           OR current_setting('app.bypass_rls', true) = 'true');
```

- **The application connects as a role the policy applies to**: not a
  superuser, not a role with `BYPASSRLS`. The table owner is subject to it
  only with `FORCE ROW LEVEL SECURITY`.
- **`app.tenant_id` is yours.** Setting it for a tenant's request is your
  application's tenant scoping; the bundle sets only the bypass.
- **A transaction opened outside the bypass cannot enter it.** The setting
  would outlast the bypass for the rest of that transaction, so a statement of
  it that tries is refused with an error saying so. Open the transaction inside
  `runWithBypass`; the platform's own code does. A statement on the client
  itself, sent from inside a transaction's callback, runs on another connection
  and is lifted on its own either way.
- **Where a statement runs is Prisma's to say.** It hands every query extension
  the transaction a statement belongs to, outside its public types; Prisma 6,
  which the suites here run against, does. A client that does not say is
  refused inside the bypass rather than guessed at, since a wrong guess breaks
  either the lifting or the transaction.
- **Another setting name**: `rlsIntegration: new PrismaRlsBypass('app.other')`.
- **Statements of your own** inside the platform's bypass — a job of yours
  that injects `RLS_BYPASS_PORT_TOKEN` — go through the same instance: build
  one, pass it as `rlsIntegration`, and run them on `bypass.extend(prisma)`.
  Batch and open transactions for them on that client too: a batch or a
  transaction opened on another client carries no setting, and a lifted
  statement in it is refused.

An installation that keeps a bypass of its own, over its own tenant context,
binds its `RlsBypassPort` in `adapters` and leaves `rlsIntegration` out.
Without row policies, leave it out too: the bundle's port then runs the work
as it is.

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
recreates its `public` schema.** The RLS suite beside it creates the database
`<name>_rls` and the role `saasicat_rls_probe`, puts the policy above on a
table and runs the bundle as that role.

## Next

- [Quickstart](../../docs/quickstart.md) — from an existing backend to an enforced feature
- [Data model](../../docs/explanation/data-model.md) — the canonical tables, and who owns which
- [Ports and adapters](../../docs/explanation/adr/0007-ports-and-adapters.md) — why an adapter never
  decides
