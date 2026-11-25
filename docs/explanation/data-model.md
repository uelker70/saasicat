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

| Entity                                                                                                    | Identity / uniqueness                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Subscription` (`subscriptions`)                                                                          | one per tenant (`tenantId` unique)                                                           | Binds a live `PlanVersion`. Keeps that version across renewals; carries a scheduled change (`pendingPlan`, `pendingChangeVersionId`) with what the subscriber agreed to when they scheduled it, trial/pilot state, custom limits, frozen `packageSnapshot`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `CheckoutOffer` (`checkout_offers`)                                                                       | global, no RLS                                                                               | Immutable offer snapshot from pricing page to onboarding; `consumed` freezes it into `Subscription.packageSnapshot`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SubscriptionContract` + `ContractLineItem`                                                               | append-only                                                                                  | Contractually binding source for billing; existing contracts are only ever `terminate`d, line items never rewritten. Each line records its own `currency`, `taxRate` and `taxAmount`, its gross being its share of the tax computed once per rhythm, so the lines add up to the contract's totals. A contract names its subscriber and copies both parties when it is concluded, and records the notice period of its rhythm that a cancellation of it is judged by, the version of the operator's terms, when the subscriber agreed to both, and whether it is due a confirmation (`confirmationDue`, false on a contract written before confirmations); `tenantId` is a trace, with no relation to the tenant.                                                                                              |
| `Subscriber` (`subscribers`)                                                                              | customer number unique                                                                       | The party a contract is concluded with. One live tenant at most through `subscriber_tenants`, which keeps the tenants it had before; corrections of its legal identity in `subscriber_corrections`, numbered in the order they were written. Its tax origin is the country, whether it is a business (`business`, recorded and never derived) and its VAT id; `currentVatIdCheckId` names the recorded check that counts for that VAT id now, null while none does, and `vatIdSince` says since when it holds that VAT id.                                                                                                                                                                                                                                                                                    |
| `SubscriberTaxOriginChange` (`subscriber_tax_origin_changes`)                                             | append-only; numbered in write order                                                         | One change of a subscriber's country, business status or VAT id: the values it replaced and wrote, who made it, and when the write held the subscriber's row lock. Written in the transaction that makes the change (invariant 13), listed in the order the database numbered it, and applied from the next invoice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SubscriberVatIdCheck` (`subscriber_vat_id_checks`)                                                       | append-only                                                                                  | One completed check of a subscriber's VAT id as the service answered it: the number, when the answer came, whether it was valid, the service and its confirmation. Kept whether it counts or not and never rewritten, as the evidence a reverse charge rests on (invariant 13).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `SubscriberPaymentMethod` (`subscriber_payment_methods`)                                                  | gateway account + reference unique; one `ACTIVE` per subscriber                              | The gateway's reference to how a subscriber pays, with masked details only. The account that issued it is recorded beside it; the one a newer payment method replaced stays as `REPLACED`. A reference belongs to one subscriber, and a read by it names whose (invariant 9).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SubscriberPaymentMethodSetup` (`subscriber_payment_method_setups`)                                       | gateway account + session unique                                                             | A change of payment method a tenant started. A confirmation is recorded only against the open setup whose account, session and subscriber it names, and completes it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `PaymentEventLog`                                                                                         | gateway account + `eventId` unique                                                           | Every gateway callback, claimed on the transaction that writes its effect (`claim`), so a rollback leaves it free for the gateway's retry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `SubscriberLedgerEntry` (`subscriber_ledger_entries`)                                                     | subscription + source + source reference + period start + origin unique                      | One charge in a subscriber's account: net, with its currency and period, naming the contract line it came from. Append-only; derived again as often as the platform or the application asks, and written once (invariant 10). A mistake is a counter-entry of origin `correction`, naming the charge it corrects, the invoice it stood on and the reason, written by that invoice's cancellation alone. Outlives the tenant.                                                                                                                                                                                                                                                                                                                                                                                  |
| `SubscriptionInvoice` + `SubscriptionInvoiceLine` (`subscription_invoices`, `subscription_invoice_lines`) | number unique; year + sequence unique; a charge on one line                                  | An invoice issued from the journal, with the issuer, the subscriber, the tax treatment and the payment method it is collected with copied as they were on its issue date, its tax per rate and its days in the installation's time zone, a direct debit's collection date among them, and whether it was issued in a test operation (`testOperation`), as the installation's mark said then — a cancellation invoice and its replacement carry the one of the invoice they correct. Each line names its charge and its contract line, and a counter-entry's line the line of the same invoice whose charge it corrects. Append-only: nothing updates or deletes an invoice (invariant 14). Outlives the tenant.                                                                                               |
| `SubscriptionInvoiceNumber` (`subscription_invoice_numbers`)                                              | one per year                                                                                 | The last number drawn in a year, the range's counter (invariant 14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SubscriptionInvoiceDocument` (`subscription_invoice_documents`)                                          | one per invoice                                                                              | Where an invoice's document stands: the checksum of its file, recorded once before the file is archived, when the archive confirmed it, which run holds its mail, and when and to whom it was mailed (invariant 17). Outlives the tenant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `SubscriptionInvoiceArchive` (`subscription_invoice_archive`)                                             | one per invoice                                                                              | The file an invoice was issued as, under its checksum. Triggers refuse every update, delete and truncate (invariant 17). Outlives the tenant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ContractConfirmation` (`contract_confirmations`)                                                         | one per contract                                                                             | Where a contract's confirmation stands: the checksum recorded before its file is archived, whether it was made in a test operation (`testOperation`), recorded with its first rendering and kept when a rendering replaces it, when the archive confirmed it, which run holds its mail and when the mail took it (invariant 19). Only contracts with `confirmationDue` get one.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ContractConfirmationArchive` (`contract_confirmation_archive`)                                           | one per contract                                                                             | The confirmation a contract's subscriber was sent, under its checksum. Triggers refuse every update, delete and truncate (invariant 19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `SubscriptionInvoiceCollection` (`subscription_invoice_collections`)                                      | key unique; invoice + attempt unique; one attempt open per invoice, none after one succeeded | An attempt to collect an invoice through its payment gateway: the request it made — the account, the payment method, the amount, the key — written before it left, and what became of it; or one planned for a day after a failure or with a replaced payment method, announced first where it is a direct debit. A succeeded one whose payment a reversal took back is `REVERSED`, which frees the invoice for an attempt with another payment method. Outlives the tenant.                                                                                                                                                                                                                                                                                                                                  |
| `SubscriberPayment` (`subscriber_payments`)                                                               | gateway account + reference unique                                                           | A payment the gateway confirmed for an invoice's collection attempt: what it received, recorded once however often and in whatever order it is reported, in the invoice's turn. Outlives the tenant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `SubscriptionInvoiceSettlement` (`subscription_invoice_settlements`)                                      | written with its payment                                                                     | What a payment settles of its invoice, what a reversal opens of it again, and what a reversal given back settles again; what the invoice still owes is its total less these, a reversal counting the other way. An entry of its own, so a reversal or a cancellation's replacement adds one rather than changing one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `SubscriberCredit` (`subscriber_credits`)                                                                 | origin payment unique; origin invoice unique                                                 | Money the operator owes a subscriber: what a payment brought beyond its invoice, an invoice whose total is negative, or what a reversal given back brought beyond what was owed — exactly one of the three, checked when it is read. Never offset against a later invoice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `SubscriberCreditEntry` (`subscriber_credit_entries`)                                                     | refund + credit + kind unique                                                                | What paid a credit out — a refund made in the gateway, a payout the operator recorded with its reference, a reversal taking the credit's open part back — or gave it back, when a refund failed or a reversal was given back. A credit owes its amount less these, never below nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SubscriberRefund` (`subscriber_refunds`)                                                                 | gateway account + reference unique                                                           | A refund the operator made in the gateway, against the payment it pays back, as the gateway reports it; recorded once, its status the only thing updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `SubscriberReversal` (`subscriber_reversals`)                                                             | gateway account + reference unique                                                           | A returned direct debit or a chargeback against the payment it takes back: what it withdrew, what of that came from the credit, and what the gateway gave back, each only growing — applied once however often and in whatever order it is reported, in the turn of the payment's invoices.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SubscriberReconciliationCase` (`subscriber_reconciliation_cases`)                                        | refund unique                                                                                | What the gateway reported and nothing matched — a refund's part no credit takes, a reversal's part that meets a credit already paid out — for the operator to close with a note; closed by SaaSiCat where the money came back. Its closing is the only thing updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `SubscriptionNotice` (`subscription_notices`)                                                             | subscription + kind + subject unique                                                         | One notice to a subscriber, of a kind `SubscriptionNoticeKind` names — a newer version offered, a retirement and its reminder, a feature withdrawn or granted again, an end at once, what collecting an invoice told it, a reminder before its data is deleted (`SC-CANC-022`) — with what it said, when it went out, to whom and through which channel. `subject` says what it is about, per kind; a `deletion-reminder`'s is `<end id>:<days>`, so an end is reminded once per lead time. Claimed by the run that sends it, confirmed after (invariant 12), which records `recipientCount`, how many it went to. Keeps the tenant and the subscription as values and outlives them; once its tenant is deleted, `recipients` is empty, `recipientCount` stands and `recipientsForgottenAt` says since when. |
| `VersionRetirement` (`version_retirements`)                                                               | one per announcement                                                                         | An operator's retirement of a plan version for the subscriptions on it: the version retired, the replacement named, when and by whom. What it means for each subscription is that subscription's notice, recorded in the same transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `BundleVersionRetirement` (`bundle_version_retirements`)                                                  | one per announcement                                                                         | The same for an add-on version and the bookings on it; the replacement is a version of the same add-on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `FeatureWithdrawal` (`feature_withdrawals`)                                                               | one per announcement; at most one not lifted per feature (partial unique index)              | An operator's withdrawal of a feature from everybody who holds it: the feature, the reason the subscribers read, from when, the reductions named per plan and add-on in each rhythm, when and by whom; `liftedFrom`, `liftedAt` and `liftedBy` once lifted; `toldAt` once the subscriptions it reaches were told. Whom it reached, and what each line is reduced by, is that subscription's `feature-withdrawn` notice, read and recorded once the withdrawal is, in the transaction that sets `toldAt` (invariant 15).                                                                                                                                                                                                                                                                                       |
| `SubscriptionBundle` (`subscription_bundles`)                                                             | booking identity                                                                             | Pins a standalone add-on booking to one concrete `BundleVersion`; runs its own billing window, aligned so its periods end on the day the plan's do; cancellation becomes effective at its stored cutoff. Records what the subscriber agreed to by booking it, and by scheduling a switch to a newer version, for the contract written for either later.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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
| `AuditLog` (`audit_logs`)          | —                            | `actorTag` format `web:<email>:<sessionId>` / `cli:<email>:<host>` (see `audit-event.schema.json`); `tenantId` names the tenant an entry concerns (`SC-AUD-021`).  |
| `SuperAdminUser` / `SuperAdminMfa` | `email` unique / `userId` PK | Platform-owned SuperAdmin identity. `SuperAdminMfa.userId` deliberately has **no hard FK** — `MfaPort` also serves apps whose admins live in their own user table. |

