---
doc_title: SaaS Platform Prisma Fragments
status: living document
related:
    - ../schemas/plan-catalog.schema.json
    - ../schemas/promo-code.schema.json
    - ../schemas/audit-event.schema.json
    - ../../types/src/subscription.types.ts
---

# Prisma Fragments

Prisma-DSL rendering of the SaaSiCat data model, **derived from the normative
sources**: the logical data model in [`docs/explanation/data-model.md`](../../../docs/explanation/data-model.md)
and the PostgreSQL artifacts in [`../sql/`](../sql/)
(`reference-schema.postgres.sql` is generated FROM these fragments via
`pnpm run gen:sql`; `constraints.postgres.sql` carries the invariants Prisma
cannot express and is hand-maintained). When fragments and data model
disagree, the data model + constraints win; the adapter contract tests
(`@saasicat/persistence-testing`) are the executable arbiter.

Consumer apps copy the models into their own `schema.prisma` and add FK
relations to their project-specific `Tenant`/`User` models.

Two guards keep the artifacts honest in CI: the fragments must compose into
one valid Prisma schema, and `reference-schema.postgres.sql` must be
regenerated after fragment changes (`tests/reference-sql-drift.test.js`).

## Files

| File                                                                 | Models                                                                       |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`01-subscription.prisma`](01-subscription.prisma)                   | `Subscription`, `CheckoutOffer` + Enums                                      |
| [`02-promo-code.prisma`](02-promo-code.prisma)                       | `PromoCode`, `PromoCodeRedemption`, `PromoCodeValidationLog` + Enums         |
| [`03-plan-versions.prisma`](03-plan-versions.prisma)                 | `Plan`, `PlanVersion`                                                        |
| [`04-audit-log.prisma`](04-audit-log.prisma)                         | `AuditLog`                                                                   |
| [`05-bundle.prisma`](05-bundle.prisma)                               | `Bundle`, `BundleVersion`                                                    |
| [`06-catalog-entries.prisma`](06-catalog-entries.prisma)             | Capability, feature, quota and marketing catalog models                      |
| [`07-promotion.prisma`](07-promotion.prisma)                         | `Promotion`                                                                  |
| [`08-subscription-contract.prisma`](08-subscription-contract.prisma) | `SubscriptionContract`, `ContractLineItem`                                   |
| [`09-pending-registration.prisma`](09-pending-registration.prisma)   | `PendingRegistration` + `RegistrationStatus`                                 |
| [`10-super-admin.prisma`](10-super-admin.prisma)                     | `SuperAdminUser`, `SuperAdminMfa`                                            |
| [`11-subscription-bundle.prisma`](11-subscription-bundle.prisma)     | `SubscriptionBundle`                                                         |
| [`12-applied-settings.prisma`](12-applied-settings.prisma)           | `AppliedSettings`, `SettingsChange`                                          |
| [`13-subscriber.prisma`](13-subscriber.prisma)                       | `Subscriber`, `SubscriberTenant`, `SubscriberCorrection`                     |
| [`14-payments.prisma`](14-payments.prisma)                           | `SubscriberPaymentMethod`, `SubscriberPaymentMethodSetup`, `PaymentEventLog` |

## How the consumer uses the fragments

Prisma does **not** support real schema merging — there is no include mechanism.
Consumers must add the models into their own `schema.prisma`. There are two
pragmatic approaches:

### Variant A — Copy-Paste (recommended)

1. Add the required models from the fragments into your own `schema.prisma`.
2. Enable the commented-out FK relations to consumer models (`Tenant`, `User`)
   and adapt them to your own model names.
3. Plan/feature keys stay as `String` — the source of truth is the set of plans
   maintained in the SuperAdmin UI (DB) and the feature/quota catalog published
   via Discovery.

### Variant B — Schema stitching via codegen

