---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
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
cycle takes effect today. A trial is the exception, because it commits to
nothing: its cycle says how it will be billed once it converts, not a period the
customer is inside, so an upgrade during a trial takes effect at once whichever
cycle it picks.

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

**A trial has an end, not a term.** A trial carries a period end like any other
subscription, and reading it as a commitment made the two rules a customer meets
disagree: a plan change during a trial applies at once because there is nothing
to protect, while a cancellation was measured against a term that does not
exist. With a notice period configured that was not a difference of weeks — a
trial ending inside the window is already past its deadline, so cancelling a
yearly-cycle trial bought a year. A trial's cancellation now lands when the
trial does, and no notice window applies to it.

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
customer never saw. Where the answer _is_ the moment of asking — a subscription
with nothing left to run — the check accepts any reading of the clock up to now
and refuses only a date still in the future; comparing those two readings for
equality would refuse every confirmation, including each retry.

**A cancellation written before the fields split is still a cancellation.**
`GET /billing/usage` applies the same fallback the renewal and the cancel route
apply, so a row whose effective date sits in `canceledAt` reports it. Read
strictly, it told the page nothing had been cancelled — which hid the end date
and went on offering to cancel it again.

**A cancellation that has taken effect ends the entitlements.** It did not.
Nothing on the entitlement path read a cancellation, so a subscription that
ended last January was granted exactly what it was granted while active — same
plan, same features, same quotas, and `FeatureGuard` let it through. The root
was that `SubscriptionRecord`, the record that path reads, carried neither date;
it now requires both, so an adapter cannot omit them silently. A landed
cancellation grants nothing by default, and `canceledEntitlementPlan` on
`EntitlementResolutionConfig` names a floor for installations that want one — a
read-only tier to export from, a free plan to fall back to. A cancellation that
is merely declared still changes nothing, which is the same rule as before.
`@saasicat/adapter-drizzle` gained the two columns in its query map to supply
them. **This removes access from tenants whose cancellation has already landed**;
[the upgrade guide](https://github.com/uelker70/saasicat/blob/main/docs/guides/upgrade-to-1.0.md)
carries the query that lists
them.

**The page tells an ended subscription from a cancelled one.** Nothing
transitions the status column when a cancellation lands, so a subscription that
ended last month still reads `ACTIVE` there. The tenant plan card believed it: a
positive badge, a next billing date, and a sentence promising nothing would
change before a date already in the past — beside a "change plan" button whose
route now refuses. It reads the date instead, shows the subscription as ended,
and offers neither act. A cancellation still to come is unaffected and says so:
that subscription runs, is billed and keeps everything until the date.

**A repeated cancellation no longer explains itself with a date it cannot
know.** The repeat reports what is stored — that it was already cancelled, and
when it lands. `termEndsAt`, `noticeDeadline` and `afterNoticeDeadline` are null
there, because the decision behind them was taken once against a `now` that has
passed; deriving them from the effective date reported a declaration that landed
a period late as an on-time one. `CancellationResultShape.afterNoticeDeadline`
is therefore `boolean | null`.

**A cancellation is a boundary, and two writes used to cross it.** A plan change
and a cancellation are two decisions about one subscription, and neither could
see the other. A subscription that had already ended still accepted an
upgrade — applied, prorated and charged — while entitlement resolution granted
nothing, because it reads the cancellation and the route did not; that route now
answers `SUBSCRIPTION_ENDED`. An immediate change on a subscription that is
cancelled but still running no longer opens a fresh billing period, which would
have sold a term the cancellation cuts short. And a change scheduled before the
customer cancelled is declined once the cancellation has landed, instead of
restarting the period and running the follow-up hooks on a term that is over —
`DuePendingPlanChange` carries the two dates for that decision. A cancellation
that has _not_ landed declines nothing: a customer who bought a further period
by cancelling late may still choose the plan they spend it on.

**A cancellation writes what it decided, not only when it lands.** Two things
follow from the date and neither is asked for. A subscription with nothing left
to run — a trial, or one still waiting for sales, with no period end and no
committed term — is now recorded as ended rather than left `ACTIVE` for good:
nothing downstream would ever have transitioned it. What entitlements a
cancelled subscription grants is unchanged and still under review. And a
declaration made after the notice window closed
extends the stored commitment to the period it bought, because every other
reader of the term end looks at `minimumTermUntil` — a downgrade scheduled
meanwhile would otherwise have landed at the old term end, inside the period the
customer had just paid for.

**Breaking for anyone implementing the ports.** `SubscriptionRecord`,
`SubscriptionUsageRecord` and `DuePendingPlanChange` require `canceledAt` and
`canceledEffectiveAt` — required rather than optional because
an adapter that omits them cannot tell a subscription that ends next January
from one that ended last January, and the silent answer is the wrong one.
`TenantSubscriptionWritePort.cancelSubscription` now takes
`{ canceledAt, effectiveAt, terminateNow, minimumTermUntil? }` and returns
`canceledEffectiveAt`;
it used to compute the effective date itself from a boolean, which put a
commercial decision in a persistence adapter where neither the term nor the
notice period is visible. `SubscriptionUsageRecord` gains three optional fields,
and `GET /billing/usage` answers with `cancellation` — what cancelling right now
would do, so a page can state the date before the customer confirms.
