---
doc_title: SaaSiCat Data Model
status: normative
related:
    - ../packages/saas-platform-spec/prisma-fragments/README.md
    - ../packages/saas-platform-spec/sql/constraints.postgres.sql
    - ../packages/saas-platform-spec/sql/reference-schema.postgres.sql
---

# SaaSiCat Data Model

This document is the **normative logical data model** of the platform. The
artifact hierarchy:

1. **This document + [`sql/constraints.postgres.sql`](../packages/saas-platform-spec/sql/constraints.postgres.sql)** —
   entities, invariants and the constraints no ORM DSL can express. Normative.
2. **[`sql/reference-schema.postgres.sql`](../packages/saas-platform-spec/sql/reference-schema.postgres.sql)** —
   the full PostgreSQL DDL. Derived (generated via `pnpm run gen:sql` in
   `@saasicat/spec`), but authoritative for column names/types: the adapter
   integration tests build their database from this file.
3. **[`prisma-fragments/`](../packages/saas-platform-spec/prisma-fragments/)** —
   Prisma-DSL rendering for consumers on the Prisma golden path. Derived;
   `@saasicat/adapter-drizzle` ships its own query-side rendering of the
   same model (`saasicatSchema`).
4. **`@saasicat/persistence-testing`** — the executable arbiter: every
   persistence adapter must pass the contract suite against a real database
   built from (2).

Wire formats (HTTP/YAML) are governed separately by the JSON Schemas and the
OpenAPI contract in `@saasicat/spec` — they describe formats, not tables.

## Conventions

- Table names snake_case (via `@@map`), **column names camelCase** (no field
  mapping) — raw SQL must quote them (`"planId"`).
- Primary keys: UUID strings.
- Soft delete via `deletedAt` where history must survive (plans, bundles,
  promo codes, catalog entries); hard delete only for drafts.
- Money: `Decimal(10,2)`; promo values `Decimal(8,2)`. Never floats.
- Plan/feature/quota keys are **strings**, not DB enums; their catalog lives
  in `plans`/`feature_catalog_entries` + code decorators (`@DefinesQuota`).
- FKs to the consumer's `Tenant`/`User` models stay consumer-owned (the
  fragments ship them commented out). RLS policies are likewise
  consumer-owned; the platform only provides the bypass frame (`RlsBypassPort`).

## Entities by domain

### Billing core

| Entity | Identity / uniqueness | Notes |
| --- | --- | --- |
| `Subscription` (`subscriptions`) | one per tenant (`tenantId` unique) | Binds a live `PlanVersion` and/or `BusinessTypeVersion` — **CHECK `subscriptions_plan_or_bt_check`**. Carries pending plan/version change fields, trial/pilot state, custom limits, frozen `packageSnapshot`. |
| `SubscriptionPaymentMethod` | 1:1 subscription | Masked payment data only. |
| `CheckoutOffer` (`checkout_offers`) | global, no RLS | Immutable offer snapshot from pricing page to onboarding; `consumed` freezes it into `Subscription.packageSnapshot`. |
| `SubscriptionContract` + `ContractLineItem` | append-only | Contractually binding source for billing; existing contracts are only ever `terminate`d, line items never rewritten. |

### Catalog & versioning

| Entity | Identity / uniqueness | Notes |
| --- | --- | --- |
| `Plan` (`plans`) | `(projectKey, planKey)` unique | Stem = identity + UI ordering; soft delete keeps versions billing-valid. |
| `PlanVersion` (`plan_versions`) | `(planId, version)` unique | Versioned sales artifact (features/quotas/prices as snapshot). |
| `Bundle`/`BundleVersion` | `(projectKey, bundleKey)`, `(bundleId, version)` | Same lifecycle as plans. |
| `BusinessType`/`BusinessTypeVersion`/`BusinessTypeBundle` | analogous | Vertical composition; junction pins **concrete** BundleVersions. |
| `CapabilityCatalogEntry`, `FeatureCatalogEntry`, `QuotaCatalogEntry`, `MarketingProjection`, `MarketingSettings` | `(projectKey, key)` unique | Discovery/approval projections of code-declared capabilities. |

**Version-lineage invariants** (all three versioned families):

- At most **one draft** per lineage (`publishedAt IS NULL`) — partial unique
  indexes `*_draft_per_*` (SQL-only, see constraints file).
