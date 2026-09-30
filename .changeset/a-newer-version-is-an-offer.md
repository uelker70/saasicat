---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
---

Read a newer version of a subscriber's plan as an offer, classified against
the version bound

A subscription keeps the plan version it is bound to. A newer one is now
readable as an offer (`SC-SUB-020`): `GET billing/version-offer` answers
`{ offer }` with both versions side by side — features, quotas and the net
price in each rhythm — the kind of offer, and when a switch taken now would
take effect. `offer` is `null` where there is nothing the subscription could
take. Every user of the tenant can read it. The switch itself is not part of
this release.

- The kind is judged against the version bound, not against the candidate's
  predecessor and not by the flag set at publish. A feature missing or a quota
  lower **takes something away**, whatever the price, and would take effect at
  the end of the running term — the trial end, or the later of the period end
  and the minimum term. Otherwise a price higher in any rhythm, or a rhythm no
  longer sold, is **more for more**; otherwise it is an **improvement**. Both
  would take effect at once.
- The version offered is the one a booking made now would bind: the version
  active by its validity window where the plan repository reads windows, the
  newest live one where it does not. It is offered only when it is newer than
  the version bound, sold in the subscription's rhythm, and not on a plan in
  `selfServiceBlockedPlans`; not once a cancellation has landed, and not while
  a scheduled change of plan or rhythm or a pending version has yet to land —
  the offer is judged against what the subscriber will have.
- `classifyVersionOffer(bound, candidate)` in `@saasicat/core` is the rule, and
  `isVersionActiveAt(version, asOf)` the validity window of
  `buildActivePlanVersionWhere` for a row already read.
- `useTenantBilling().loadVersionOffer()` in `@saasicat/ui-vue` reads it; the
  response type is `VersionOfferView` from `@saasicat/core`.

Nothing to wire: the route comes with `tenantBilling` and reads the plan
repository the catalogue is given. A repository without `findVersionById`
yields no offer.
