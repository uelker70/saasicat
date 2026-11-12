---
'@saasicat/core': minor
'@saasicat/nest': minor
---

A tenant that is read-only may still leave

A tenant that is read-only, for an invoice unpaid on its due date or a
subscription that ended, could not cancel: every route a tenant leaves through
writes, and read-only refused it. Its administrator can now declare the
cancellation of its subscription (`POST billing/cancel`), cancel an add-on
(`DELETE billing/subscription-bundles/:id`), and end either at once while a
feature is withdrawn (`POST billing/feature-withdrawals/:id/end` and
`…/bookings/:subscriptionBundleId/end`), whatever it owes. What it owes stays
owed, and it stays read-only for as long as its reason holds. A suspended
tenant, and one being deleted, still cannot; reinstating an add-on, booking
one and changing the plan stay refused.

The four routes carry the new mark `leaves` (`@Leaves()`), which
`TenantAccessService.enforce` reads, so an application's own authentication
guard lets them through without a change; a route of the application's own
through which a tenant leaves carries it too. `assertAllowed` takes
`leaves: true` for the same exception where there is no request.
`TenantAccessMark` gains the member `'leaves'`: an exhaustive switch over it
gains a case.