- `version` is monotonically increasing per lineage.
- At most **one live** version per lineage (`publishedAt IS NOT NULL AND
  supersededAt IS NULL`); publishing a successor supersedes the predecessor
  **in the same transaction** (publish-and-supersede atomicity).
- A superseded version stays billing-valid for the subscriptions bound to it
  (contract protection P1) — versions are never deleted once published.

### Promo codes

| Entity | Identity / uniqueness | Notes |
| --- | --- | --- |
| `PromoCode` (`promo_codes`) | `code` unique (stored UPPER) | `redemptionsCount`/`maxRedemptions` guard availability. |
| `PromoCodeRedemption` | **`subscriptionId` unique** | One redemption per subscription — double redemption fails at the database. Snapshot of the code rule at redemption time. |
| `PromoCodeValidationLog` | — | Anti-abuse trail incl. failed attempts. |

### Registration & admin

| Entity | Identity / uniqueness | Notes |
| --- | --- | --- |
| `PendingRegistration` | — | Multi-step onboarding draft; must never count as an existing customer. |
| `PaymentEventLog` | `eventId` unique | Webhook idempotency via unique INSERT (`tryClaim`). |
| `AuditLog` (`audit_logs`) | — | `actorTag` format `web:<email>:<sessionId>` / `cli:<email>:<host>` (see `audit-event.schema.json`); `tenantId` null = platform-global action. |
| `SuperAdminUser` / `SuperAdminMfa` | `email` unique / `userId` PK | Platform-owned SuperAdmin identity. `SuperAdminMfa.userId` deliberately has **no hard FK** — `MfaPort` also serves apps whose admins live in their own user table. |

## Transactional invariants (what adapters must guarantee)

These are the behaviors `@saasicat/persistence-testing` verifies against a
real database. Prose in port doc-comments is explanatory; **the contract
suite is binding.**

1. **Quota enforcement is serialized per tenant.**
   `SubscriptionRepository.findByTenantIdLocked(tenantId, tx)` takes a row
   lock (`SELECT … FOR UPDATE`) so concurrent `enforceLimit()` transactions
   on the same tenant execute their count-then-insert sections one after the
   other. No lock → no transactional quota guarantee.
2. **Promo slot reservation is atomic.** `PromoCodeRepository.claimSlot`
   increments `redemptionsCount` only while
   `status = 'ACTIVE' AND (maxRedemptions IS NULL OR redemptionsCount <
   maxRedemptions)` — as a single guarded UPDATE, exactly-once under
   concurrency.
3. **One redemption per subscription** is enforced by the unique constraint,
   not by application checks.
4. **`TransactionRunner.run` is ACID**: a throw inside the callback rolls
   back every write made through the passed `TransactionContext`.
5. **Publish-and-supersede is atomic** per version lineage (invariant "at
   most one live").
6. **Tenant scoping**: repository reads scoped by `tenantId` never return
   another tenant's rows; platform-wide counts (`countActiveByPlanKey`) are
   the documented exceptions and must run RLS-exempt.

## Capability requirements

Adapters declare `PersistenceCapabilities`; the platform fail-fasts at boot:

| Platform feature | Requires |
| --- | --- |
| `SaasPlatformModule` entitlement (`enforceLimit`) | `transactions`, `pessimisticLocking` |
| Promo redemption flow | `transactions` (atomic `claimSlot` is part of the port contract) |
| SuperAdmin over RLS-protected tables | `rowLevelSecurity` integration (informational; policies stay consumer-owned) |
| — | `advisoryLocks` required by no platform path today |

## Known gaps

- `validFrom`/`validUntil` (booking windows, SPEC_V2 §4.2) exist in the wire
  types (`VersionedEntityBase`) but **not yet as columns** — the schema
  resolves "live" via `publishedAt`/`supersededAt` only, and
  `PlanVersionRepository.findActive` is unimplemented in the shipped adapter
  (consumers fall back to `findLatestLive`). Adding the columns is a
  schema-versioned change, not an adapter patch.
- `subscription_bundles` (standalone bundle bookings) has no fragment yet;
  `SubscriptionRepository.countByBundleVersionId` is therefore absent in the
  shipped adapter and bundle-version editability is fail-closed.
