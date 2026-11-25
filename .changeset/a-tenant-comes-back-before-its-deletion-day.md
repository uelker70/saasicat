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

A tenant whose subscription ended can subscribe again before its deletion day

Until its deletion day, the administrator of a tenant whose subscription
ended takes out a new subscription at the catalogue's current terms: the
version on sale its preview showed, from the moment it confirms, without a
trial, an add-on or a code (`SC-CANC-034`, which supersedes `SC-CANC-028`).
The new subscription lifts the end, its deletion day and the read-only state
that end put the tenant in; an invoice still unpaid keeps the tenant
read-only until it is paid. A later end gets a deletion day of its own. From
the deletion day on, in the installation's zone, and while the tenant is
suspended or being deleted, a return is refused.

- `POST billing/subscription/return` and its `/preview` take the plan, the
  rhythm, the version the preview showed and the deletion day it named. A
  return is refused as a plan change to that plan would be; a pilot, limits
  and a price of the operator's own end with the old subscription, and so do
  its add-on bookings. Where a payment gateway is wired, a confirmed payment
  method comes first, and a read-only tenant may enter one (`SC-ADM-060`,
  which supersedes `SC-ADM-055`).
- `TenantAccessBanner` offers "Subscribe again" to whoever the server says
  may (`mayReturn`), in a dialog that states the price, the first period, the
  notice and the deletion it lifts; `TenantPlanSection` offers the same dialog
  on the plan card of an ended subscription. The banner now requires
  `formatCurrency`, as `TenantPlanSection` does; `useTenantReturn` is the
  composable beneath it.
- A checkout offer concluded for a tenant whose subscription ended lifts the
  end in the same transaction. An application that concludes in a way of its
  own calls `SubscriptionReturnService.takeBackWithin` in its transaction and
  marks its route `@Returns()`.
- Breaking for an implementation of your own: `SubscriptionEndPort.lift`,
  `TenantSubscriptionWritePort.startAgain` and `ContractFreezePort.composeFor`
  are new. Apply
  `1.0-subscription-ends-are-lifted-by-a-new-subscription.postgres.sql`.
- Fixed: a plan change refused with `PLAN_CHANGE_QUOTE_CHANGED` carries its
  preview with the days of its moments, so the day of a scheduled change
  shows instead of a dash.
