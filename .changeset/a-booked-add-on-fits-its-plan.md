---
'@saasicat/core': patch
'@saasicat/nest': major
'@saasicat/ui-vue': patch
'@saasicat/ui-vue-tenant': patch
---

Keep a booked add-on and the plan it runs beside in step

A plan change, a retirement and an add-on booking now ask one question the
same way: can this add-on run beside that plan, allowed there, priced there in
the rhythm the booking is billed in, and in no longer a rhythm than the plan's.
A plan change asked only about the rhythm, so an add-on sold for one plan went
on running after a move to another, at a price nobody had set. And a booking
made after a change was scheduled could land on the plan that change moves to,
since a scheduled change lands without looking at add-ons.

- A plan change is refused while an add-on still booked on the day it lands
  cannot run on the target plan (`SC-CHG-024`): the tenant's own change, the
  plan chosen at onboarding, which is asked about today because it applies at
  once, and the early switch to the replacement of a retirement. The new code
  `BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN` names the add-on, the plan and the
  earliest day the add-on could end. The rhythm part keeps
  `BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE`, which now names the add-on and that
  day too. The day is the one a cancellation would land on, never after the
  subscription ends, and both sentences say what gets past the refusal: the
  add-on cancelled, and a change taking effect on or after that day.
- A booking, its preview, and the reinstatement of a cancelled booking refuse
  an add-on that cannot run on a plan the subscription is already set to move
  to (`SC-BUN-037`), with the new code `BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN`,
  or `BUNDLE_CANNOT_RUN_ON_UPCOMING_CYCLE` where only the rhythm is in the
  way (both `planKey`, `billingCycle`, `from`): the target of a scheduled
  change from the day it lands, in the rhythm it lands in, and the replacement
  of a retirement the subscription has been told of from its date, for as long
  as the subscription is on the version retired. A reinstatement is refused,
  too, where the add-on cannot run on the plan of today.
- A retirement is refused while a subscription it reaches still holds, at its
  date, an add-on that cannot run beside the replacement in the rhythm billed
  then (`SC-SUB-037`), with `RETIREMENT_REPLACEMENT_CANNOT_CARRY_BUNDLES`,
  which the plan cockpit words in English and German.
- The tenant's add-on dialog shows each reason a booking cannot be made in the
  language chosen, through the message catalogue, rather than the English the
  backend sends; two reasons with the same code are shown as two.
- The booking preview names every reason an add-on cannot run beside the plan
  of today at once, as before. `BUNDLE_INCOMPATIBLE_WITH_PLAN` from a booking
  carries `allowedPlanKeys` as one comma-separated string, as the preview's
  always did.

Breaking where an application wires the modules by hand or calls the booking
service itself; `SaaSiCatModule` does all of it.

- `TenantBillingModule.forRoot` takes `bundleRepository` beside
  `subscriptionBundleRepository`, and refuses to start with the one and
  without the other. `SaaSiCatModule` refuses a persistence bundle that has
  the bookings without the add-on versions
  (`tenant-billing.requires-bundle-catalogue`).
- The add-on route needs `PLANS_AHEAD_TOKEN`, which `TenantBillingModule`
  exports; a module that mounts the route without tenant billing in its scope
  no longer starts.
- `SubscriptionBundlesService.addBundleToSubscription` and
  `SubscriptionBundlePreviewContext` require `plansAhead`: what the provider
  behind `PLANS_AHEAD_TOKEN` answers for the subscription, or an empty list
  only where nothing is scheduled and no retirement was told.
- `cancelBundleFromSubscription` requires `subscriptionId`, and
  `reactivateBundle` takes one input naming the subscription, the booking, the
  plan of today and the plans ahead. Both answer a booking of any other
  subscription as not found.