### Configuration

| Entity                                 | Identity / uniqueness                  | Notes                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppliedSettings` (`applied_settings`) | one row, `id = 'installation'` (CHECK) | The settings subtree of `config/saas.yaml` as it was resolved at the last start, a `sha256-…` fingerprint over it, `appliedAt`, and `source` — the file's absolute path or a phrase saying the values came in as code.                                                                             |
| `SettingsChange` (`settings_changes`)  | `seq`, numbered by the database        | One row per start that found the fingerprint moved: `previous`, `current`, `noticedAt`, and `acknowledgedAt`/`acknowledgedBy` once an operator has seen it. `seq` is assigned at the write and is the order the list is read in.                                                                   |
| `TermsVersion` (`terms_versions`)      | `version` primary key                  | One version of the operator's terms that `config/saas.yaml#terms` named: the PDF byte for byte, its checksum and file name, archived once at the start. Triggers refuse every update, delete and truncate (invariant 18). A contract records the version it was concluded under in `termsVersion`. |

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

### Tenant access

| Entity                                     | Identity / uniqueness                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TenantAccessHold` (`tenant_access_holds`) | `id`; at most one open row per tenant, kind and reference (partial unique index) | One row per reason a tenant is held back (`SC-ADM-060`): `kind` is `suspended`, `overdue`, `ended` or `deleting`, `reference` names the invoice or subscription where the reason is about one, `note` is the operator's words for a suspension. Open while `liftedAt` is null. Once its tenant is deleted, `note` is empty and `recordedBy` and `liftedBy` name a role (see [Tenant deletions](#tenant-deletions)). |

**Read on every request of a tenant.** The tenant's state is the strictest of
its open reasons — a deletion before a suspension, a suspension before
read-only — so lifting one reason leaves the others standing. `tenantId` is a
value, not a relation: the tenant model is the application's.

**An `overdue` reason per invoice.** The quarter-hourly invoice run records
one for every invoice unpaid on or after its due date, on the tenant the
invoice's subscriber is live for, and lifts each whose invoice that no longer
describes; the payment that settles an invoice lifts its reason at once
(`SC-PRIC-104`).

### Subscription ends

| Entity                                                           | Identity / uniqueness                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SubscriptionEnd` (`subscription_ends`)                          | `id`; one per `subscriptionId` and `endsAt`, at most one not lifted per `subscriptionId` (partial unique index) | One row per end of a subscription (`SC-CANC-027`): `endsAt`, the moment its cancellation landed, and `deletesOn`, the installation's day its tenant's data is deleted on. Never moved; `liftedAt` once a new subscription of the tenant lifted it (`SC-CANC-034`), when the row stays as history and a later end is a row of its own.                                                                                                                                                                                                                                     |
| `SubscriptionEndAnnouncement` (`subscription_end_announcements`) | `id`; one per `subscriptionId` and `endsAt`, at most one not lifted per `subscriptionId` (partial unique index) | One row per end its tenant confirmed with a deletion day (`SC-CANC-021`, `SC-CANC-029`): `endsAt`, the moment the end was to land then, `deletesOn`, the day the tenant was told, `readOnlyDays`, the period it was counted with, and who confirmed it when. Not an end. Never moved; `liftedAt` with the end it announced.                                                                                                                                                                                                                                               |
| `TenantExportDownload` (`tenant_export_downloads`)               | `id`; as many rows per `subscriptionId` as downloads were taken                                                 | One row per download of a tenant's full export taken after its subscription ended (`SC-PRIV-020`): `subscriptionId`, the end it was offered for, `downloadedAt`, the moment the application handed the file over — or, where it delivers the export itself, reported it delivered in full —, `downloadedBy`, who took it, as the audit log tags an actor, `downloadedByUserId`, the id the session named them by, and `size`, the file's bytes (`BIGINT`; never 0, since an empty export is refused). The tenant's acknowledgement that `SC-PRIV-024` names. Never moved. |