Tools such as [`prisma-import`](https://github.com/ajmnz/prisma-import) allow
include directives; they generate a merged `schema.prisma`. For today's
single-repo consumers, Variant A is simpler.

## Conventions

### 1. Keys are strings, not enums

`plan` (`Subscription.plan`, `Subscription.pendingPlan`, …) and
`featureKey` are declared as `String`. The source of truth is the plan master
records (`plans` table, maintained in the SuperAdmin UI) and the feature catalog
(`feature_catalog_entries`).

If you prefer **Postgres enums**: declare an enum locally and cast the field
via `@db.<EnumName>`. Not a platform requirement — the platform services only
read strings.

### 2. FKs to consumer models are documented but commented out

Fields such as `tenantId String` and `userId String?` remain as plain
string columns in the fragments; the corresponding `@relation` is left as a
comment. The consumer enables them using their own `Tenant`/`User` model names.

Two models deliberately carry no such pointer: `SubscriptionContract` and
`SubscriberTenant`. A contract belongs to its subscriber and outlives the tenant
it was concluded for, so its `tenantId` is a trace — a cascade from the tenant
would delete the tax record with it, and a restriction would keep the tenant
from ever being deleted.

### 3. Table names (`@@map`) are canonical

`subscriptions`, `checkout_offers`, `plans`, `plan_versions`, `promo_codes`,
`promo_code_redemptions`, `promo_code_validation_logs`, `audit_logs`, `bundles`,
`bundle_versions`, `capability_catalog_entries`, `feature_catalog_entries`,
`quota_catalog_entries`, `marketing_projections`, `marketing_settings`,
`promotions`, `subscription_contracts`, `contract_line_items`,
`super_admin_users`, `super_admin_mfa`, `subscription_bundles`, `subscribers`,
`subscriber_tenants`, `subscriber_corrections`, `subscriber_payment_methods`,
`subscriber_payment_method_setups`.
`PendingRegistration` and `PaymentEventLog` carry no `@@map` and keep Prisma's
default names, `"PendingRegistration"` and `"PaymentEventLog"`.
Please do **not change** them — otherwise platform migration scripts and the
`@saasicat/cli` commands that rely on these names will break.

### 4. Decimal precision

All monetary amounts are `Decimal(10, 2)` (max ±99,999,999.99 €), promo-code
values are `Decimal(8, 2)` (percentage or amount). Consumers should not relax
this precision.

### 5. Constraints Prisma cannot express

`PlanVersion` and `BundleVersion` allow **exactly one** draft per identity key
(`publishedAt IS NULL`). The partial indexes live as SQL in
[`../sql/constraints.postgres.sql`](../sql/constraints.postgres.sql) —
add that file to your migration verbatim. Note that column names are
**camelCase** (the fragments `@@map` table names only), e.g.:

```sql
CREATE UNIQUE INDEX plan_versions_draft_per_plan
    ON plan_versions ("planId") WHERE "publishedAt" IS NULL;
```

## Design decisions

- **No fixed quota columns** (`maxUsers`, `maxStorageGb`, …) — limits
  live generically in `quotas Json`; the allowed keys are declared in code
  via `@DefinesQuota`.
- **No `SubscriptionPlan`/`FeatureKey` enums** — both fields are declared
  as `String` (see Convention 1).
- **No add-on tables (#49)** — `subscription_addons`,
  `unit_addon_versions`, `feature_addon_versions` are not a
  sales surface; only plan versions + bundles are sold.
- **The application's own invoicing** — invoices to the people it sells to, fees
  it collects from its members, their bank details — belongs in the schema of the
  consuming app. The subscription business is the platform's: subscribers, their
  invoices and their payments are decided in
  [ADR 0012](../../../docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md),
  and every model added for them carries `Subscription` or `Subscriber` in its name,
  which keeps it clear of the names applications use for their own invoicing. A
  prefix cannot rule out a name nobody has seen, so `saasicat schema check` reports
  an application model that carries a platform model's name with a different shape.
