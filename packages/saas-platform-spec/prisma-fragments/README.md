---
doc_title: SaaS Platform Prisma Fragments
status: living document
related:
    - ../schemas/plan-catalog.schema.json
    - ../schemas/promo-code.schema.json
    - ../schemas/audit-event.schema.json
    - ../../saas-platform-types/src/subscription.types.ts
---

# Prisma Fragments

Reference snippets that document the **canonical database schema** of the SaaS
platform. Consumer apps copy the models into their own `schema.prisma` and add
FK relations to their project-specific `Tenant`/`User` models.

## Files

| File                                                                 | Models                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`01-subscription.prisma`](01-subscription.prisma)                   | `Subscription`, `SubscriptionPaymentMethod`, `CheckoutOffer` + Enums                   |
| [`02-promo-code.prisma`](02-promo-code.prisma)                       | `PromoCode`, `PromoCodeRedemption`, `PromoCodeValidationLog` + Enums                   |
| [`03-plan-versions.prisma`](03-plan-versions.prisma)                 | `Plan`, `PlanVersion`                                                                  |
| [`04-audit-log.prisma`](04-audit-log.prisma)                         | `AuditLog`                                                                             |
| [`05-bundle-business-type.prisma`](05-bundle-business-type.prisma)   | `Bundle`, `BundleVersion`, `BusinessType`, `BusinessTypeVersion`, `BusinessTypeBundle` |
| [`06-catalog-entries.prisma`](06-catalog-entries.prisma)             | `CapabilityCatalogEntry`, `FeatureCatalogEntry`, `MarketingProjection`                 |
| [`07-promotion.prisma`](07-promotion.prisma)                         | `Promotion`                                                                            |
| [`08-subscription-contract.prisma`](08-subscription-contract.prisma) | `SubscriptionContract`, `ContractLineItem`                                             |
| [`09-pending-registration.prisma`](09-pending-registration.prisma)   | `PendingRegistration`, `PaymentEventLog` + `RegistrationStatus`                        |

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

### 3. Table names (`@@map`) are canonical

`subscriptions`, `plan_versions`, `promo_codes`, `promo_code_redemptions`,
`promo_code_validation_logs`, `audit_logs`, `bundles`, `bundle_versions`,
`business_types`, `business_type_versions`, `business_type_bundles`,
`capability_catalog_entries`, `feature_catalog_entries`,
`marketing_projections`, `subscription_contracts`, `contract_line_items`.
Please do **not change** them — otherwise platform migration scripts and the
`@saasicat/cli` commands that rely on these names will break.

### 4. Decimal precision

All monetary amounts are `Decimal(10, 2)` (max ±99,999,999.99 €), promo-code
values are `Decimal(8, 2)` (percentage or amount). Consumers should not relax
this precision.

### 5. Partial unique index for drafts

`PlanVersion`, `BundleVersion`
and `BusinessTypeVersion` allow **exactly one** draft per
identity key (`publishedAt IS NULL`). The Prisma schema cannot express this —
add it in the SQL migration:

```sql
CREATE UNIQUE INDEX plan_versions_draft_per_plan
    ON plan_versions (plan_id) WHERE published_at IS NULL;
```

Likewise for:

- `bundle_versions` (per `bundle_id`)
- `business_type_versions` (per `business_type_id`)

## Design decisions

- **No fixed quota columns** (`maxUsers`, `maxStorageGb`, …) — limits
  live generically in `quotas Json`; the allowed keys are declared in code
  via `@DefinesQuota`.
- **No `SubscriptionPlan`/`FeatureKey` enums** — both fields are declared
  as `String` (see Convention 1).
- **No add-on tables (#49)** — `subscription_addons`,
  `unit_addon_versions`, `feature_addon_versions` are not a
  sales surface; only plan versions + bundles are sold.
- **App-specific tables** (e.g. invoice or bank master data)
  belong in the schema of the consuming app, not in the platform.
