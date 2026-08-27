---
'@saasicat/ui-vue-tenant': minor
'@saasicat/ui-vue': minor
---

Let a tenant on a yearly plan choose whether an add-on is billed monthly or
yearly, and stop quoting a price that is not the one being charged.

A bundle's term may not outlast the plan it hangs on, so a yearly add-on beside
a monthly plan is refused — which leaves a real choice only on a yearly plan.
There the tenant used to get the plan's rhythm silently, with no way to ask for
the other one, while every card read "net/month". On a yearly plan that figure
was the monthly price and the booking was created yearly, so the number the
tenant compared bundles by was not the number they were charged. The
confirmation dialog did show the real amount before anyone agreed, so nobody was
billed unannounced.

`TenantBundleStore` now offers the rhythm above the cards, preselected to the
plan's — a tenant who touches nothing gets exactly what they got before. The
card's price and unit follow the selection, the booking carries it, and a bundle
that carries no price in the selected rhythm is shown as unavailable in it
rather than as a button the server would refuse. A booked bundle states the
rhythm it was actually booked in, and the price it is actually billed at.

Two prices were wrong before, and both are fixed at the source rather than in
the view. `GET /billing/subscription-bundles` answered with the bundle's base
**monthly** price whatever the booking was, so a bundle at 9.90 monthly and
99.00 yearly reported 9.90 once booked yearly; it now returns `priceNet`,
resolved for the booking's own rhythm with the plan's `BundlePricingOverride`
applied. And the public catalogue has no tenant and therefore no plan, so it
serves base prices and reads a bundle priced only through an override as having
no price at all — a new `POST /billing/subscription-bundles/prices` resolves
them for the tenant's plan, and the store prices from that.

`SubscriptionBundleView.monthlyNet` is therefore now `priceNet: number | null`,
and `SubscriptionBundleShape` gains `priceNet` and `billingCycle`. A consumer
without the new prices endpoint keeps the catalogue's own figures, which is what
every consumer had before.

On a monthly plan nothing changes and no control appears: a question with one
answer is not a question.
