---
title: Changing a plan
---

A plan change is where a tenant's money and a tenant's expectations meet, and both can be lost
quietly. The rules here decide two things: whether a change is allowed at all, and when it takes
effect. The second is the one that carries money, which is why the platform decides it rather than
the caller, and why the date a tenant saw is the date they get.

### SC-CHG-001 — The tenant says what to change to; the platform says when

🟢 Handing the timing to whoever is calling let a direct request end a yearly commitment the customer
was still inside. A wizard is not a guard.

_Source:_ #212 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/the-server-decides-when-a-change-lands.test.js`
    - a plan change is timed by the rules, not by the request
        - a caller asking for "immediately" on a deferred change is scheduled anyway
        - a caller asking for nothing on an immediate change still gets it today
        - the scheduled date is the preview's, not a second computation

<!-- END proof -->

### SC-CHG-002 — An immediate change may improve the service; it may not shorten the commitment

🟢 💰 Everything else waits for the term to end, which is where a shorter period may legitimately
begin.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - an immediate change may not shorten the term
        - the matrix is complete
        - ${label} takes effect ${expected ? 'now' : 'at term end'}

<!-- END proof -->

### SC-CHG-003 — An immediate upgrade extends the running term, it does not restart it

🟢 💰 The customer keeps the period they already paid for, the higher plan runs inside it, and only
the difference is charged for what is left of it. So an immediate upgrade never lengthens the
commitment.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-billing-day-survives-a-short-month.test.js`
    - a plan change reopens the window
        - and the day the customer is billed on moves with it
- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - an immediate change may not shorten the term
        - the matrix is complete
        - ${label} takes effect ${expected ? 'now' : 'at term end'}

<!-- END proof -->

### SC-CHG-004 — A yearly customer moving to a monthly higher plan gets it at the term end

🟢 They may have the monthly plan; they may not have it today, because starting it today would end
the yearly term they are inside. It is offered later rather than refused.

_Source:_ #212 · `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - the deferred upgrade explains itself
        - a yearly customer choosing a monthly higher plan is told why it waits
        - the same upgrade on the same cycle happens now and says nothing

<!-- END proof -->

### SC-CHG-005 — A downgrade takes effect at the end of the term

🟢 💰 Never immediately.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - a deferred change waits for the commitment, not just the period
        - the later of period end and minimum term is the effective date
        - without a commitment the period end still decides

<!-- END proof -->

### SC-CHG-006 — A deferred change lands at the later of the period end and the commitment

🟢 💰 A commitment that outlasts the period is what a notice period produces, and a change landing at
the period end would take effect inside it.

_Source:_ #212 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - a deferred change waits for the commitment, not just the period
        - the later of period end and minimum term is the effective date
        - without a commitment the period end still decides
- `packages/nest/tests/pending-plan-materialization.test.js`
    - materializes all due pending plan changes and invalidates each tenant
    - defaults to MONTHLY cycle when pendingBillingCycle is null
    - is non-fatal per tenant — one failure does not abort the run
    - no-op when nothing is due

<!-- END proof -->

### SC-CHG-007 — A change scheduled for the term end may take any billing rhythm

🟢 The term ends on that date either way, so the rhythm of the plan that starts there is free.

_Source:_ #212

### SC-CHG-008 — A change that arrives later is the headline, and has to be acknowledged

🟢 Somebody who presses "upgrade" and then sees nothing change for eleven months has been told
something they did not read, and a line among the warnings is exactly where a reader does not
look. An acknowledgement of one date is not an acknowledgement of the next one.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - the deferred upgrade explains itself
        - a yearly customer choosing a monthly higher plan is told why it waits
        - the same upgrade on the same cycle happens now and says nothing
- `packages/ui-vue-tenant/tests/component/a-later-change-is-acknowledged.test.ts`
    - the block appears, led by what the customer does not get today
    - it offers the alternative rather than only describing it
    - the confirmation is locked until it is acknowledged
    - an ordinary upgrade shows none of it
    - a downgrade is a different sentence, not this one
    - the heading counts the features and dates the loss
    - every lost feature is listed, not just counted
    - the confirmation is locked until it is acknowledged
    - a downgrade that costs no feature says so instead of counting zero
    - it says the rhythm changes later, and a new term starts then
    - the confirmation is locked until it is acknowledged
    - the effective date is set in bold, the rest is not
    - the block disappears once the preview describes the new choice
- `packages/ui-vue-tenant/tests/component/plan-change-wizard.test.ts`
    - no plan chosen: pressing next changes nothing
    - choosing the plan the tenant is already on is not a change
    - a different plan advances
    - no plan chosen: the button is disabled
    - the plan the tenant is already on: still disabled
    - a different plan: enabled
    - on the preview step it follows the blockers
    - advancing moves focus to the new heading
    - a refused move leaves focus alone
    - exactly one step is marked current, and it carries a word

<!-- END proof -->

### SC-CHG-009 — The date the tenant was shown is the date the change is made on

🟢 💰 A confirmation quoting a date that has moved since it was shown is refused rather than silently
applied. A wrong date here is a year of somebody's money, and the page can ask again in a second.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/the-confirmed-date-is-the-one-that-applies.test.js`
    - the confirmed date is the one that applies
        - a matching expectation goes through
        - a stale one is refused, and the answer carries the new date
        - no expectation still works
