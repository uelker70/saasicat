---
'@saasicat/nest': minor
---

Bundles booked after a contract was signed now take effect immediately.

`EntitlementService.deriveLimits` used to return a contract's frozen
`entitlementSnapshot` verbatim and never looked at the subscription's bundle
bookings. A bundle bought after signing therefore granted nothing until
something re-froze the contract — and where the optional `contractFreeze` hook
was not configured, that never happened, silently.

Active bookings are now merged on top of the contract limits (features as a set
union, quotas additive with `-1` dominance). Bundles the contract already
accounts for — via `originalBundleVersionIds` or a bundle line item — are
skipped, so their quotas are not counted twice. The frozen plan part stays
untouched.

Also: `SubscriptionBundleSnapshot` carries the new `bundleVersionId` field (used
for that de-duplication), and a bundle mutation without a configured
`contractFreeze` hook logs one warning per process instead of returning
silently.
