---
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/adapter-prisma': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A bundle runs in step with the plan that pays for it

A booked bundle had no period of its own. It was billed alongside the plan by
convention, which held only for as long as every bundle was billed in the plan's
rhythm. `subscription_bundles` now carries `billingCycle`, `currentPeriodStart`
and `currentPeriodEnd`, and one rule governs them: a bundle's periods end on the
day the plan's do. The first is short, from the booking to the next occurrence of
that day, and is charged pro rata for exactly that stretch; every one after it
runs anchor to anchor, and the last lands on the day the plan ends. Aligning at
booking means a bundle never has to be trimmed at the end, which is the case
where somebody was committed to more than they received.

A bundle may run in a shorter rhythm than its plan and never a longer one, so a
yearly bundle beside a monthly plan is refused with `BUNDLE_CYCLE_EXCEEDS_PLAN`
rather than modelled. The tenant preview now accepts the same `billingCycle` the
booking has always accepted — without it, asking for a monthly bundle beside a
yearly plan was quoted the yearly price, prorated across the plan's year, and
then charged the monthly one. It also prorates against the bundle's own cycle
rather than the plan's, and states what the booking commits to before it is
confirmed: the first period's end, the plan's end where there is one, and that a
period cut short by the plan ending is not refunded.

A bundle version can no longer be published without a price. Neither a base price
nor any plan override resolving one is refused with `BUNDLE_VERSION_NO_PRICE`,
and a booking whose plan and rhythm resolve no price is blocked with
`BUNDLE_NOT_PRICED_FOR_THIS_PLAN` instead of handing the features over for
nothing.

`computeNextBundlePeriod` is the decision half a renewal job calls, mirroring
`computeNextPeriod` for the plan. It both rolls a period that is over and opens
the first one for a bundle booked while its plan had no period — during a trial,
or before sales finished — which would otherwise keep granting its features
without ever acquiring a window to bill them in. It declines for a booking
billed with the plan, one whose plan has no paid period yet, one still running,
one whose cancellation has landed, and one whose plan has ended.

The window it returns stops at whichever ends the booking first — the plan's end
or the booking's own declared cancellation — and advances to the first boundary
after `now` rather than by one cycle, so a job that missed several months
catches up in a single write.

A plan change is blocked with `BUNDLE_CYCLE_EXCEEDS_PLAN` while an active
booking's rhythm would not fit the target cycle. The rule was previously
enforced only where a bundle is booked, so a yearly add-on survived a move from
a yearly plan to a monthly one and sat in a state the model calls impossible.

Cancelling a booking now takes effect at the end of the booking's own period
rather than the plan's. For a monthly bundle beside a yearly plan those are up
to eleven months apart, and reading the plan's boundary kept a cancelled booking
committed and billed until the annual renewal.

Existing bookings need a backfill; `docs/guides/upgrade-to-1.0.md` carries the
statement, the one call to add to the renewal job, and says which rows to leave
alone.
