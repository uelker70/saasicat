---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A newer version of a booked add-on is offered beside the booking

A booking keeps its add-on version, and a newer one of the same add-on is
offered beside it in the plan section and on the tenant's add-on page
(`SC-BUN-057`), judged with the price in the rhythm the booking is billed in.
An improvement and more for more are taken at once, keeping the booking's
period, terms and minimum term, and the journal charges what a dearer version
costs for the rest of the booking's period (origin `bundleChange`), nothing
otherwise (`SC-BUN-058`). One that takes something away is scheduled for the
end of the booking's term, and the quarter-hour run makes it then
(`SC-BUN-059`). With version notices on, each booking is told once
(`SC-BUN-060`).

- **Migration:** run `1.0-an-add-on-switch-waits-for-its-term.postgres.sql`
  before `db push`, then `constraints.postgres.sql`. `subscription_bundles`
  gains `pendingBundleVersionId` and `pendingVersionEffectiveAt`; fragments 05
  and 11 name the two relations between `BundleVersion` and
  `SubscriptionBundle`. A second run of the migration changes nothing.
- **Your port** is handed a new kind, `bundle-version-offered`
  (`BundleVersionOfferedNotice`). A port that switches on `kind` adds it.
- **A repository of your own** returns the two new fields and gains the
  optional `scheduleVersion`, `unscheduleVersion` and
  `listScheduledVersionsDue`; without them a version that takes something away
  is not offered. A contract harness without them declares `bookingsScheduled`.
- **Routes:** `POST /billing/subscription-bundles/:id/version-offer/accept`
  with `{ bundleVersionId }`, for the tenant's administrators and audited; a
  version that is no longer offered is refused with
  `BUNDLE_VERSION_OFFER_CHANGED` and the offer as it stands. The booking list
  carries `offer` and `pendingVersion`. The early switch to a
  retirement's replacement is audited too, and like the plan's switches it now
  needs the request to name its user.
- **Checkout:** `CheckoutOfferService.conclude` refuses a tenant whose contract
  is in force when the offer's would take effect, or begins after it
  (`CHECKOUT_OFFER_CONTRACT_IN_FORCE`, `SC-MKT-028`), and an offer naming
  another version of an add-on the tenant has booked
  (`CHECKOUT_OFFER_ADD_ON_BOOKED_IN_ANOTHER_VERSION`, `SC-MKT-029`).
- An application with a scheduler of its own calls
  `BundleVersionNoticeService.sendDue` and, after the moves,
  `BundleVersionSwitchRunService.switchDue`.
