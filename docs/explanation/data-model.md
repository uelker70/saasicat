---
doc_title: SaaSiCat Data Model
status: normative
related:
    - ../packages/spec/prisma-fragments/README.md
    - ../packages/spec/sql/constraints.postgres.sql
    - ../packages/spec/sql/reference-schema.postgres.sql
---

# SaaSiCat Data Model

This document is the **normative logical data model** of the platform. The
artifact hierarchy:

<!-- markdownlint-disable MD013 -- link paths, kept whole by Prettier -->

1. **This document + [`sql/constraints.postgres.sql`](../../packages/spec/sql/constraints.postgres.sql)** —
   entities, invariants and the constraints no ORM DSL can express. Normative.
2. **[`sql/reference-schema.postgres.sql`](../../packages/spec/sql/reference-schema.postgres.sql)** —
   the full PostgreSQL DDL. Derived (generated via `pnpm run gen:sql` in
   `@saasicat/spec`), but authoritative for column names/types: the adapter
   integration tests build their database from this file.
3. **[`prisma-fragments/`](../../packages/spec/prisma-fragments/)** —
   Prisma-DSL rendering for consumers on the Prisma golden path. Derived;
   `@saasicat/adapter-drizzle` ships its own query-side rendering of the
   same model (`saasicatSchema`).
4. **`@saasicat/persistence-testing`** — the executable arbiter: every
   persistence adapter must pass the contract suite against a real database
   built from (2).

<!-- markdownlint-enable MD013 -->

Wire formats (HTTP/YAML) are governed separately by the JSON Schemas and the
OpenAPI contract in `@saasicat/spec` — they describe formats, not tables.

## Conventions

- Table names snake_case (via `@@map`), **column names camelCase** (no field
  mapping) — raw SQL must quote them (`"planId"`).
- Primary keys: UUID strings.
- Soft delete via `deletedAt` where history must survive (plans, bundles,
  promo codes, catalog entries); hard delete only for drafts.
- Money: `Decimal(10,2)`; promo values `Decimal(8,2)`; tax rates `Decimal(5,2)`.
  Never floats. An amount that was booked records the currency and the tax
  rate beside it rather than borrowing today's configuration — an
  installation sells in one currency at a time, and changing it is a
  migration precisely because it must not relabel history.
- Plan/feature/quota keys are **strings**, not DB enums; their catalog lives
  in `plans`/`feature_catalog_entries` + code decorators (`@DefinesQuota`).
- FKs to the consumer's `Tenant`/`User` models stay consumer-owned (the
  fragments ship them commented out). RLS policies are likewise
  consumer-owned; the platform only provides the bypass frame (`RlsBypassPort`).

## Entities by domain

### Billing core

| Entity                                        | Identity / uniqueness              | Notes                                                                                                                                                                                                    |
| --------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Subscription` (`subscriptions`)              | one per tenant (`tenantId` unique) | Binds a live `PlanVersion`. Carries pending plan/version change fields, trial/pilot state, custom limits, frozen `packageSnapshot`.                                                                      |
| `SubscriptionPaymentMethod`                   | 1:1 subscription                   | Masked payment data only.                                                                                                                                                                                |
| `CheckoutOffer` (`checkout_offers`)           | global, no RLS                     | Immutable offer snapshot from pricing page to onboarding; `consumed` freezes it into `Subscription.packageSnapshot`.                                                                                     |
| `SubscriptionContract` + `ContractLineItem`   | append-only                        | Contractually binding source for billing; existing contracts are only ever `terminate`d, line items never rewritten. Each line records its own `currency`, `taxRate` and `taxAmount`.                    |
| `SubscriptionBundle` (`subscription_bundles`) | booking identity                   | Pins a standalone add-on booking to one concrete `BundleVersion`; runs its own billing window, aligned so its periods end on the day the plan's do; cancellation becomes effective at its stored cutoff. |

### Catalog & versioning

| Entity                                                               | Identity / uniqueness                   | Notes                                                                    |
| -------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `Plan` (`plans`)                                                     | `planKey` unique                        | Stem = identity + UI ordering; soft delete keeps versions billing-valid. |
| `PlanVersion` (`plan_versions`)                                      | `(planId, version)` unique              | Versioned sales artifact (features/quotas/prices as snapshot).           |
| `Bundle`/`BundleVersion`                                             | `bundleKey`, `(bundleId, version)`      | Same lifecycle as plans.                                                 |
| `CapabilityCatalogEntry`, `FeatureCatalogEntry`, `QuotaCatalogEntry` | its own key, unique                     | Discovery/approval projections of code-declared capabilities.            |
| `MarketingProjection`                                                | `(targetType, targetVersionId, locale)` | Locale-specific marketing texts for one plan or bundle version.          |
| `MarketingSettings`                                                  | at most one row                         | The activated locale subset; a constant primary key is what caps it.     |

**One installation, one application.** A plan key, a bundle key, a feature key
and a quota key are unique for the whole installation — there is no namespace
above them, and none of the tables carries one. The platform reads the
application's name from `config/saas.yaml#app.name` and stores it nowhere: it
labels the manifest and the login page, and it is not part of any row's
identity. Two applications therefore mean two installations, each with its own
database — which is what `subscriptions.tenantId`, unique installation-wide,
has always required anyway.

