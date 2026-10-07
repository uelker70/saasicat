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
- Money: `Decimal(10,2)`; promo values `Decimal(8,2)`; tax rates `Decimal(5,2)`, as percentages —
  19 means 19 %, wherever a rate is stated.
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

| Entity                                                                                                    | Identity / uniqueness                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Subscription` (`subscriptions`)                                                                          | one per tenant (`tenantId` unique)                                      | Binds a live `PlanVersion`. Keeps that version across renewals; carries a scheduled change (`pendingPlan`, `pendingChangeVersionId`), trial/pilot state, custom limits, frozen `packageSnapshot`.                                                                                                                                                                                                                                                                                                                          |
| `CheckoutOffer` (`checkout_offers`)                                                                       | global, no RLS                                                          | Immutable offer snapshot from pricing page to onboarding; `consumed` freezes it into `Subscription.packageSnapshot`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SubscriptionContract` + `ContractLineItem`                                                               | append-only                                                             | Contractually binding source for billing; existing contracts are only ever `terminate`d, line items never rewritten. Each line records its own `currency`, `taxRate` and `taxAmount`, its gross being its share of the tax computed once per rhythm, so the lines add up to the contract's totals. A contract names its subscriber and copies both parties when it is concluded; `tenantId` is a trace, with no relation to the tenant.                                                                                    |
| `Subscriber` (`subscribers`)                                                                              | customer number unique                                                  | The party a contract is concluded with. One live tenant at most through `subscriber_tenants`, which keeps the tenants it had before; corrections of its legal identity in `subscriber_corrections`, numbered in the order they were written. Its tax origin is the country, whether it is a business (`business`, recorded and never derived) and its VAT id; `currentVatIdCheckId` names the recorded check that counts for that VAT id now, null while none does, and `vatIdSince` says since when it holds that VAT id. |
| `SubscriberTaxOriginChange` (`subscriber_tax_origin_changes`)                                             | append-only; numbered in write order                                    | One change of a subscriber's country, business status or VAT id: the values it replaced and wrote, who made it, and when the write held the subscriber's row lock. Written in the transaction that makes the change (invariant 13), listed in the order the database numbered it, and applied from the next invoice.                                                                                                                                                                                                       |
| `SubscriberVatIdCheck` (`subscriber_vat_id_checks`)                                                       | append-only                                                             | One completed check of a subscriber's VAT id as the service answered it: the number, when the answer came, whether it was valid, the service and its confirmation. Kept whether it counts or not and never rewritten, as the evidence a reverse charge rests on (invariant 13).                                                                                                                                                                                                                                            |
| `SubscriberPaymentMethod` (`subscriber_payment_methods`)                                                  | gateway account + reference unique; one `ACTIVE` per subscriber         | The gateway's reference to how a subscriber pays, with masked details only. The account that issued it is recorded beside it; the one a newer payment method replaced stays as `REPLACED`. A reference belongs to one subscriber, and a read by it names whose (invariant 9).                                                                                                                                                                                                                                              |
| `SubscriberPaymentMethodSetup` (`subscriber_payment_method_setups`)                                       | gateway account + session unique                                        | A change of payment method a tenant started. A confirmation is recorded only against the open setup whose account, session and subscriber it names, and completes it.                                                                                                                                                                                                                                                                                                                                                      |
| `PaymentEventLog`                                                                                         | gateway account + `eventId` unique                                      | Every gateway callback, claimed on the transaction that writes its effect (`claim`), so a rollback leaves it free for the gateway's retry.                                                                                                                                                                                                                                                                                                                                                                                 |
| `SubscriberLedgerEntry` (`subscriber_ledger_entries`)                                                     | subscription + source + source reference + period start + origin unique | One charge in a subscriber's account: net, with its currency and period, naming the contract line it came from. Append-only; derived again as often as the platform or the application asks, and written once (invariant 10). Outlives the tenant.                                                                                                                                                                                                                                                                         |
| `SubscriptionInvoice` + `SubscriptionInvoiceLine` (`subscription_invoices`, `subscription_invoice_lines`) | number unique; year + sequence unique; a charge on one line             | An invoice issued from the journal, with the issuer, the subscriber and the tax treatment copied as they were on its issue date, its tax per rate and its days in the installation's time zone. Each line names its charge and its contract line. Append-only: nothing updates or deletes an invoice (invariant 14). Outlives the tenant.                                                                                                                                                                                  |
| `SubscriptionInvoiceNumber` (`subscription_invoice_numbers`)                                              | one per year                                                            | The last number drawn in a year, the range's counter (invariant 14).                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SubscriptionNotice` (`subscription_notices`)                                                             | subscription + kind + subject unique                                    | One notice to a subscriber — a newer version offered, the retirement of its plan version or of an add-on version it booked, or a retirement's reminder — with what it said, when it went out, to whom and through which channel. Claimed by the run that sends it, confirmed after (invariant 12). Keeps the tenant and the subscription as values and outlives them.                                                                                                                                                      |
| `VersionRetirement` (`version_retirements`)                                                               | one per announcement                                                    | An operator's retirement of a plan version for the subscriptions on it: the version retired, the replacement named, when and by whom. What it means for each subscription is that subscription's notice, recorded in the same transaction.                                                                                                                                                                                                                                                                                 |
| `BundleVersionRetirement` (`bundle_version_retirements`)                                                  | one per announcement                                                    | The same for an add-on version and the bookings on it; the replacement is a version of the same add-on.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `SubscriptionBundle` (`subscription_bundles`)                                                             | booking identity                                                        | Pins a standalone add-on booking to one concrete `BundleVersion`; runs its own billing window, aligned so its periods end on the day the plan's do; cancellation becomes effective at its stored cutoff.                                                                                                                                                                                                                                                                                                                   |

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
- At most **one newest** published version per lineage
  (`publishedAt IS NOT NULL AND supersededAt IS NULL`) — the one the next
  publish chains to. Publishing a successor supersedes the predecessor **in
  the same transaction** (publish-and-supersede atomicity).