**Recorded by a run, beside an `ended` reason.** Nothing marks the moment a
cancellation lands, so the quarter-hourly run reads the subscriptions a
cancellation was declared for (`SubscriptionUsagePort.listCancelled`), and for
each one that has landed and has no row here it records the `ended` reason on
its tenant first, then the end. A run that stops between the two records the end
the next time and finds the reason already open. `deletesOn` is the day the
tenant was told where it has an announcement and the end landed no later than
the one announced (`SC-CANC-030`); otherwise the first day after
`tenantBilling.endOfSubscription.readOnlyDays`, counted from the day the
subscription ended or from the day the end is recorded, where that is later.

**Reminded before the deletion day, from the ends.** After recording, the same
run reads the ends whose `deletesOn` is after the installation's day
(`SubscriptionEndPort.listDeletingAfter`) and the reminders already recorded
for them, and sends each end at most one: for the smallest lead time of
`tenantBilling.endOfSubscription.reminderDaysBefore` that is due and not covered
by one told before (`SC-CANC-022`). Each reminder is a row in
`subscription_notices`, kind `deletion-reminder`, keyed by the end and the lead
time, so of several instances one sends it (invariant 12). Instances that decide
on different lead times for one end at once send one of them at most: each
reads the end's reminders again after its claim and lets go where it finds
another held or told since it decided. Nothing is kept on the end itself; the
ends are read by `deletesOn`, which has an index of its own.