**Version-lineage invariants** (both versioned families):

- At most **one draft** per lineage (`publishedAt IS NULL`) — partial unique
  indexes `*_draft_per_*` (SQL-only, see constraints file).
- `version` is monotonically increasing per lineage.
- At most **one live** version per lineage
  (`publishedAt IS NOT NULL AND supersededAt IS NULL`). Publishing a successor
  supersedes the predecessor **in the same transaction**
  (publish-and-supersede atomicity).
- A superseded version stays billing-valid for the subscriptions bound to it
  (contract protection P1) — versions are never deleted once published.
- Nullable `validFrom`/`validUntil` columns form the day-inclusive booking
  window for new subscriptions. A null `validFrom` is a legacy fallback and
  must be ordered with explicit `NULLS LAST` behind dated versions.
- `PlanVersion.endsAt` is an optional precise administrative termination
  timestamp; it is separate from the day-based auto-succession window.

### Promo codes

| Entity                      | Identity / uniqueness        | Notes                                                                                                                    |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PromoCode` (`promo_codes`) | `code` unique (stored UPPER) | `redemptionsCount`/`maxRedemptions` guard availability.                                                                  |
| `PromoCodeRedemption`       | **`subscriptionId` unique**  | One redemption per subscription — double redemption fails at the database. Snapshot of the code rule at redemption time. |
| `PromoCodeValidationLog`    | —                            | Anti-abuse trail incl. failed attempts.                                                                                  |

### Registration & admin

| Entity                             | Identity / uniqueness        | Notes                                                                                                                                                              |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PendingRegistration`              | —                            | Multi-step onboarding draft; must never count as an existing customer.                                                                                             |
| `PaymentEventLog`                  | `eventId` unique             | Webhook idempotency via unique INSERT (`tryClaim`).                                                                                                                |
| `AuditLog` (`audit_logs`)          | —                            | `actorTag` format `web:<email>:<sessionId>` / `cli:<email>:<host>` (see `audit-event.schema.json`); `tenantId` null = platform-global action.                      |
| `SuperAdminUser` / `SuperAdminMfa` | `email` unique / `userId` PK | Platform-owned SuperAdmin identity. `SuperAdminMfa.userId` deliberately has **no hard FK** — `MfaPort` also serves apps whose admins live in their own user table. |

### Configuration

| Entity                                 | Identity / uniqueness                  | Notes                                                                                                                                                                                                                            |
| -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppliedSettings` (`applied_settings`) | one row, `id = 'installation'` (CHECK) | The settings subtree of `config/saas.yaml` as it was resolved at the last start, a `sha256-…` fingerprint over it, `appliedAt`, and `source` — the file's absolute path or a phrase saying the values came in as code.           |
| `SettingsChange` (`settings_changes`)  | `seq`, numbered by the database        | One row per start that found the fingerprint moved: `previous`, `current`, `noticedAt`, and `acknowledgedAt`/`acknowledgedBy` once an operator has seen it. `seq` is assigned at the write and is the order the list is read in. |

**A mirror, never a source.** The platform writes both tables at boot and reads
them for the read-only settings screen — and for nothing else. No setting is
ever read out of them: the file is the one place a setting lives, and a record
that disagrees with it is what the next start records as a change. The
`CHECK` on `applied_settings.id` is what holds the table to one row; the column
default only lands a caller that omits the id on the right one.

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
7. **Plan changes keep the concrete contract binding consistent.** Adapters
   that declare atomic plan-binding support update the semantic `plan`, its
   active `planVersionId` and stale pending-version state in one transaction.
   A failed onboarding promo callback rolls the complete change back.
8. **The applied-settings record is replaced by one start at a time.**
   `AppliedSettingsPort.writeApplied` and `recordChange` take the fingerprint
   the caller read and write only while the row still carries it — `null`
   only while there is no row — and `recordChange` writes the change and the
   record it supersedes in one transaction. Several replicas starting together
   after one edit therefore record it once, and only the start that recorded
   it notifies anybody. `listChanges` orders by the number the database gave
   each change at that write, not by the moment the row carries: the list is
   the order the record moved in, even where a delayed start's clock says
   otherwise.

## Capability requirements

Adapters declare `PersistenceCapabilities`; the platform fail-fasts at boot:

| Platform feature                              | Requires                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `SaaSiCatModule` entitlement (`enforceLimit`) | `transactions`, `pessimisticLocking`                                         |
| Promo redemption flow                         | `transactions` (atomic `claimSlot` is part of the port contract)             |
| SuperAdmin over RLS-protected tables          | `rowLevelSecurity` integration (informational; policies stay consumer-owned) |
| —                                             | `advisoryLocks` required by no platform path today                           |

## Compatibility notes

- The canonical PlanVersion and BundleVersion fragments contain additive,
  nullable booking-window columns. Prisma adapters keep legacy behavior by
  default and expose time-aware reads only when their validity capability is
  enabled explicitly.
- The canonical `subscription_bundles` fragment and repository are shipped.
  `PrismaSubscriptionRepository.countByBundleVersionId` is enabled by naming
  the consumer's delegate; without that option the method remains absent and
  bundle-version editability stays fail-closed.