- A superseded version stays billing-valid for the subscriptions bound to it
  (contract protection P1) — versions are never deleted once published.
- Which version is **on sale** is decided by its dates, not by `supersededAt`:
  published, `validFrom` reached, `validUntil` not passed (day-inclusive),
  `endsAt` not reached, and — once superseded — only with a `validUntil`, so a
  replaced version without a last day (as a catalogue import leaves it) does
  not sell again when its successor ends. The catalogue, every price and every
  booking read it
  the same way (`SC-PLAN-027`), so a predecessor stays on sale until the day
  before its successor starts. A null `validFrom` counts as "since
  publication" and is ordered with explicit `NULLS LAST` behind dated versions.
- `PlanVersion.endsAt` is a precise administrative end; a version past it
  takes no new booking. It is separate from the day-based auto-succession
  window.

### Promo codes

| Entity                      | Identity / uniqueness        | Notes                                                                                                                    |
| --------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PromoCode` (`promo_codes`) | `code` unique (stored UPPER) | `redemptionsCount` + `heldCount` against `maxRedemptions` guard availability.                                            |
| `PromoCodeRedemption`       | **`subscriptionId` unique**  | One redemption per subscription — double redemption fails at the database. Snapshot of the code rule at redemption time. |
| `PromoCodeHold`             | **`checkoutOfferId` unique** | A slot kept for a checkout from its start to its conclusion or `expiresAt`; the row goes when the hold ends.             |
| `PromoCodeValidationLog`    | —                            | Anti-abuse trail incl. failed attempts.                                                                                  |

### Registration & admin

| Entity                             | Identity / uniqueness        | Notes                                                                                                                                                              |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PendingRegistration`              | —                            | Multi-step onboarding draft; must never count as an existing customer.                                                                                             |
| `AuditLog` (`audit_logs`)          | —                            | `actorTag` format `web:<email>:<sessionId>` / `cli:<email>:<host>` (see `audit-event.schema.json`); `tenantId` null = platform-global action.                      |
| `SuperAdminUser` / `SuperAdminMfa` | `email` unique / `userId` PK | Platform-owned SuperAdmin identity. `SuperAdminMfa.userId` deliberately has **no hard FK** — `MfaPort` also serves apps whose admins live in their own user table. |

