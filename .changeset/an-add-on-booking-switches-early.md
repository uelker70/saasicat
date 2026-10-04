---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A booking may switch to its retirement's replacement before the date

Until its date, a booking on an add-on version being retired may move to the
replacement at once, beside the add-on's notice in the plan section and on
`MySubscriptionBundlesPage` (`SC-BUN-054`). The switch keeps the booking, its
period, its terms and its rhythm, and writes the contract the move at the date
would have written, so nothing is left to move then.

- **The price is held until the date** (`SC-BUN-055`). Where the replacement
  costs more for the plan the add-on runs beside, in the booking's rhythm, the
  contract records the difference as a generated discount line, and the charge
  journal takes it off each of the booking's periods before the date. The
  difference stays as agreed when the plan changes after the switch. Where the
  replacement costs the same or less, its price applies from the booking's next
  period.
- **When it is open.** After a trial, for a booking that runs past the date —
  a cancellation landing after it stands — and only while neither the plan nor
  its rhythm changes before the date: a scheduled change, or a told retirement
  onto another plan, refuses it with `BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES`
  (`bundleName`, `date`); one onto another version of the same plan does not.
  Switching ends the cancellation without the minimum term.
- **The route** is `POST /billing/subscription-bundles/:id/retirement/switch`
  with `{ bundleVersionId }`, behind `TenantAdminGuard`; a page that showed
  another version is refused with `RETIREMENT_SWITCH_CHANGED` and the retirement
  as it stands. The booking list carries `retirementSwitch`, what switching now
  costs.
- **UI.** `useTenantBilling().switchBundleToReplacement` and
  `useTenantSubscriptionBundles().switchToReplacement`; `BundleRetiredNotice`
  offers the switch with a confirmation that says what it costs until the date
  and after it, and `TenantBundleStore` emits `switch` and takes `switchingId`
  and `note`. New catalogue keys `bundleRetiredSwitch*` and
  `bundleRetiredSwitched`.
- **The add-on list** no longer shows a retirement beside a booking whose
  subscription ends by the date: like a booking cancelled to end by then, it
  never moves (`SC-BUN-046`).
