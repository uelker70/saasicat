---
title: Trials, pilots and negotiated arrangements
---

Not every subscription is an ordinary paid one. A trial commits to nothing, a pilot is a granted
arrangement, and an enterprise deal may sit with sales for weeks. Each of them answers the
questions in the previous chapters differently, and this chapter says how — because the failure
mode is a rule written for the ordinary case being applied to one of these.

### SC-SPEC-001 — A trial commits to nothing, so a plan change during one takes effect at once

🟢 Deferring an upgrade to the end of a trial withholds the very thing the customer asked to try.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/codegen-drift.test.js`
    - Q.4 Codegen drift gate
        - every schema has a generated file, and every generated file a schema
        - a schema with no title is refused rather than generated as undefined
        - ${genFile} is in sync with ${file}
- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - a trial commits to nothing, so nothing is deferred to protect it
        - the matrix asks more of a trial than of a term
        - on trial, ${label} takes effect ${expected ? 'now' : 'at term end'}

<!-- END proof -->

### SC-SPEC-002 — Cancelling during a trial ends the trial, and no sooner

🟢 It lands when the trial does. Ending it on the spot would take the trial away as the price of
saying they do not want to convert; treating it as a term meant a customer cancelling a
yearly-cycle trial bought a year.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - a trial has an end, not a term
        - the cancellation lands when the trial does
        - a notice period does not buy a billing cycle
        - and a paid term five days out still does
        - a trial with no dates at all still lands now

<!-- END proof -->

### SC-SPEC-003 — A notice period never applies to a trial

🟢 The window exists so a term cannot be left at the last moment, and a trial has no term to leave.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - a trial has an end, not a term
        - the cancellation lands when the trial does
        - a notice period does not buy a billing cycle
        - and a paid term five days out still does
        - a trial with no dates at all still lands now

<!-- END proof -->

### SC-SPEC-004 — Switching plans during a trial carries the remaining trial time over

🟢 The time already used is deducted rather than restarted, and repeated switches do not accumulate
or lose days. Where the plan being moved to has no trial, the trial end stays where it was.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/trial-carryover.test.js`
    - carries remaining trial time to a target plan with a longer trial
    - is drift-free across repeated switches (reconstructs trial start)

<!-- END proof -->

### SC-SPEC-005 — A trial grants the trial's entitlements, not the booked plan's

🟢 And it opens no billing period; the agreement is frozen when the subscription becomes a paid one.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-plan-resolution.test.js`
    - resolveEntitlementPlan — Trial / Pilot / Pending
        - Default: no override → subscription.plan
        - Pilot: pilotEntitlementPlan overrides
        - Pilot without config: falls back to subscription.plan
        - TRIAL: subscription.trialEntitlementPlan wins
        - TRIAL without trialEntitlementPlan: falls back to defaultTrialEntitlementPlan
        - TRIAL with no config at all: falls back to subscription.plan
        - PENDING_SALES: pendingSalesEntitlementPlan overrides
        - Pending plan change: takes effect once pendingEffectiveAt is in the past
        - Pending plan change: does NOT take effect while pendingEffectiveAt is in the future
        - Pilot beats pending plan change: Pilot dominates
        - TRIAL beats pending plan change: Trial dominates

<!-- END proof -->

### SC-SPEC-006 — A pilot arrangement outranks every other way of resolving what a tenant may do

🟢 Ahead of trial, ahead of a pending negotiation, ahead of a scheduled change.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-plan-resolution.test.js`
    - resolveEntitlementPlan — Trial / Pilot / Pending
        - Default: no override → subscription.plan
        - Pilot: pilotEntitlementPlan overrides
        - Pilot without config: falls back to subscription.plan
        - TRIAL: subscription.trialEntitlementPlan wins
        - TRIAL without trialEntitlementPlan: falls back to defaultTrialEntitlementPlan
        - TRIAL with no config at all: falls back to subscription.plan
        - PENDING_SALES: pendingSalesEntitlementPlan overrides
        - Pending plan change: takes effect once pendingEffectiveAt is in the past
        - Pending plan change: does NOT take effect while pendingEffectiveAt is in the future
        - Pilot beats pending plan change: Pilot dominates
        - TRIAL beats pending plan change: Trial dominates

<!-- END proof -->

### SC-SPEC-007 — Granting, withdrawing or extending a pilot is a deliberate operator act

🟢 It needs a second factor and an explicit confirmation, and it is recorded.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/pilot-dialogs.test.ts`
    - PilotCreateDialog
        - blocks submitting while required fields are missing
        - draws the plan picker from the options passed in
        - derives the slug from the name
    - PilotEditDialog
        - adopts plan, end date and note from the row
        - draws the same plan picker as the create dialog
        - offers preset buttons for the end date

<!-- END proof -->

### SC-SPEC-010 — The operator gives a pilot's subscriber its address, required under a tax adapter

🟡 _(Decided, not yet delivered.)_ 💰 The pilot dialog asks for the street, a second line, postal
code, city and country of the pilot's subscriber and sends them as `subscriber`. Where a tax adapter
decides, the manifest says that a contract needs the full address, and the dialog does not submit
until the street, postal code, city and country are given, since the pilot's first contract would
otherwise be refused (`SC-PRIC-069`); without one they are optional, and none entered sends none.
The pilot routes are the application's: it creates the subscriber with the address, refusing an
incomplete one as `SC-SUB-048` does, and the dialog shows the refusal in the interface's language.

_Source:_ #528

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/the-manifest-says-whether-a-contract-needs-the-address.test.js`
    - where a tax adapter decides, a contract needs the full address
    - without a tax adapter, it does not — said, not left out
    - a manifest built without the field is still one the schema takes, and it takes no other answer

<!-- END proof -->

### SC-SPEC-008 — A negotiated arrangement is expressed as limits set for that tenant

🟢 Limits set for the tenant replace the plan's; features set for the tenant are added to the plan's.
The two behave differently on purpose: a negotiated limit is a substitution, a negotiated feature
is an addition.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-aggregation.test.js`
    - applyCustomLimits
        - null/undefined custom: no change
        - quotas override overwrites field by field
        - features override adds
        - mutation of the input is forbidden (pure function)

<!-- END proof -->

### SC-SPEC-009 — A subscription waiting on a negotiated contract falls back to a named interim plan

🟢 It has no billing period, and cancelling it takes effect immediately, because there is nothing
running to see out.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-plan-resolution.test.js`
    - resolveEntitlementPlan — Trial / Pilot / Pending
        - Default: no override → subscription.plan
        - Pilot: pilotEntitlementPlan overrides
        - Pilot without config: falls back to subscription.plan
        - TRIAL: subscription.trialEntitlementPlan wins
        - TRIAL without trialEntitlementPlan: falls back to defaultTrialEntitlementPlan
        - TRIAL with no config at all: falls back to subscription.plan
        - PENDING_SALES: pendingSalesEntitlementPlan overrides
        - Pending plan change: takes effect once pendingEffectiveAt is in the past
        - Pending plan change: does NOT take effect while pendingEffectiveAt is in the future
        - Pilot beats pending plan change: Pilot dominates
        - TRIAL beats pending plan change: Trial dominates
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a tenant still waiting on sales
        - cancels immediately, because nothing was ever committed
        - and one that did get a period keeps it

<!-- END proof -->