### Configuration

| Entity                                 | Identity / uniqueness                  | Notes                                                                                                                                                                                                                            |
| -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppliedSettings` (`applied_settings`) | one row, `id = 'installation'` (CHECK) | The settings subtree of `config/saas.yaml` as it was resolved at the last start, a `sha256-…` fingerprint over it, `appliedAt`, and `source` — the file's absolute path or a phrase saying the values came in as code.           |
| `SettingsChange` (`settings_changes`)  | `seq`, numbered by the database        | One row per start that found the fingerprint moved: `previous`, `current`, `noticedAt`, and `acknowledgedAt`/`acknowledgedBy` once an operator has seen it. `seq` is assigned at the write and is the order the list is read in. |

**A mirror, never a source of settings.** No setting is ever read out of these
tables: the file is the one place a setting lives, and a record that disagrees
with it is what the next start records as a change. The platform writes them at
boot, reads them for the read-only settings screen, and reads one thing out of
them that is not a setting — which legal entity this installation last ran as,
where it decides only whether the start continues at all. The `CHECK` on
`applied_settings.id` is what holds the table to one row; the column default only
lands a caller that omits the id on the right one.

### Maintenance

| Entity                                      | Identity / uniqueness                             | Notes                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MaintenanceWindow` (`maintenance_windows`) | `id`; at most one open row (partial unique index) | One row per window: the announced `startsAt`/`endsAt` and `message`, `lockedAt`/`lockedBy` once locked, `endedAt`/`endedBy` once unlocked or cancelled. `startsAt` is null for a window locked at once. |

**Read by two versions at once.** While a window is locked, the version being
replaced and the one replacing it both read this table on their requests, so its
shape is part of the contract between two releases: it gains columns, and never
in a deploy the lock protects. The announced times are what tenants were told;
they never start or end the lock. The guide is
[Take the application offline for a deploy](../guides/take-the-application-offline-for-a-deploy.md).

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
   `status = 'ACTIVE' AND (maxRedemptions IS NULL OR redemptionsCount +
heldCount < maxRedemptions)` — as a single guarded UPDATE, exactly-once under
   concurrency. `PromoCodeHoldRepository.take` holds a slot for a checkout
   under the same rule, and every way a hold ends — released, expired, or
   turned into the redemption on the transaction it was handed over on —
   deletes its row and moves its count once.
3. **One redemption per subscription** is enforced by the unique constraint,
   not by application checks.
4. **`TransactionRunner.run` is ACID**: a throw inside the callback rolls
   back every write made through the passed `TransactionContext`.
