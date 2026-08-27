---
'@saasicat/ui-vue-tenant': minor
'@saasicat/ui-vue': minor
---

Let a tenant on a yearly plan choose whether an add-on is billed monthly or yearly, and stop quoting a price that is not the one being charged.

A bundle's term may not outlast the plan it hangs on, so a yearly add-on beside a monthly plan is refused — which leaves a real choice only on a yearly plan. There the tenant used to get the plan's rhythm silently, with no way to ask for the other one, while every card read "net/month". On a yearly plan that figure was the monthly price and the booking was created yearly, so the number the tenant compared bundles by was not the number they were charged. The confirmation dialog did show the real amount before anyone agreed, so nobody was billed unannounced.

`TenantBundleStore` now offers the rhythm above the cards, preselected to the plan's — a tenant who touches nothing gets exactly what they got before. The card's price and unit follow the selection, the booking carries it, and a bundle that carries no price in the selected rhythm is shown as unavailable in it rather than as a button the server would refuse. A booked bundle states the rhythm it was actually booked in, which needed `billingCycle` on `SubscriptionBundleShape` — the API already sent it.

On a monthly plan nothing changes and no control appears: a question with one answer is not a question.
