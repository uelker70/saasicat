---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/ui-vue': minor
---

The operator corrects a subscriber's tax identity

The operator corrects a subscriber's legal name, VAT identification number and
tax number, and whether it acts as a business, beside the tenant — each with a
written reason and behind the second factor (`SC-SUB-041`). A VAT number a
correction gives, or the number held when the operator asks, is checked with
the tax adapter's service and the check kept whatever it found
(`SC-PRIC-071`), and the operator reads the subscriber's history: who changed
what, when and why, and every check (`SC-ADM-032`). A takeover by another legal
entity stays refused.

- **The change log of the tax origin keeps a `reason`.**
  `1.0-a-subscriber-has-a-tax-origin.postgres.sql`, new in this release, creates
  `subscriber_tax_origin_changes` with it, and `SubscriberTaxOriginChange` in
  `prisma-fragments/13-subscriber.prisma` declares it — no further file to run.
- **A change of the business status needs a reason.**
  `SubscriberService.changeBusinessStatus` takes `reason` beside `business`
  and `changedBy`, and refuses a blank one with the new code
  `422 SUBSCRIBER_BUSINESS_STATUS_REASON_REQUIRED`, and every change of the tax
  origin keeps its reason — the correction's, the business status's, `null`
  for a change of the country with the contact details. Your own
  `SubscriberRepository` writes and reads `reason`.
- **A corrected VAT number is checked.** `SubscriberService.correctIdentity`
  answers `{ correction, vatIdCheck }` instead of the correction alone: where a
  tax adapter decides and the correction gives another number, it is checked
  right after the correction is written, valid, invalid and not completed
  alike, and the correction stands whatever the check found; the next contract
  stays held back until a valid check counts. Since the check reaches an
  outside service, never call `correctIdentity` inside a transaction.
- **`SubscriberService.checkVatIdOf`** checks the number a subscriber holds
  again, named by `tenantId` or `subscriberId`, and keeps the check — refused
  with `409 TAX_VAT_ID_CHECK_NOT_AVAILABLE` without an adapter and with
  `422 SUBSCRIBER_VAT_ID_MISSING` without a number.
- **The operator's routes**, announced as `subscribers.correct` wherever the
  subscriber view is served, inside the RLS bypass and recorded in the audit
  log: `POST admin/tenants/:slug/subscriber/identity` and
  `…/business-status` behind the second factor, `…/vat-id-check` without it,
  and `GET …/history`, the latest first.
- **`@saasicat/ui-vue`.** `TenantDetailPage` offers both corrections in a
  dialog that asks for the reason and then for the second factor, the check
  where an adapter decides and a number is held, and the subscriber's history.
  `useSubscriberCorrections` carries the sequences for your own pages.
  `AdminFormDialog` keeps a form open, without an error, when its `submit`
  resolves `null`.