5. **Publish-and-supersede is atomic** per version lineage (invariant "at
   most one live").
6. **Tenant scoping**: repository reads scoped by `tenantId` never return
   another tenant's rows. The platform-wide reads are the documented exceptions
   and must run RLS-exempt: `countActiveByPlanKey`, and the two the boot checks
   make before anything is served — `listRunningIssuers` and `accountsInUse`.
   Both of those go through `RlsBypassPort` outside any request, so an
   implementation of it that needs a request context fails at start. The
   operator's read of one tenant's account (`SubscriberAccountService`) is the
   administration's, not a tenant's, and runs inside `RlsBypassPort` within the
   operator's request.
7. **Plan changes keep the concrete contract binding consistent.** Adapters
   that declare atomic plan-binding support update the semantic `plan`, its
   active `planVersionId` and the scheduled change in one transaction.
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
9. **A payment method's reference belongs to one subscriber.**
   `(gatewayAccount, paymentMethodRef)` is unique account-wide, not per
   subscriber, so `SubscriberPaymentMethodRepository` names the subscriber
   wherever that key is used: `findByReference` answers only about the
   subscriber it is given, and `recordConfirmed` refuses a reference another
   subscriber holds rather than answering `already-recorded` with that
   subscriber's row. Both are reached on the gateway's callback, which carries
   no tenant — an installation with a policy on the table lifts it there, and
   what the question names is then all that bounds it. The lock `recordConfirmed`
   holds is on the subscriber, so two subscribers confirming one reference at
   once do not take turns and neither read sees the other: reading is not enough
   to decide it. The reference is therefore **claimed by the first write**,
   conflict-free on its own key, and refused when the claim takes no row — which
   is also why a refusal leaves the caller's transaction as it found it.
10. **A charge is written once.** `SubscriberLedgerRepository.recordCharges`
    writes a charge only where no charge with its natural key — subscription,
    source, source reference, period start and origin — exists, and says which
    ones it wrote. The unique index decides, not a read before the write, so
    derivations running at the same time write each charge once between them.
    Nothing updates or deletes a charge.
11. **At most one maintenance window is open, and every move is guarded.**
    `MaintenanceWindowPort.open` inserts only where no window is open — the
    partial unique index decides, so two operators locking at the same moment
    land one window — and `update` changes a window only while it is still open
    and at the stage the caller read. An unlock and a lock issued together
    therefore cannot both land on one window.
12. **A notice is sent once.** `SubscriptionNoticeRepository.claim` records a
    notice only where no notice with its key — subscription, kind and subject —
    exists, and takes it for one run in a single guarded update: only while it
    is not delivered and no run holds it, or the run that holds it took it on
    before the lease began. `confirm` and `release` land only under the claim
    the caller holds. Two instances running the same job therefore send a
    notice once between them. Two duplicates are left: a process that stops
    after the message went out and before `confirm`, and an application that
    answers later than the lease, after another run took the notice on.
13. **A change of the tax origin is recorded by the write that makes it.**
    `SubscriberRepository.updateContact` records a change of the country,
    `correctIdentity` one of the VAT id and `changeBusinessStatus` one of the
    business status, each in the same transaction and under the row lock a
    correction takes, dated while the lock is held and numbered by the database,
    so the value recorded as replaced is the one the write replaced and the list
    reads in the order the writes happened; the dates follow that order on one
    clock. A write that moves none of the three records nothing. Each change
    keeps why where its write says why — the correction's reason, the business
    status's reason; a change of the country with the contact details states
    none. A correction of the legal identity is dated and numbered the same way,
    and shares its date with the change of the VAT id it makes.
    `recordVatIdCheck` records every check and, under the same lock, makes it
    count only for the number the subscriber holds, completed since it holds it,
    and never over a check that completed later (`keepsVatIdCheck`); a
    correction of the VAT id ends the counting check without removing it and
    sets `vatIdSince`, so a number corrected away and back is checked again and
    no confirmation is ever lost.
14. **An invoice takes the next number, and a charge stands on one invoice.**
    `SubscriptionInvoiceRepository.issue` raises its year's row in
    `subscription_invoice_numbers` and writes the invoice and its lines in one
    transaction. The `UPDATE` holds that row until the transaction ends, so two
    invoices issued at the same moment take two numbers one after the other, and
    one that is not written hands its number back with everything else. A line's
    `chargeId` is unique, and the lines are written conflict-free on it: a charge
    another invoice took first comes back unwritten, and the invoice is refused
    with `SUBSCRIPTION_INVOICE_CHARGE_INVOICED` before its transaction ends — so
    the refusal, too, leaves no number behind.

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
