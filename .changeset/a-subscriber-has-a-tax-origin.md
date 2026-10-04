---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/cli': minor
---

A subscriber has a tax origin, and a contract records its tax treatment

The first part of the tax adapter (ADR 0013): what an adapter decides a
subscriber's tax from, and where its answers are kept. Nothing asks an
adapter yet, so no amount changes; `@saasicat/tax-de` and the refusal of a
case it cannot treat follow.

- **The tax port** in `@saasicat/core`: `TaxAdapter` decides a
  `TaxTreatment` — its kind, rate and note, with the adapter's name and
  version — from the issuer, the period and the subscriber's
  `SubscriberTaxOrigin`, or answers that the case is not supported, and
  checks a VAT id (`VatIdCheckOutcome`). A check that cannot complete is no
  result. `taxOriginOf(subscriber, check)` counts a VAT id as validated only
  when the check that counts for it is of that very number and found it
  valid.
- **Whether a subscriber is a business** is recorded, never derived from a
  tax identifier: `business` — `true`, `false`, or `null` for not stated —
  taken at creation and changed by `SubscriberService.changeBusinessStatus`.
  A contact change naming it is refused
  (`SUBSCRIBER_BUSINESS_STATUS_NOT_A_CONTACT`).
- **Every check of a VAT id is kept as it was answered** and never
  rewritten (`SubscriberVatIdCheck`, `recordVatIdCheck`, `listVatIdChecks`):
  it is the evidence a reverse charge rests on. The one that counts is the
  latest completed check of the number the subscriber holds, completed since
  it holds it (`vatIdSince`), never an older one written later, and none once
  the number is corrected (`findCurrentVatIdCheck`, `keepsVatIdCheck`).
- **Every change of the tax origin is recorded with who made it**
  (`SubscriberTaxOriginChange`, `listTaxOriginChanges`), whichever way it
  arrives — a contact change of the country, a correction of the VAT id, a
  change of the business status — in the transaction that makes it, dated
  while the write holds the subscriber's row lock and listed in the order
  the database numbered it, which the dates follow on one clock.
- **A change of the contact details names who makes it**:
  `changeContact` and `changeContactOfTenant` take `changedBy`
  (`SUBSCRIBER_CHANGE_ACTOR_REQUIRED` without), and the tenant's
  `PATCH billing/details` passes the user behind the request.
- **A VAT id is stored in one form**, upper case and without spaces, dots
  or hyphens, so the same number in another spelling moves nothing.
- **A correction of the legal identity is dated by the write that makes
  it**, while it holds the row lock, numbered by the database (`seq` on
  `SubscriberCorrection`) and listed by that number. `SubscriberCorrectionData`
  no longer carries `correctedAt`; a correction that moves the VAT id and
  the change it records share one date.
- **A contract records its tax treatment** (`taxTreatment`), null where no
  adapter was asked.
- **`saasicat schema check` reports a fragment taken halfway** — one model
  of it adopted, another left out that the bundle cannot do without — as
  drift, rather than as a fragment not adopted.
- The Prisma fragments `13-subscriber.prisma` and
  `08-subscription-contract.prisma`, both shipped adapters, the persistence
  contract, and two migrations:
  `1.0-a-subscriber-has-a-tax-origin.postgres.sql`, which backfills nothing,
  and `1.0-a-correction-carries-its-order.postgres.sql`, which numbers the
  corrections already recorded in the order they were listed.

What an application does: adopt the fragment changes — both new models are
required wherever the shipped subscriber repositories are used — run both
migrations once, before `db push`, and give the two new tables the row-level
policy its subscriber tables carry. Code that calls `changeContact` or
`changeContactOfTenant` passes who it acts for. A hand-written
`SubscriberRepository` takes `changedBy` in `updateContact`, dates a
correction itself and lists corrections by `seq`, and adds
`changeBusinessStatus`, `recordVatIdCheck`, `findCurrentVatIdCheck`,
`listVatIdChecks` and `listTaxOriginChanges`; a hand-written
`SubscriptionContractRepository` writes and reads `taxTreatment`; and code
that builds a `SubscriberRecord`, `SubscriptionContractRecord` or
`CreateSubscriberData` by hand adds `business` or `taxTreatment`. The
upgrade guide has the steps.

`SC-PRIC-038`, `SC-PRIC-040` and `SC-PRIC-043` stay decided, not yet
delivered: this is where their answers are kept, and they are delivered once
sign-up and the conclusion of a contract ask the adapter.
