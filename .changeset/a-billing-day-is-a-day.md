---
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
---

A subscription is billed on a day, and February no longer takes it

Period boundaries read their day from the previous boundary, and the previous
boundary had already been clamped to fit a shorter month. So a subscription
starting on the 31st was billed on the 28th from its first February onwards —
and on the 28th for the rest of its life. Three days lost once, silently, with
every later date measured from the wrong one: the renewal window, the notice
deadline, and the contract end a customer is told about.

`Subscription.billingAnchorDay` holds the day. It is written when a period
window opens — at activation and at a plan change that resets the window — and
never by a renewal, because reading its own previous result is exactly the drift
it exists to stop.

The anchor is a **day number**, clamped down where the month is too short and
not consumed by that clamp. An anchor of 31 gives 28 February and then 31 March.
An anchor of 30 gives 30 October, not the 31st: it is "the 30th", not "the end
of the month".

`advanceOneCycle`, `periodEndAfter` and `periodEndWithMinLead` take the anchor as
an optional last argument, and `PeriodRollInput` carries it. Omitted, every one
of them behaves exactly as before — so the column is additive, and an app that
does not read it keeps what it has.
