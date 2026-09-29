---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': major
'@saasicat/ui-vue-tenant': patch
---

Show a subscriber the price of the plan version they are bound to

The plan card read the price off the catalogue, which lists what a new
customer pays. After a new version of the plan that is not what a subscriber
on the older one pays, and the card showed them the newer price
(`SC-SUB-019`).

- `GET billing/usage` answers with `planPriceNet`: what the plan costs per
  billing cycle, net, at the version the subscription is bound to, priced by
  the rules the contract freeze bills it by. Where the plan repository does not
  read versions (`findVersionById`), or the subscription is bound to none, the
  catalogue's price stands in. It is `null` where the plan has no list price in
  the rhythm, including a version sold under a special contract, and where the
  version bound cannot be read — the plan repository does not find it, or
  finds a version of another plan. The catalogue's price there would be the
  newest one; the rest of the account still answers, and the case is logged.
- The plan-change preview refuses a change for such a subscription with
  `BOUND_PLAN_VERSION_UNREADABLE` (422) rather than quoting it from the
  catalogue.
- `PlanChangePreviewService.planPriceNet(subscription)` is where that is read,
  and the preview's current price comes from the same place.
- `UsageSnapshotShape` in `@saasicat/ui-vue` carries `planPriceNet`, required:
  a fixture typed as that shape adds the field.
- `TenantPlanSection` shows `planPriceNet` on the plan card rather than the
  catalogue's price.