- `packages/ui-vue-tenant/tests/component/plan-change-wizard.test.ts`
    - no plan chosen: pressing next changes nothing
    - choosing the plan the tenant is already on is not a change
    - a different plan advances
    - no plan chosen: the button is disabled
    - the plan the tenant is already on: still disabled
    - a different plan: enabled
    - on the preview step it follows the blockers
    - advancing moves focus to the new heading
    - a refused move leaves focus alone
    - exactly one step is marked current, and it carries a word

<!-- END proof -->

### SC-CHG-010 — Every refusal the preview shows is also enforced where the change is made

🟢 A caller that skips the preview meets the same answer. A refusal only the client honours is not
enforcement.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-change-preview.test.js`
    - preview returns UPGRADE STARTER→STANDARD with proration and feature diff
    - preview returns DOWNGRADE STANDARD→STARTER with users blocker when usage too high
    - preview blocks ENTERPRISE as a self-service target
    - the self-service refusal names the plan and says what to do about it
    - preview NOOP when plan and cycle are identical
    - preview returns CYCLE_CHANGE on MONTHLY→YEARLY at the same plan
    - limitsCheck renders the union of quota keys from limits, target plan and usage
- `packages/nest/tests/the-plan-preview-sees-the-bookings.test.js`
    - the plan-change rule reaches the bookings in a real container
        - a yearly add-on blocks a move to monthly when the module is composed normally
        - it asks as of the day the change lands, not today
        - nothing booked, nothing blocked
- `packages/nest/tests/the-server-decides-when-a-change-lands.test.js`
    - a plan change is timed by the rules, not by the request
        - a caller asking for "immediately" on a deferred change is scheduled anyway
        - a caller asking for nothing on an immediate change still gets it today
        - the scheduled date is the preview's, not a second computation

<!-- END proof -->

### SC-CHG-011 — A decision taken against one state is not written into another

🟢 If the subscription changed in between — a cancellation arriving, for instance — the request is
refused and nothing is written, and the caller is told to look again.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a cancellation arriving while a plan change is being decided
        - the immediate change is refused rather than written over it
        - and so is the scheduled one
        - while an unchanged subscription is written as decided
    - a boundary that passes while the request is being decided
        - is refused rather than written a moment late

<!-- END proof -->

### SC-CHG-012 — A tenant cannot move to a plan whose limits their usage already exceeds

🟢 They are told which limit and by how much, and reduce usage first.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-change-preview.test.js`
    - preview returns UPGRADE STARTER→STANDARD with proration and feature diff
    - preview returns DOWNGRADE STANDARD→STARTER with users blocker when usage too high
    - preview blocks ENTERPRISE as a self-service target
    - the self-service refusal names the plan and says what to do about it
    - preview NOOP when plan and cycle are identical
    - preview returns CYCLE_CHANGE on MONTHLY→YEARLY at the same plan
    - limitsCheck renders the union of quota keys from limits, target plan and usage

<!-- END proof -->

### SC-CHG-013 — A change that removes features warns, it does not refuse

🟢 The tenant is told how many they lose, and that existing data is kept and comes back on upgrading.
Somebody deciding whether to downgrade is deciding whether they lose their work, and the answer is
no.

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-014 — Nothing starts after the end, and nothing sells a period the end cuts short

🟢 A change scheduled before a cancellation must not come due after it and restart a term that is
over, and an immediate change on a subscription that is ending opens no fresh period. A
cancellation that has not yet landed refuses nothing, though: a customer who bought a further
period by cancelling late may still choose the plan they spend it on.

_Source:_ #219 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a subscription that has ended
        - refuses a plan change instead of charging for one
        - while a running one still changes plans
    - a cancellation still to come
        - lets the plan change, and does not sell a term it cuts short
        - while an uncancelled subscription does get a fresh term
    - a change scheduled before the customer cancelled
        - is declined once the cancellation has taken effect
        - but a cancellation still to come declines nothing
        - and an uncancelled subscription is applied as before
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a change and a cancellation on the same day
        - the ending wins, exactly at the moment they meet
        - and a minute earlier the change still happens

<!-- END proof -->

### SC-CHG-015 — A cancelled subscription cannot change its billing rhythm

🟢 The plan may still move on the rhythm it was sold in. What may not move is the rhythm the ending
was calculated in.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a cycle change while a cancellation is outstanding
        - the preview says so before the reader has decided anything
        - and an ended subscription is refused outright, not merely locked
        - and says nothing when the cycle stays
        - is refused, because the ending was calculated in the old rhythm
        - while the plan still moves on the cycle it was sold in
        - and an uncancelled subscription may change cycle freely

<!-- END proof -->

### SC-CHG-016 — A plan cannot be changed while onboarding is still running

🟢

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-017 — Choosing the plan and rhythm already in force is refused as no change

🟢 Rather than being applied as one and producing a charge.

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-018 — Every blocker and warning carries values a client can rebuild the sentence from

🟢 The number used, the limit, the quota, the plan name — beside the code rather than inside a
finished English sentence. Without them a client holding the code would have to parse prose for
the numbers.

_Source:_ #243