**Announced at confirmation, beside the end.** The days a tenant's page showed
when it confirmed its cancellation, or ended its subscription at once, are
recorded once as an announcement — by the request that won the cancellation or
ended the subscription, or by a repeat that finds none recorded — before the end
is recorded, which is why it is a row of its own: a row in `subscription_ends`
would read as an end, and the run would never hold the tenant. A cancellation
declared again before it lands records the announcement where it has none
(`SC-CANC-032`); one the application declared, or one declared before the table
was adopted, has none until its tenant declares it again, and an end at once
whose announcement could not be recorded has none: the end is given its day when
it is recorded.

**Recorded for every download, beside the end.** Where the application produces
the tenant's export through `TenantDataExportPort`, the platform writes a row here
once the application has handed the whole file over and before the file is
sent, so no file leaves without its row and no row claims a file that was not
produced. Where the application delivers the export itself, it reports each
download once the whole file has gone out (`TenantExportDeliveryService`), and
the row is written then: a download that broke off, or that it does not report,
leaves none, and neither does a `HEAD`, which carries no file. Either way a row
shows that the file was produced or delivered for that request, not that it was
saved. Two downloads are two rows. The operator reads them, the oldest first,
beside the ended subscription on the tenant's page.

### The installation's mark

| Entity                                    | Identity / uniqueness                  | Notes                                                                                                                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InstallationMark` (`installation_marks`) | one row, `id = 'installation'` (CHECK) | The identifier of the installation this database belongs to (`SC-PRIV-021`), whether it is a test operation (`testOperation`, false unless the operator says so), `markedAt`, and `markedBy`, the operator who marked it as the audit log tags an actor. |

**Written by the operator only.** No start writes the row: the first process to
start against a database after the migration would otherwise claim it for its
own environment, a developer's against a shared database among them. The row
lands through `<app> installation mark`, only where none stands, and is replaced
only with `--replace`, and only while the identifier and the operation it
replaces still stand — both conditions are the write's own
(`InstallationMarkPort.markIfUnmarked`, `replace`), so of two operators marking
at once one lands and the other is told which. A tenant is deleted only where
the row names the identifier of the environment the process runs in. The `CHECK`
on `installation_marks.id` holds the table to one row, as on `applied_settings`.

**The operation is the documents'.** Each invoice and each confirmation copies
`testOperation` from the mark when it is issued or first rendered, and every
rendering after reads its own copy (`SC-AUD-019`), so changing the mark never
changes a document. Once one exists the mark keeps the operation the documents
recorded (`SC-AUD-023`), and a start that issues invoices refuses where they
disagree; an operator's command line starts there, and refuses the documents
instead. The column is false unless the document was made in a test operation.

### Tenant deletions

| Entity                                                                | Identity / uniqueness                                                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SubscriberTenantDeletion` (`subscriber_tenant_deletions`)            | `id`; one row per `tenantId`                                                                  | The record of one tenant's deletion, kept with its subscriber (`SC-PRIV-023`): the subscription and the end it was deleted for, `deletesOn`, `exportOfferedFrom` and `exportBlockedBySuspension` (`SC-PRIV-024`), what the tenant was told to keep, the subscriber's commercial record counted before the first store erased and as the deletion closed (`commercialBefore`, `commercialAfter`), `startedAt`, `claimedAt` while a run holds it, `attempts`, `lastFailure` — a step, a store and a code, never a message —, `halt`, and `closedAt` once every store confirmed. Names no person. |
| `SubscriberTenantDeletionStore` (`subscriber_tenant_deletion_stores`) | deletion + store unique; deletion + position unique                                           | One store of the application's in a deletion, by its eraser's name, at its place in the order: `countedAt` and `erasedAt`, each written once (invariant 24).                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SubscriberTenantDeletionCount` (`subscriber_tenant_deletion_counts`) | deletion + kind + store + category unique; one `kept` row per category (partial unique index) | A number per category: what a store held for the tenant before it erased (`erased`, with the store's name), or what the tenant was told to keep itself (`kept`, with no store and with the application's words for the category by locale in `labels`).                                                                                                                                                                                                                                                                                                                                        |

**Kept with the subscriber, not the tenant.** The tenant is what is deleted,
and the record is the proof that it was, which the subscriber keeps as it keeps
its contracts and invoices (ADR 0012). The keys towards the subscriber and
within the record restrict, so a subscriber with a deletion cannot be deleted
from under it; `tenantId`, `subscriptionId` and `subscriptionEndId` are values.
Joining a returning customer's subscriber moves its records with the rest of
what it owns.

**Begun with a reason, closed with roles.** The quarter-hourly run begins a
deletion by writing its record and a `deleting` reason on the tenant in one
transaction, under a lock on the tenant's open `ended` reason (invariant 25).
It closes the record in one transaction with what the tenant's rows say of
who acted (invariant 26): the reasons, the end, the day the tenant was told and
the downloads of its export name the role somebody acted in — `tenant-admin`,
`operator` or `run` — instead of an actor tag or a user id, the reasons lose
their `note`, and the notices their recipients. In the same transaction the
run lifts every reason of the tenant still open but the `deleting` one, which
stays open (`SC-PRIV-025`).

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
   operator's request. A tenant's read of its subscriber's invoices and contract
   confirmations (`TenantInvoiceService`) is the one read of a tenant's that
   reaches other tenants' rows: an earlier tenant's invoices keep that tenant's
   id after a join, so it runs inside `RlsBypassPort`, by the subscriber of the
   session's tenant and nothing the request names. Two checks of a tenant's
   request read inside `RlsBypassPort` as well, because they run in guards and
   interceptors, before the application opens the request's frame: the access
   state (`TenantAccessService`) — the tenant's reasons, the invoice and the end
   they name, and whether an invoice is open — and what the tenant's plan
   allows, its subscription read by `SubscriptionPlanResolver` for the default
   feature guard and the quota interceptor, and by
   `EntitlementService.computeLimits` with the contract in force and the
   add-ons for `FeatureGuard`. Both read by the tenant the session names, so
   their answer is the same in a guard, a handler, a job and an operator's
   route (`SC-SEC-020`). The record of a download the application delivered
   itself (`TenantExportDeliveryService`) reads the tenant's end and writes the
   row inside `RlsBypassPort` as well, by the tenant the session names: the
   application reports it once its response has gone out, after its handler
   returned, in no frame its interceptor can be relied on to have kept open. A
   `QuotaProvider`'s count and a plan resolver of the application's own are the
   application's reads, in the caller's frame.
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
15. **A feature has one withdrawal not lifted, and a lift lands once.**
    `FeatureWithdrawalRepository.create` writes a withdrawal only where none of
    the feature is open — the partial unique index decides, so two operators
    announcing at the same moment land one, and the other is answered `null` —
    `lift` records a lift only on a withdrawal not lifted yet, and `markTold`
    marks a withdrawal told only once. Each runs on the transaction it is given,
    so the mark that a withdrawal was told and the notices telling of it are
    written together or not at all.
16. **Ending at once ends what was read.** `TenantSubscriptionWritePort.endNow`
    and `SubscriptionBundleRepository.endNow` end a subscription or a booking
    cancelled for a later date at the moment named, and only while its
    cancellation is still the one the caller read. One whose cancellation moved,
    was taken back or has already ended it at once is left as it is, and one
    not cancelled is not ended here.
    `SubscriptionBundleRepository.restoreCancellation` puts a booking ended at
    once back on the cancellation it had, and only while both its
    cancellation fields are still the moment it was ended at.
17. **An invoice's file is recorded before it is archived, and archived once.**
    `SubscriptionInvoiceRepository.recordRendering` writes the checksum
    conflict-free on the invoice: a second rendering with the same checksum is
    the same write, another one is refused with
    `SUBSCRIPTION_INVOICE_DOCUMENT_CHANGED`. Only `replaceRendering` puts
    another in its place, conditional on the checksum the caller read and on
    nothing being archived, so of two runs replacing it one does; and
    `markArchived` confirms only the checksum recorded, so the record and the
    archive name the same file. `InvoiceArchivePort.store` holds a file to the
    first-write rule as well, and the triggers of
    `1.0-an-invoice-document-is-archived.postgres.sql` refuse every update,
    delete and truncate of `subscription_invoice_archive`, whoever asks; the
    start refuses invoices where they are missing or disabled. The mail is
    claimed with a conditional update, as a notice is (invariant 12), so of
    several instances one sends it, and a claim older than the lease is taken
    on by the next run.
18. **A version of the terms is archived once.** `TermsArchivePort.store`
    writes conflict-free on the version: the same checksum again is the same
    write, another one is refused with `TERMS_VERSION_CHANGED` and the first
    stays, so of two starts archiving one version, both with the same file,
    one row is written. The triggers of
    `1.0-the-terms-are-a-version-and-a-file.postgres.sql` refuse every
    update, delete and truncate of `terms_versions`, whoever asks; the start
    refuses terms where they are missing or disabled.
19. **A contract's confirmation is recorded before it is archived, and
    archived once.** `ContractConfirmationRepository` makes the writes of an
    invoice's document (invariant 17), keyed by the contract, and lists only
    the contracts whose `confirmationDue` is set — which the contract
    repositories write on every contract they create, and the column's
    default leaves unset on every contract written before. The
    triggers of `1.0-a-contract-confirmation-is-archived.postgres.sql` refuse
    every update, delete and truncate of `contract_confirmation_archive`; the
    start refuses invoicing where they are missing or disabled.
20. **A tenant holds one open reason per kind and reference, and a lift lands
    once.** `TenantAccessHoldPort.record` inserts only where the same reason is
    not open — a suspension has no reference, and the partial unique index
    reads it as empty, so two operators suspending at once record one — and
    `lift` closes a reason only while it is still open.
21. **A subscription has one end that stands.** `SubscriptionEndPort.record`
    inserts only where the subscription has no end that is not lifted — the
    partial unique index on `subscriptionId` holds it — and answers null
    otherwise, leaving that end and its deletion day as they were. `lift` sets
    `liftedAt` on it and on its announcement in one transaction, once a new
    subscription took the tenant back (`SC-CANC-034`); an end recorded after
    that is a row of its own, with a deletion day of its own.
22. **An end is told one deletion day.** `SubscriptionEndPort.announce`
    inserts only where the subscription has no announcement that is not lifted,
    and none for the same `endsAt` — the partial unique index on
    `subscriptionId` and the unique key on `subscriptionId` and `endsAt` hold
    it — and answers null otherwise, leaving the first as it was. An
    announcement is not an end: recording an end neither needs one nor removes
    it.
23. **Every download of a tenant's export is kept.**
    `SubscriptionEndPort.recordExportDownload` inserts a row each time it is
    asked — no key refuses a second, even one by the same person at the same
    moment — and `listExportDownloadsFor` answers the downloads of several
    subscriptions in one read, the oldest first.
24. **A tenant's deletion begins once, and each of its parts is recorded once.**
    `TenantDeletionRecordPort.begin` writes a record only where the tenant has
    none — the unique key on `tenantId` decides, so of two runs beginning at
    once one writes — and in the caller's transaction. `claim` takes an open
    record only where no run holds it or the claim was taken before the lease
    began, `renew` and `release` land only under the claim the caller holds,
    and `close` closes a record once. A store's counts and its confirmation are
    written only where none stands, so the counts taken before the first store
    erased are the ones kept.
25. **A deletion begins on a reason that is still open.**
    `TenantAccessHoldPort.lockOpen` locks an open reason for the rest of the
    transaction (`SELECT … FOR UPDATE`) and answers null where it is lifted.
    The run takes that lock on the tenant's `ended` reason before it begins
    the deletion, and `record` and `lift` write in the transaction they are
    given, so a deletion and a lift of that reason that race act on it one
    after the other.
26. **What a deleted tenant's rows say of who acted is written together.**
    `TenantAccessHoldPort.replaceActors` and `forgetNotes`,
    `SubscriptionEndPort.replaceActors` and
    `SubscriptionNoticeRepository.forgetRecipients` write in the transaction
    they are given and touch only the rows named or the tenant's own.
    `forgetRecipients` keeps `recipientCount` — counted from `recipients` where
    it was never written — and a notice confirmed after its recipients were
    forgotten keeps its count and no recipients.

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
