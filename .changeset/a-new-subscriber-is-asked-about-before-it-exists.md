---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
---

A new subscriber is asked about before it exists

Where `config/saas.yaml` names a tax adapter, a subscriber it cannot treat is
refused before it exists (`SC-PRIC-068`, `SC-REG-023`): a sign-up in step 4,
before the payment form opens, and a subscriber an application creates itself,
before the transaction that creates it. Without an adapter nothing is checked.

- **Step 4** takes `business` (whether the sign-up is a business) with the
  billing details, and asks the adapter over the contract the sign-up will
  have, from now and in the rhythm chosen. A case it cannot treat is refused
  with `422 TAX_TREATMENT_NOT_SUPPORTED` and the adapter's sentence while
  nothing is paid.
- **A VAT number is checked only where the treatment depends on it**: where the
  adapter supports no treatment from the details as given and a number is
  given, it is checked with the service the adapter names, and the adapter asked
  again. A check that does not complete refuses the step with the new code
  `503 TAX_VAT_ID_CHECK_NOT_COMPLETED`, to be tried again later, and is never
  read as a validation. Which numbers a treatment depends on stays the
  adapter's to say; `@saasicat/tax-de` is unchanged.
- **The check is kept** with the sign-up and taken over by the subscriber its
  activation creates, so its first contract is decided from it:
  `PendingRegistration` gains `business` and `vatIdCheck`,
  `subscriberFromRegistration` carries both, and `vatIdCheckFromStore` reads a
  check back from what a JSON column gives, a check it cannot read as none.
  Run `sql/1.0-a-sign-up-keeps-its-vat-id-check.postgres.sql` or adopt the two
  columns of `prisma-fragments/09-pending-registration.prisma`; a
  `PendingRegistrationRepository` of your own writes and reads both.
- **An application creating a subscriber itself** calls
  `SubscriberService.assessNewSubscriber(details, period)` before its
  transaction — `contractTaxPeriod` from `@saasicat/nest/billing` gives the
  period — and passes what it answers to `createForTenant`, which records the
  attached check with the subscriber on the transaction passed. Assessed details
  (they carry `vatIdCheck`, `null` included) are refused without a transaction.
  Step 4 refuses, as a wiring error, a `PendingRegistrationRepository` that does
  not give back the `business` and `vatIdCheck` it was given — with an adapter
  or without. `NewSubscriberDetails` gains `vatIdCheck`; a check of another
  number than the subscriber's is refused with `SUBSCRIBER_DETAIL_INVALID`
  (`field: 'vatIdCheck'`) before anything is written.
- A subscriber created another way — a backfill, a migration of existing
  tenants — is not refused here.
