---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A term is a term: minimum term, notice period, and when a change lands

The rules a subscription runs by were partly implicit and partly in the wrong
layer. This makes them explicit and puts each one where it can be read.

**An immediate change may improve the service; it may not shorten the
commitment.** `changeType` collapsed "a better plan" and "a shorter period" into
one word, so moving from a yearly STARTER to a monthly PRO classified as
`UPGRADE`, applied immediately, and ended the yearly commitment early. Plan
direction and cycle direction are two answers now (`planDirection`,
`cycleDirection` on the preview), and only an upgrade that does not shorten the
cycle takes effect today.

**A cancellation is a declaration; when it lands is decided, not asked for.**
`POST /billing/cancel` no longer accepts `immediately` — a tenant could use it to
end a term they were inside. The date comes from the minimum term and the
configured notice period. `useTenantBilling().cancelSubscription()` therefore
takes no argument and returns the dates instead.

**`canceledAt` and `canceledEffectiveAt` are two fields.** They were one, which
made a subscription cancelled in month three of a year look finished — it runs,
is billed and keeps every entitlement until the term ends. `Subscription` gains
`minimumTermUntil` and `canceledEffectiveAt`; the renewal reads the second, so a
declared cancellation no longer stops a period from rolling and a landed one
does.

**A notice period is configurable and zero by default.** `cancellationNoticeDays`
on the billing module. With no window there is no door to be shut out of; where
one is configured the cut is hard, and a declaration made after it lands at the
end of the _following_ period.

**A prorated upgrade never asks for less than nothing.** The formula is
unchanged — `(target − current) × remaining ÷ period` — and its result is now
floored at zero, with `rawDeltaNet` and `isFree` beside it so a page can say
"free upgrade" rather than showing a credit this platform does not pay.

**The tenant sees what happens and when.** Three changes arrive later than a
reader expects — an upgrade with a shortened cycle, a downgrade, a cycle change
— and each is acknowledged rather than announced: the consequence is the
heading, the date is in bold, and the confirmation stays locked until it is
ticked. A downgrade lists the features it costs. A cancelled subscription shows
its end date instead of the word "cancelled".

**The timing never travels from the client.** `POST /billing/plan` no longer
accepts `effectiveImmediately`, and `useTenantBilling().changePlan()` no longer
takes it: the route derives the timing from the same preview the wizard renders.
It used to branch on the flag under a comment promising the server-side check
"prevents bypass via a direct API call" — it checked the blockers and left the
one decision that carries money to the caller.

**A period boundary on a month end stays on a month end.** `advanceOneCycle`
overflowed: 31 January plus a month was 3 March, and 29 February plus a year was
1 March. Pre-existing, invisible while the result was only a period boundary,
and reported to a customer as a contract end date now.

**Cancelling twice does not move the date.** A repeat returns the existing
cancellation and writes nothing. With a notice period configured, recomputing it
against a later `now` could land it a whole period further out — an on-time
declaration landing January 2027, retried after the deadline, became January 2028.

**The date the page showed is the date that applies.** `POST /billing/cancel`
accepts an optional `expectedEffectiveAt` and refuses with
`CANCELLATION_TERMS_CHANGED` when its own answer differs, so a dialog opened
before a notice deadline and confirmed after it cannot deliver a date the
customer never saw.

**Breaking for anyone implementing the ports.**
`TenantSubscriptionWritePort.cancelSubscription` now takes
`{ canceledAt, effectiveAt, terminateNow }` and returns `canceledEffectiveAt`;
it used to compute the effective date itself from a boolean, which put a
commercial decision in a persistence adapter where neither the term nor the
notice period is visible. `SubscriptionUsageRecord` gains three optional fields,
and `GET /billing/usage` answers with `cancellation` — what cancelling right now
would do, so a page can state the date before the customer confirms.
