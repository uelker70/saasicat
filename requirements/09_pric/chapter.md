---
title: Prices, proration, tax and money
---

Money is the one area where an error is both invisible and unforgivable. This chapter fixes how
part-periods are calculated, what happens when arithmetic goes the wrong way, and which facts
about an amount are recorded rather than re-derived later. Some of it is decided and not yet
built; those entries say so.

### SC-PRIC-001 — SaaSiCat computes prices; the integrator bills them

🟢 💰 Nothing is stored as an amount that was paid, which is also why no credit can be owed when a
period is shortened.

_Source:_ #222

### SC-PRIC-002 — A part-period is charged by days

🟢 💰 Not by whole months. Plan changes and add-on bookings then answer with the same arithmetic, so
two screens describing one situation cannot quote different figures.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - what the short first period costs
        - the cycle it is charged against ends where the first period does
        - a yearly bundle is charged against a year, not a month
        - the anchor survives being walked backwards, the same as forwards
        - stepping back from January lands in December of the year before
        - a leap day retreats to the 28th, and forwards again to the 29th
        - the start it gives back is the boundary that leads to that end
- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewAdd
        - proration: prorated amount until period end + next-period price
        - YEARLY cycle uses yearlyNet, plan-specific pricing override wins
        - TRIAL: no proration (no paid period yet)
        - the preview quotes no commitment, because a booking makes none
        - the preview quotes a commitment an operator configured
        - redundancy (AK-13): feature already in plan → hint + warning
        - redundancy: feature already in another active bundle → hint with bundleKey
        - requires (#35): uncovered dependency → missingRequires + blocker
        - requires: coverage by plan or active bundle → no blocker
        - requires: without CatalogEntryRepository no check (graceful)
        - self-service policy: sales-only bundle → blocker BUNDLE_NOT_SELF_SERVICE
        - blocker: plan-incompatible + already booked
        - unknown bundle version → NotFound

<!-- END proof -->

### SC-PRIC-003 — This platform never pays money back

🟢 💰 A prorated fee is floored at zero. Where a change lowers the price, the upgrade is free rather
than producing a credit, and a cancellation is never refunded pro rata — the booking stays active
and paid to the end of its period.

_Source:_ #212 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - a prorated upgrade never asks for less than nothing
        - a cheaper target after a price cut is free rather than a credit
        - an ordinary upgrade still costs what it costs
        - a change that costs exactly nothing is not a free upgrade
- `packages/nest/tests/an-upgrade-runs-inside-the-paid-period.test.js`
    - the unused rest at its edges
        - on the first day of the period the whole of it is left
        - on its last day nothing is left, and the new period costs its price
        - a rest worth more than the new period makes it free, and nothing is paid out
        - a rest worth exactly the new period costs nothing and is not free

<!-- END proof -->

### SC-PRIC-004 — "Free upgrade" and "costs nothing" are two different sentences

🟢 💰 A change that is free because the arithmetic went negative is not the same as one that costs
nothing because the two plans are priced alike, and somebody deciding is owed the difference.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-immediate-change-may-not-shorten-the-term.test.js`
    - a prorated upgrade never asks for less than nothing
        - a cheaper target after a price cut is free rather than a credit
        - an ordinary upgrade still costs what it costs
        - a change that costs exactly nothing is not a free upgrade

<!-- END proof -->

### SC-PRIC-005 — There is no proration during a trial

🟢 💰 There is no paid period to take a fraction of.

_Source:_ release 1.0.0-rc.6

### SC-PRIC-006 — The preview and the booking describe the same contract

🟢 💰 A tenant who was quoted a price and a term gets that price and that term.

_Source:_ #222

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
    - a plan the operator publishes after the service was built
        - is found, ranked and priced by the plans as they stand now
        - a changed price is the one the proration charges
        - a retired plan is refused as not in the catalogue
    - a plan without a price for the rhythm asked for
        - is blocked, naming the plan and the rhythm, in words both languages can build
        - is the refusal the change routes enforce
        - is not blocked in the rhythm it does carry a price for
        - a plan on request is blocked in either rhythm
        - a plan that is not marketed is left to the special contract that prices it
- `packages/ui-vue-tenant/tests/component/a-preview-in-flight-blocks-the-confirmation.test.ts`
    - while a replacement preview is on the wire
        - the answer to the abandoned question is taken off the screen
        - and the confirmation cannot be given
    - when the answers come back out of order
        - the outdated one does not install itself

<!-- END proof -->

### SC-PRIC-007 — An amount a tenant sees is the amount that is charged

🟢 💰 Money is held to two decimal places and never as a floating-point number, and the same
arithmetic produces the same figure in the backend, the tenant's page and the administration.
Discounts, part periods and tax do not accumulate a difference between what a page shows and what is
billed.

_Source:_ `docs/explanation/data-model.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.preview — eligibility
        - valid=true with price preview for PROFESSIONAL/YEARLY/25%
- `packages/nest/tests/the-configurator-shows-the-price-that-is-charged.test.js`
    - the configurator breakdown
        - a monthly plan costs its monthly price and saves nothing
        - a yearly plan costs the yearly price its plan version carries
        - a yearly price above twelve monthly ones saves nothing rather than a negative amount
        - a promo code is previewed on the yearly price that is charged
        - a promo discount is taken off in net, not the gross amount the preview answers
        - a discount above the price takes it to nothing, not below
        - resuming the step shows the same yearly figure
- `packages/ui-vue/tests/use-subscription-draft.test.js`
    - useSubscriptionDraft — Promo-Discount
        - the discount is the net amount the server previewed, off the plan and not the bundles
        - a discount above the plan price stops at the plan price
        - changing the plan or the cycle forgets the preview, and keeps the code
        - choosing the plan and cycle already chosen keeps the preview
        - clearPromo removes discount + sets status idle
        - setPromoCode clears a previous valid status
- `packages/ui-vue-tenant/tests/component/a-bundle-is-bought-in-a-rhythm.test.ts`
    - a monthly plan offers no choice
        - the card quotes the monthly price with the monthly unit
    - a yearly plan offers both
        - switching moves the price and the unit together
- `packages/ui-vue-tenant/tests/component/the-configurator-sells-what-is-priced.test.ts`
    - a promo code applied before the plan or rhythm changes
        - is asked about again, and the summary shows the new answer
        - the answer to the earlier question landing last does not replace the latest
        - the answer to the earlier question landing first does not stand
        - a code refused outright is not asked about again, a restricted one is
        - a code removed while its preview is out gives no discount when the answer lands

<!-- END proof -->

### SC-PRIC-008 — Gross, net and tax are one calculation, stated once

🟢 💰 Gross follows from net and the configured rate, and the tax contained in a gross amount follows
from the same rate. Both are rounded once and mean the same thing everywhere they appear.

_Source:_ release 1.0.0-rc.7

### SC-PRIC-009 — An installation sells in one currency and applies one tax rate, both named once

🟢 💰 The tax rate is required even when it is zero, so nobody is left wondering whether it was
forgotten. Changing the currency after contracts exist is a migration rather than an edit, because
a currency change must not silently relabel history.

_Source:_ #217 · #214

### SC-PRIC-010 — A yearly price is a price per year, not a monthly price with a discount attached

🟢 💰 Whatever a pricing page chooses to display.

_Source:_ `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - the prices a store is shown
        - a bundle sold in one rhythm only says so for the other
- `packages/nest/tests/plan-catalog-importer.test.js`
    - importFromYaml: a plan without a yearly price is skipped with a warning, not given ten monthly
      prices
- `packages/nest/tests/the-configurator-shows-the-price-that-is-charged.test.js`
    - the configurator breakdown
        - a monthly plan costs its monthly price and saves nothing
        - a yearly plan costs the yearly price its plan version carries
        - a yearly price above twelve monthly ones saves nothing rather than a negative amount
        - a promo code is previewed on the yearly price that is charged
        - a promo discount is taken off in net, not the gross amount the preview answers
        - a discount above the price takes it to nothing, not below
        - resuming the step shows the same yearly figure
- `packages/ui-vue/tests/use-subscription-draft.test.js`
    - useSubscriptionDraft — cycle toggle
        - Monthly uses monthlyNet, Yearly uses yearlyNet
        - yearSavings = 12*monthly − yearly
        - a plan without a yearly price is not sold yearly, and costs nothing to show
        - a bundle without a price for the cycle is neither charged nor sent, until its cycle is
          back
- `packages/ui-vue-tenant/tests/component/the-configurator-sells-what-is-priced.test.ts`
    - a plan without a price for the chosen rhythm
        - says so on its card, cannot be chosen, and the order cannot be sent
        - is not sent when the summary emits without its button
        - becomes a plan again in the rhythm it is priced for
        - an add-on priced in the other rhythm only says so and cannot be chosen

<!-- END proof -->

### SC-PRIC-011 — A plan that is not marketed has no list price

🟢 💰 It is sold by negotiation, and no page invents a figure for it.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/public-catalog-controller.test.js`
    - listPlans returns only marketed plans in the generic format
    - a plan sold by negotiation is left out even when a figure is on file

<!-- END proof -->

### SC-PRIC-012 — A contract mixing rhythms totals one period of its own rhythm

🟢 💰 A monthly add-on beside a yearly plan counts as often as it falls due within that year, not
once.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contracts-lines-add-up-to-its-totals.test.js`
    - a contract mixing rhythms
        - each rhythm pays its tax on its own net, and the total is what the charges come to
        - a monthly line does not take a share of the yearly line before it
        - the door holds such a contract to the weighted total, not to the lines counted once
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a yearly contract holding a monthly add-on
        - counts the add-on as often as it falls due
        - a yearly add-on beside a yearly plan is counted once
        - each rhythm pays its tax on its own net, so the gross is what the charges come to
        - a monthly contract adds a monthly add-on as it stands
- `packages/nest/tests/tenant-subscription-bundles-refreeze.test.js`
    - add re-freezes the contract with an unchanged plan
    - cancel re-freezes the contract
    - without a ContractFreezePort, add works unchanged
    - freeze error is non-fatal — the mutation result still comes back
    - a failed mutation triggers no freeze
    - an add-on booking brings the account up to date
        - after the contract takes the booking in
        - a journal that fails does not undo the booking
        - a cancellation charges nothing new

<!-- END proof -->

### SC-PRIC-013 — Amounts of money cross the wire exactly, not as approximations

🟢 💰 So that nothing is lost between the system that computed a figure and the one that shows it.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/canonical-rows-become-records.test.js`
    - a line item row becomes a line item record
        - an amount arrives with the cent it left with

<!-- END proof -->

### SC-PRIC-014 — The number of decimal places follows the currency

🟢 💰 Two for euros, none for yen. That is a property of the currency, not a formatting preference.

_Source:_ #105

### SC-PRIC-015 — An amount records the currency it was booked in

🟢 💰 Even though only one is configured at a time. The record is not for selling in two currencies;
it is so that a row written in 2026 still means what it meant.

_Source:_ #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/canonical-rows-become-records.test.js`
    - a line item row becomes a line item record
        - the currency and the tax come back as the row recorded them
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - what a frozen line records about its money
        - every line names the currency and the rate the installation applies
        - and the tax it names closes the gap between its own net and gross
        - a rate of zero is recorded as zero, not left to be read as absent
        - the gross is the platform's share of the tax, not one a source sends along
        - a currency other than the euro is the one that is recorded
- `packages/nest/tests/subscription-contract-service.test.js`
    - the money facts a contract inherits from its offer
        - the rate the offer states is recorded as the percentage it is
        - and the rate it records explains the tax it records
        - every line names the currency the offer froze
        - and the tax on each closes the gap between its own net and gross
        - the discount the offer implies carries a negative tax, not a positive one
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a line item learns the money it was booked with
        - the values come from the contract the line belongs to

<!-- END proof -->

### SC-PRIC-016 — A tax rate has a validity window

🟢 💰 A contract concluded at 19 % is charged 19 % for its term, whatever the rate later becomes.

_Source:_ #217 · #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-contract-service.test.js`
    - the money facts a contract inherits from its offer
        - the rate the offer states is recorded as the percentage it is
        - and the rate it records explains the tax it records
        - every line names the currency the offer froze
        - and the tax on each closes the gap between its own net and gross
        - the discount the offer implies carries a negative tax, not a positive one
- `packages/nest/tests/validity-window.test.js`
    - the window a version is refused for
        - no start at all
        - a start that is not a date
        - a start on or before the predecessor’s
        - a start that leaves a gap after a predecessor that ends
        - a predecessor without an end imposes no seam
        - an end that is not a date
        - an end on or before the start
        - the codes come from the caller, so a plan refuses as a plan
        - the gapless refusal says which day it wanted

<!-- END proof -->

### SC-PRIC-017 — The tax rate and the tax amount are recorded, not re-derived

🟢 💰 Storing net and gross leaves the rate living in the ratio between them, and a ratio cannot be
reproduced for a rounded gross, cannot express an exempt or reverse-charge line, and does not
survive a rate change.

_Source:_ #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/canonical-rows-become-records.test.js`
    - a line item row becomes a line item record
        - the currency and the tax come back as the row recorded them
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - what a frozen line records about its money
        - every line names the currency and the rate the installation applies
        - and the tax it names closes the gap between its own net and gross
        - a rate of zero is recorded as zero, not left to be read as absent
        - the gross is the platform's share of the tax, not one a source sends along
        - a currency other than the euro is the one that is recorded
- `packages/nest/tests/subscription-contract-service.test.js`
    - the money facts a contract inherits from its offer
        - the rate the offer states is recorded as the percentage it is
        - and the rate it records explains the tax it records
        - every line names the currency the offer froze
        - and the tax on each closes the gap between its own net and gross
        - the discount the offer implies carries a negative tax, not a positive one
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a line item learns the money it was booked with
        - the values come from the contract the line belongs to

<!-- END proof -->

### SC-PRIC-050 — A contract's lines add up to its totals in net, gross and tax

🟢 💰 The total is what is charged and the lines are what an invoice itemises, so a document whose
lines come to a cent more or less than its total is one an auditor cannot reconcile. The tax is
computed once on the net of the charges billed together — every line of one rhythm — and each line
carries its share of it, at most a cent from its own conversion. A contract mixing rhythms
(`SC-PRIC-012`) states what its charges come to: one yearly charge and twelve monthly ones, each
rhythm taxed on its own net. A contract whose lines do not add up is refused, whoever builds it.

_Source:_ #311

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contracts-lines-add-up-to-its-totals.test.js`
    - each line carries its share of one tax computation
        - two lines that round the same way: the total is converted once, and the second line
          carries the cent
        - over price pairs and triples, with and without a discount, the lines add up and none is
          more than a cent from its own conversion
        - a rate of zero carries no tax on any line
    - a contract mixing rhythms
        - each rhythm pays its tax on its own net, and the total is what the charges come to
        - a monthly line does not take a share of the yearly line before it
        - the door holds such a contract to the weighted total, not to the lines counted once
    - an offer and the contract concluded from it
        - the reproduction: lines that came to −0.01 under totals of 0 come to 0
        - over price pairs, with and without a code, the offer and its contract add up
        - an offer whose stored lines were each converted on their own still concludes, and its
          contract adds up
        - an offer stating a gross its lines do not come to is refused at the door, and nothing is
          stored
    - the door, approached with lines that do not add up
        - the lines a caller builds with the exported functions go through
        - a ${field} a cent off its lines, either way, is refused, and nothing is stored
        - lines each converted on their own, under a total converted once, are refused
        - a replacement whose lines do not add up leaves the contract in force
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a yearly contract holding a monthly add-on
        - each rhythm pays its tax on its own net, so the gross is what the charges come to
    - what a frozen line records about its money
        - the gross is the platform's share of the tax, not one a source sends along

<!-- END proof -->

### SC-PRIC-051 — Nothing a contract takes off is negative

🟢 💰 A discount, a promotion's amount and a promo code's amount are each zero or more. A negative
discount would be a surcharge nobody agreed to under that name, in a record that is append-only. A
contract stating one is refused.

_Source:_ #311

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contracts-lines-add-up-to-its-totals.test.js`
    - nothing a contract takes off is negative
        - ${what} resolved below zero is refused, and nothing is stored
        - a discount line that adds money is refused, even where the totals follow it
        - a discount of exactly zero goes through
        - a promotion stated above 100 % takes the plan and nothing of the add-on, and a code after
          it takes nothing
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a discount line from the source that adds money is refused before the contract in force is
      closed

<!-- END proof -->

### SC-PRIC-052 — A payment gateway that fails is answered with SaaSiCat's own code

🟢 💰 When the gateway fails — unreachable, refusing the account's keys, or answering with an error
— while opening the form for a payment method or reading a callback back, the request is refused
with `PAYMENT_GATEWAY_FAILED` and the status 502: the person at sign-up, the tenant changing its
payment method, the person a gateway's immediate confirmation is read for, and the gateway's own
webhook, which then retries. A form that failed to open records nothing, and a callback that could
not be read claims nothing. The gateway's own status and wording stay on the server: the operator
finds the failure's kind, code, status and request identifier in the log (`SC-LANG-008`,
`SC-PRIV-001`). Where this stops: a callback whose signature does not verify is refused with
`PAYMENT_CALLBACK_REJECTED` instead.

_Source:_ #318

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - a gateway that fails to open its form at step 4
        - is answered with SaaSiCat's code and 502, and the provider's answer stays in the server
          log
        - keeps the adapter's own diagnostic in the log, with where it broke, since no status marks
          it as the provider's
- `packages/nest/tests/a-tenant-changes-its-payment-method-through-the-gateway.test.js`
    - changing it opens the gateway form, and the confirmation replaces the one in use
        - a gateway that fails to open its form is answered with SaaSiCat's code, and no setup is
          recorded
        - an immediate confirmation the gateway fails to read answers the person with SaaSiCat's
          code
    - the webhook route
        - a callback the gateway fails to read is answered with SaaSiCat's code, and nothing is
          claimed

<!-- END proof -->

### SC-PRIC-018 — Rounding happens once, when a charge is written

🟢 💰 The written figure is the truth from then on.

_Source:_ #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-charge-row-becomes-a-record.test.js`
    - a charge is written as the figure it was rounded to
        - as a two-place decimal string, negative for a discount
        - a sum float arithmetic leaves a hair off a cent is still that cent
        - an amount that is not a whole number of cents is refused, not rounded again
        - nothing the caller added beside the charge is written

<!-- END proof -->

### SC-PRIC-019 — A tenant can see their own account

🟡 _(Decided, not yet delivered.)_ 💰 Balance, what is open, and the history. An open balance a
customer cannot see is a surprise at the moment it becomes a problem; one they can see is something
they can act on.

_Source:_ #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/tenant-billing-controller.test.js`
    - getEntitlement returns EffectiveLimitsSnapshot generically (quotas map)
    - getUsage joins Subscription + Limits + Usage and fills missing quotaKeys with 0
    - getUsage passes packageSnapshot + checkoutOfferId through 1:1 (P11.4)
    - getUsage returns packageSnapshot=null when the Subscription has no snapshot
    - getUsage throws NotFoundException when the Subscription is missing
    - the tenant is taken from the session, not from what the caller sent
    - and a session that names none is refused rather than falling back
    - getUsage throws NotFoundException when tenantIdResolver yields no ID
    - ComposedTenantAuthGuard chains guards in order — all ok = true
    - ComposedTenantAuthGuard short-circuits on the first false
    - ComposedTenantAuthGuard throws 403 without configured guards

<!-- END proof -->

### SC-PRIC-020 — A charge, once written, is never edited

🟢 💰 A correction is a counter-entry. A record that can be rewritten
answers what somebody thinks today, not what happened.

_Source:_ #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - a written charge is never edited
        - a contract written later changes no charge already written

<!-- END proof -->

### SC-PRIC-053 — A charge is written once for its contract line and period, however often it is derived

🟢 💰 The platform derives an account's charges again whenever a change or a renewal asks it to, and
several may ask at once; the account does not grow by any of it. A charge's key is its
subscription, what it charges — the plan, an add-on booking, a discount — the period it belongs to
and why it arose.

_Source:_ #276 · #318

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - a charge is written once
        - a second call writes nothing, and says so
        - calls at the same moment write it once between them

<!-- END proof -->

### SC-PRIC-054 — Every period of a subscription is charged, at the price in force when it starts

🟢 💰 One by one, a period the application's renewal job skipped as well: the next call charges it,
a cycle at a time, from where the account left off. A price a later contract states applies to the
periods that start under it, and never to one already charged.

_Source:_ #276

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - every period is charged, at the price in force when it starts
        - the first period is the activation, the next a renewal, each for its own period
        - periods a renewal skipped are charged one by one, from where the account left off
        - a later price applies to the periods that start under it, not before
        - a window opened a moment before its contract is still charged under it
        - a subscription older than its first charge starts with a renewal, not an activation
        - a yearly plan is charged its yearly line
        - a contract line in another rhythm prices nothing
    - an add-on is charged even where writing its contract failed
        - the journal writes the contract the booking missed, and charges the add-on under it
        - only a running add-on the contract misses makes the journal write one
        - a source that does not name the booking has the contract written once, not on every call
        - nor in a trial, nor once the subscription has ended
        - a contract write that fails leaves the rest of the account charged
- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding brings the account up to date
        - once, for the tenant, after the plan is written
        - a journal that fails does not undo the onboarding

<!-- END proof -->

### SC-PRIC-055 — Nothing is charged in a trial, without a contract, early, or after the end

🟢 💰 A charge points at the contract line it came from, so a subscription with no contract has no
charges. A trial commits to no period. A period is charged once it has started, not when it is
known. No period that starts on or after the date a cancellation takes effect is charged.

_Source:_ #276 · #318

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - what is not charged
        - a trial
        - a subscription without a contract
        - a tenant without a subscriber
        - a period that has not started
        - a period starting on or after the date a cancellation takes effect

<!-- END proof -->

### SC-PRIC-056 — A charge is net, and its tax is the invoice's

🟢 💰 A charge records its amount, its currency and its period, and no rate and no tax amount. The
tax adapter decides a charge's treatment when it is invoiced, from the subscriber's origin on that
day, and the invoice computes the tax once per rate (`SC-PRIC-041`); a tax recorded on the charge
would be a second figure that could differ from the invoice's by cents.

_Source:_ #276 · ADR 0013

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - a charge is net
        - it records the net amount and its currency, and no tax

<!-- END proof -->

### SC-PRIC-057 — A discount is charged for the periods it was concluded for, and no others

🟢 💰 At the amount resolved when the contract was concluded (`SC-PROMO-015`), whatever contract
is in force later: a promo code for its duration — once, a number of months or a number of billing
periods — an intro price or free months for their months, and a percentage or an amount off,
which states no duration, for the first period only.

_Source:_ #318

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - a discount is charged for the periods it was concluded for
        - a code for three months, in months one to three
        - a code for two billing periods, in the first two
        - a code once, and one that names no duration, in the first period only
        - a percentage promotion, which states no duration, in the first period only
        - an intro price for two months, in months one and two
        - a discount line that says nothing of its duration, once
        - an offer concluded during a trial is discounted from the first paid period
        - a contract written between the conclusion and the first paid period does not take it away
        - an offer concluded as a period ends is discounted from the next one
        - an offer concluded a moment after its window opened is discounted in that window, where no
          earlier contract prices it
        - an offer concluded while a charged period runs is discounted from the next one
        - a code redeemed at onboarding is taken off from the contract that records it
        - two discounts agreed at different times each run from their own contract
        - a discount a later contract carries forward counts from where it first appeared
        - a contract written again later, which carries no discount line, does not end it

<!-- END proof -->

### SC-PRIC-058 — An account begins with the current window, and nothing before it is guessed

🟢 💰 Where the paid periods began is recorded nowhere a charge could be derived from: a contract
may be concluded during a trial and priced only from its end, and a window and the contract written
for it are moments apart, in either order. So an account that holds no charge yet begins with the
window its subscription is in, and an add-on booked before that is charged from there. An add-on
booked later is charged from its booking, a first charge that was missed included. A window that
moved on before anything charged it is not charged afterwards, which is why a renewal job charges a
window before it moves it (`SC-PRIC-054`).

_Source:_ #276 · #318

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - an account begins with the window its subscription is in
        - not with a contract concluded during the trial before it
        - a window that moved on before anything charged it is not charged afterwards
        - an add-on whose first charge was missed is charged from its booking
        - an add-on whose window ended before the account began is not charged
        - an add-on booked in the trial is charged from the first paid window

<!-- END proof -->

### SC-PRIC-059 — An immediate upgrade is charged as it was quoted

🟢 💰 The account records what the plan change quoted (`SC-CHG-020`, `SC-CHG-021`), derived from
the contract and the window the change leaves behind. In the same rhythm it is the difference for
what is left of the period, beside the period's own charge: Standard at 49 to Pro at 99 on day 15
of 30 is 25.00. A further upgrade in the same period is charged from the price before it. Into a
longer rhythm it is the new period in full, less the unused rest of the period it replaces, at the
price in force just before the change: 990 − 24.50 = 965.50. That is never below nothing, and the
renewals run on from the new period's end. A contract written again at the same price adds
nothing, and nothing is paid out (`SC-PRIC-003`).

_Source:_ #318

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-plan-change-is-charged.test.js`
    - an immediate upgrade in the same rhythm is charged the difference for the rest of the period
        - Standard 49 to Pro 99 on day 15 of 30 costs 25.00 now, and the next renewal 99
        - a contract written again at the same price adds nothing
        - two upgrades in one period are each charged from the price before them
        - a contract that takes effect as the period starts prices that period, and adds nothing
        - nothing before the upgrade takes effect, and nothing after the subscription has ended
        - a second call writes the difference no second time
    - an immediate upgrade into a longer rhythm is charged the new period less the unused rest
        - Standard 49 a month to Pro 990 a year on day 15 of 30 costs 965.50, and the year after 990
        - the rest is valued at the price in force just before, an upgrade earlier in the month
          included
        - a rest larger than the new period costs nothing, and is never paid out
        - a second call charges the new period no second time
- `packages/nest/tests/an-upgrade-runs-inside-the-paid-period.test.js`
    - an immediate upgrade brings the account up to date
        - once, for the tenant, after the contract that prices the change is written
        - a journal that fails does not undo the upgrade

<!-- END proof -->

### SC-PRIC-060 — A discount keeps to its rhythm, and what is left of it moves to the new period

🟢 💰 A discount is charged on whole periods of the rhythm it was agreed in (`SC-PRIC-057`). The
difference a same-rhythm upgrade adds carries none. When the rhythm changes, the discount's
remainder is taken off the new period: what it would still have taken off the periods of its
rhythm that start at or after the change, but no more than the new period costs. At 20 % for three
months, which is 9.80 a month, a move to yearly during the first month takes 19.60 off the year. A
discount agreed with the change itself treats the new period as its first.

_Source:_ #318

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-plan-change-is-charged.test.js`
    - a discount and a plan change
        - the difference carries none; the discount runs on the whole periods for its duration
        - an upgrade offer with its own code mid-period: the difference now, the code from the next
          period
        - into a longer rhythm, the months left of a code are taken off the new period
        - the billing periods left are carried, and a one-off code that was used carries nothing
        - what is carried takes no more off than the new period costs
        - a code concluded with the change takes the new period as its first
        - a discount carried into a longer rhythm does not come back when the rhythm returns
        - a return to monthly takes what is left of a yearly discount off the first month, once
        - a monthly discount whose rhythm changed in the trial moves whole to the first yearly
          period, and not again
        - a discount from the old rhythm takes nothing off the yearly renewals after the change

<!-- END proof -->

### SC-PRIC-021 — An internal account reference is never shown to a customer as an invoice number

🟡 _(Decided, not yet delivered.)_ Invoice numbering is sequential, unique and legally constrained
per country, and an identifier a customer has already seen on a screen cannot become one later
without confusion.

_Source:_ #214

### SC-PRIC-022 — Every charge of a subscription is invoiced once, on that subscription's invoice

🟡 _(Decided, not yet delivered.)_ 💰 Charges are invoiced when they arise: the charges a billing
period opens with together, and a charge that arises later in the period, such as a bundle booked
mid-period (`SC-BUN-003`) or the difference of an immediate upgrade (`SC-CHG-020`), on an invoice of
its own rather than added to one already issued. A charge correcting one on a cancelled invoice is
the exception: it goes on that invoice's replacement (`SC-PRIC-025`). A billing period whose charges
are all zero is the other: it issues no invoice (`SC-PRIC-048`). Once means on one invoice that
stands: a cancelled invoice and the replacement that follows it (`SC-PRIC-025`) are not two. Each
charge carries its period (`SC-AUD-011`). A subscription belongs to one tenant, so an invoice stays
inside the tenant it was for and what a tenant downloads never shows another tenant's charges.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-023 — Invoice numbers have no gaps within an installation, and a prefix sets it apart

🟡 _(Decided, not yet delivered.)_ 💰 The number is assigned in the transaction that writes the
invoice, so an issue that fails leaves no gap, and only after the tax adapter has accepted the
invoice's content (`SC-PRIC-027`), so a refusal leaves no number behind. The prefix is named in
`config/saas.yaml`, and two applications run by one issuer stay apart as long as each names its own.
The law asks for a unique, sequential number; the gapless range spares an audit the question of a
missing one.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-024 — An installation's invoice number prefix cannot change once an invoice exists

🟡 _(Decided, not yet delivered.)_ 💰 Otherwise a number issued before the change and one issued
after it no longer read as one range.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-025 — An issued invoice is never edited; a cancellation invoice corrects it

🟡 _(Decided, not yet delivered.)_ 💰 An invoice is cancelled only once its document is archived
(`SC-PRIC-033`), so a cancellation never corrects a document the subscriber could not have received.
The cancellation invoice cancels the whole invoice, names it and the reason given for it
(`SC-ADM-020`), and carries the issuer and the subscriber of that invoice rather than whatever
`config/saas.yaml` or the subscriber's record names by then, so an invoice stays correctable after
either has changed. Where some or all of the charges it covered are still owed, a replacement
invoice for exactly those, and for any charge written to correct one of the cancelled invoice's
charges (`SC-PRIC-020`), follows under a new number, names the invoice it replaces, and each of its
lines names the line it replaces (`SC-AUD-013`). The replacement carries both parties of the invoice
it replaces, the issuer and the subscriber, rather than whatever `config/saas.yaml` or the
subscriber's record names by then: the charges are owed between the parties of their contract, and
the subscriber's record may have kept only what its documents need (`SC-PRIV-013`). Where a party
detail on the cancelled invoice was wrong, such as the billing address, the name or a tax
identifier, the operator records the corrected detail with the cancellation and its reason, and the
replacement carries it; a correction of the issuer declared in `config/saas.yaml` (`SC-PRIC-026`) or
of the subscriber's legal identity (`SC-SUB-017`) applies as well. A correcting charge names the
charge it corrects and goes on the replacement rather than on an invoice of its own, so what was
paid settles it like the others. Those charges are then on the replacement, the cancelled invoice no
longer counts for them (`SC-PRIC-022`), and a charge no longer owed is on no invoice that stands.
What a payment for the cancelled invoice settles moves with the charges, whether it was paid before
the cancellation or confirmed by the gateway after it: it is applied to the replacement as a new
entry rather than collected again, and where there is no replacement, or the payment exceeds it, the
rest is a credit on the subscriber's account for the operator to refund (`SC-PRIC-031`). A
collection for the cancelled invoice not yet submitted to the gateway is not submitted, and no
invoice of its chain is collected while one already submitted for any of them is unresolved
(`SC-PRIC-036`). Where several payments settled the cancelled invoice, they settle the replacement
in the order they were confirmed, the oldest first, and what remains of the most recent ones becomes
the credit; each payment's share is recorded, so a later reversal takes back exactly that payment's
part (`SC-PRIC-031`). The cancellation invoice, its replacement and the movement of what was paid
onto the replacement or into a credit are written in one transaction, so an interruption leaves all
of them or none, and it takes its turn with everything else that changes the invoice
(`SC-PRIC-036`), so an invoice is cancelled once and a payment event that commits after the
cancellation settles the replacement or the credit rather than the cancelled invoice; archiving each
invoice then follows `SC-PRIC-033`.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued

🟡 _(Decided, not yet delivered.)_ 💰 The issuer's identity, its legal name and tax identifiers, is
the counterparty a contract names (`SC-AUD-012`), so an invoice takes that identity from the copy
on the contract its charges belong to, with a declared correction of that entity applied; its
address and contact details come from `config/saas.yaml` on the issue date while the configuration
names that same identity, and from the contract's copy otherwise. The subscriber's details are
copied from its record. A cancellation or replacement invoice keeps both parties of the invoice it
corrects instead (`SC-PRIC-025`). Either way a later change leaves the invoice as it was, and a new
contract takes its issuer from `config/saas.yaml`. An installation that names a different identity
while contracts with the previous one still run does not start, and names those contracts: moving a
contract to another legal entity is a transfer, not an edit of a setting, and an invoice never asks
for payment on behalf of an entity the contract was not concluded with. A correction of the same
entity, such as a misspelt name, a wrong tax identifier or a change of name that entity went
through, starts once `config/saas.yaml` declares it as one beside the values it replaces; the
settings record keeps that declaration (`SC-CFG-025`), and invoices issued afterwards carry the
corrected identity.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/prisma-adapters.test.js`
    - PrismaSubscriptionContractRepository.listRunningIssuers
        - asks for the running ones, oldest first, four columns, capped
        - a contract with no issuer copy says so rather than inventing one
- `packages/cli/tests/default-doctor-checks.test.js`
    - IssuerIdentityDoctorCheck
        - a refusal is reported as the error it would be at the next start
        - an installation that records nothing is warned that nothing is compared
        - an unchanged identity says what changing it would cost
        - a declared correction is reported before the start applies it
        - the first naming, and an installation that names none
- `packages/core/tests/an-issuer-is-the-same-entity-or-another-one.test.js`
    - the identity of an issuer
        - is the three fields a contract names it by, and nothing about how it is reached
        - reads an absent tax identifier as unknown rather than as absent
        - is nothing where the file names no issuer
        - is settled the same way on both sides, so a stray space is not another entity
        - and a declaration is settled with them
        - is the same as another when every field matches, and not otherwise
        - is exactly what `issuer.correctionOf` can name in the file
    - the copy a contract takes of the issuer
        - carries the same three fields the start compares, and the address beside them
        - never loses all three because one of them could not be read
        - does not carry the declaration, which is about the change and not the party
    - the identity a record holds
        - is read back out of the settings tree the last start wrote
        - is nothing where the tree names no issuer, or names one without a name
    - what a start finds when it compares the two
        - nothing named on either side is nothing to compare
        - a first issuer where none was recorded is the first naming, declared for nothing
        - a moved address is not a moved identity
        - a changed legal name with nothing declared is refused
        - a changed legal name declared against the recorded one is a correction
        - a tax number that was missing is declared as the nothing it replaces
        - a declaration naming a value the record does not hold covers nothing
        - a declaration covering half a change covers nothing
        - a declaration fuller than it had to be is still a declaration
        - dropping the issuer block while one is recorded is refused, declaration and all
        - a block whose name reads as nothing is refused however well it is declared
        - a declaration left in the file after its correction landed changes nothing
        - and it does not license the next change
- `packages/nest/tests/an-operator-corrects-its-own-details.test.js`
    - a start that finds the issuer where it left it
        - names one for the first time, and says so
        - lets the address move without a word from the operator
        - carries a declared correction through, and keeps the declaration
        - lets the same declaration stay in the file afterwards
    - a start that finds another legal entity
        - does not start, and names the contracts still running under the previous one
        - leaves the record exactly as the previous start left it
        - says so even where no contract is running yet
        - names a declaration that covers another change than this one
        - names a field the declaration says nothing about
        - refuses the issuer block being dropped while one is recorded
        - and refuses a nameless block however well it is declared, leaving the record
        - reads the contracts platform-wide, which needs the bypass frame
        - and the block it prints carries every issuer member the schema declares
        - names the contracts up to a limit, and how many more there are
        - does not count a contract whose term has run out
        - names a legal name that YAML would otherwise not read back
        - says which contracts carry no issuer copy rather than pretending they do
    - what the comparison needs, and what it does without
        - an installation that records nothing compares the issuer with nothing, and says so
        - a record that cannot be read stops a start that names an issuer
        - and only warns where the file names no issuer at all
        - an installation that writes no contracts at all still refuses another entity
    - what this start found stays what this start found
        - a reader afterwards is told the correction, not that nothing moved
        - and the contracts it would be weighed against are counted on request
        - and nothing is counted where no repository answers
- `packages/nest/tests/plan-catalog-loader.test.js`
    - the issuer names an entity, or the file does not load

<!-- END proof -->

### SC-PRIC-027 — An invoice carries what the tax law of its issuer requires of it

🟡 _(Decided, not yet delivered.)_ 💰 The installation's tax adapter (`SC-PRIC-037`) names that
content, the names of the documents and the note each tax treatment needs, and checks an invoice's
content against them before its number is drawn (`SC-PRIC-023`). An invoice missing any of it draws
no number and is not issued, and the operator is shown what is missing, such as a billing address
the format rejects; once it is corrected, the invoice takes the next number then. Another country's
law is another adapter rather than an addition to one, and German law is the first (`SC-PRIC-044`).

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-028 — A direct debit is announced before it is collected

🟡 _(Decided, not yet delivered.)_ 💰 The invoice states the amount, the collection date and the
mandate reference, and it reaches the subscriber at least the lead time named in
`config/saas.yaml` before the collection. A collection whose date or mandate differs from what the
invoice announced, such as after the payment method was replaced or a collection is retried, is
announced again with its own date and mandate reference, the same lead time before it; that notice
stands on its own and leaves the invoice as it was issued (`SC-PRIC-025`).

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-029 — A payment is recorded against its invoice once the gateway has confirmed it

🟡 _(Decided, not yet delivered.)_ 💰 A confirmation that arrives twice records one payment, as
`SC-REG-019` already holds for sign-up. Claiming a gateway event and recording what it changes
happen in one transaction, so an attempt that fails leaves the event unclaimed and the gateway's
retry is processed rather than discarded as a duplicate. A payment is recorded once by its gateway
account and the gateway's own reference for it, whichever way it arrives, so a callback, a
reconciliation after an unanswered request (`SC-PRIC-034`) and a retry that report the same payment
under different event identifiers settle it once. An event, and a checkout session a sign-up waits
on, is identified together with the gateway account that sent it, so two accounts configured side
by side (`SC-PRIC-030`) never take one another's event for a duplicate or a payment for another's
sign-up.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-030 — A payment method is entered in the gateway's own form, and SaaSiCat keeps a reference

🟡 _(Decided, not yet delivered.)_ 🔒 What SaaSiCat stores is the gateway's reference and the masked
details `SC-PRIV-005` allows, never the IBAN or the card number. Adding or changing a payment
method needs the billing permission (`SC-UI-023`) and is taken in the subscriber's one live tenant
(`SC-SCOPE-012`), or, once that tenant is deleted, on the gateway's payment page for an open invoice
(`SC-ADM-024`). A reference is only meaningful to the gateway account that issued it,
the provider and the merchant account there, so each payment method and each payment records that
account. `config/saas.yaml` names the account that takes new payment methods; one that still holds
a payment method in use, an open collection, a credit to refund, a payment inside its reversal
period or a sign-up's checkout session that has neither completed nor expired stays configured
beside it with its own keys, so its callbacks, refunds and reversals keep being handled. An
installation holding such a reference to an account it no longer configures does not start, and
names what it holds. Moving a subscriber to another account, at the same provider or another, means
asking for a new payment method there.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-payment-method-row-becomes-a-record.test.js`
    - a payment method row becomes a record
        - every column is carried over as it is
        - both payment method types and both statuses are read
        - a ${column} of '${value}' stops the read, naming the row and the column
    - the columns a confirmed payment method is written with
        - are the confirmation, and nothing a caller put beside it
    - a callback a gateway adapter cannot verify
        - is recognised by its code, also from another copy of the class
- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - an open sign-up keeps its account configured
        - the start refuses while a sign-up waits at an account the configuration no longer names
        - and starts once that account is configured again
- `packages/nest/tests/a-tenant-changes-its-payment-method-through-the-gateway.test.js`
    - changing it opens the gateway form, and the confirmation replaces the one in use
        - the form opens for the subscriber, and nothing changes until the gateway confirms
        - the customer the subscriber has at that account is reused
        - a customer at another account is not handed to this one
        - without an invoice email, the gateway is given the requesting user's address
        - the confirmation makes the new payment method the one in use, and keeps the one it
          replaced
        - a confirmation whose recording fails leaves the claim and the setup open for the retry
        - a return URL at another origin is refused, and neither the gateway nor a setup is touched
        - opening the form records the setup for this subscriber and this session
        - a confirmation naming another subscriber than the session was opened for changes nobody's
          payment method
        - a confirmation naming a reference another subscriber holds records nothing, and says so
          once
        - a confirmation for a session nobody opened, or for a setup already completed, records
          nothing
        - a gateway that fails to open its form is answered with SaaSiCat's code, and no setup is
          recorded
        - without an account for new payment methods the change is refused, and the gateway is not
          asked
        - an immediate confirmation the gateway fails to read answers the person with SaaSiCat's
          code
        - the development gateway replaces the payment method on the spot
    - the accounts the file names and the gateways the application binds
        - and it reads them platform-wide, which needs the bypass frame
        - a payment method in use at an account the file no longer names stops the start, and is
          named
- `packages/ui-vue-tenant/tests/component/a-payment-method-is-changed-in-the-providers-form.test.ts`
    - who sees the card
        - a user holding the billing permission sees the payment method in use
        - a user without it sees nothing at all, not even the heading
        - nor does anyone where the installation takes no payment methods
        - a failure to load is said, and offers no change it could not show the result of
    - what the card says
        - a subscriber without a payment method is offered to add one
        - a direct debit names its account and the mandate it is collected under
        - in German too, and a card whose network the provider did not name
    - changing it
        - opens the provider's form and sends the person there, back to this page
        - a form that could not be opened is said on the card, and nobody is sent anywhere

<!-- END proof -->

### SC-PRIC-031 — A returned debit or a chargeback is recorded, and what the payment settled opens again

🟡 _(Decided, not yet delivered.)_ 💰 Either is recorded as a counter-entry rather than an edit of
the payment, and a report that arrives twice records one reversal. A reversal takes back everything
the payment settles when it arrives, divided across all of it: the invoice it was collected for, or
the replacement its settlement moved to under `SC-PRIC-025`, opens again by the part the payment
settled there, and the credit it became shrinks by its part; never an invoice already cancelled. A
partial reversal reduces the credit first and reopens invoices only with what remains, so the
operator is not left refunding what is owed again. Where the credit's part was already refunded,
that part is shown to the operator to reconcile. A refund is different: SaaSiCat never initiates
one (`SC-PRIC-003`), and one the operator makes in the gateway is recorded against the credit it
pays out, reopening nothing; a refund that matches no credit is shown to the operator to reconcile.
A credit the gateway can no longer refund, because the payment's gateway account is no longer
configured (`SC-PRIC-030`) or the gateway's own refund period has passed, is paid out by the
operator outside the gateway, such as by bank transfer, and the operator records that payout with
its reference against the credit; SaaSiCat still initiates nothing. What follows a reversal is
`SC-PRIC-035`'s: the invoice it reopens is unpaid like any other.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-032 — No contract is frozen and no invoice issued before the subscriber's identity is complete

🟡 _(Decided, not yet delivered.)_ 💰 The identity is the legal name, the billing address and the
tax identifiers. Sign-up asks for it before the tenant is activated. A subscriber created
another way is asked for what is missing before its subscription becomes a paid one, which is
when its contract is frozen (`SC-SPEC-005`, `SC-AUD-012`); until then the operator sees the
subscription waiting and why, because a party copied onto a contract incomplete cannot be
completed afterwards.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-033 — An invoice interrupted in archiving keeps its number and is never issued twice

🟡 _(Decided, not yet delivered.)_ 💰 Its content has passed the tax adapter's check before the
number is drawn (`SC-PRIC-027`), so what can still fail afterwards is rendering or archiving the
document rather than the invoice itself. The invoice and its number are written in one transaction,
and the rendered document is then archived under that number, which makes a repeated attempt the
same write rather than a second document. Until the archive confirms, the invoice is neither sent
nor offered for download, the register shows it as awaiting its document (`SC-ADM-022`), and an
attempt that fails is retried; it never draws a new number for the same charges (`SC-PRIC-022`,
`SC-PRIC-023`).

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-034 — A collection retried after an unanswered request never charges twice

🟡 _(Decided, not yet delivered.)_ 💰 An invoice has at most one active collection attempt, claimed
atomically in the database before any request reaches the gateway, so two workers that find the
same invoice open do not both collect it. Asking the gateway to collect an invoice carries a key
that stays the same for that invoice and attempt across every retry, so a request whose answer was
lost is repeated as the same request rather than a second charge. A result that stays uncertain is
reconciled with the gateway before anything is retried under a new key. An attempt is marked as
submitted in the invoice's turn (`SC-PRIC-036`) before its request leaves, so a cancellation never
meets an attempt that is about to be sent without knowing it. Deduplicating the gateway's callbacks
(`SC-PRIC-029`) covers the other direction.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-035 — An invoice left unpaid past its grace period makes the tenant read-only

🟡 _(Decided, not yet delivered.)_ 💰 A collection that fails, the first one after sign-up included,
and a reversal (`SC-PRIC-031`) leave the invoice open; the gateway retries, and the subscriber is
told. An invoice still open when the grace period named in `config/saas.yaml` has passed, counted
from its due date (`SC-PRIC-046`), puts the tenant into read-only (`SC-ADM-024`), where a user
holding the billing permission (`SC-UI-023`) can still replace the payment method. Settling every
overdue invoice lifts that reason and no other: a tenant whose subscription has ended
(`SC-CANC-020`), that the operator suspended or that is being deleted (`SC-PRIV-014`) stays as
restricted as that reason makes it. Suspending the tenant stays the operator's decision
(`SC-ADM-005`). Sign-up activates on a confirmed payment method rather than a completed collection
(`SC-REG-022`), and this is what keeps that from being service against an invoice nobody pays.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-036 — What an invoice owes and how it is paid changes one step at a time

🟡 _(Decided, not yet delivered.)_ 💰 Cancelling an invoice (`SC-PRIC-025`), recording a payment event
(`SC-PRIC-029`) or a reversal (`SC-PRIC-031`) against it, and marking a collection for it as
submitted to the gateway (`SC-PRIC-034`) take turns, and the turn belongs to the invoice's chain:
the invoice and every replacement that follows it, however many cancellations deep, share one. Each
reads the chain's state only once it holds the turn, so a payment event for a cancelled invoice and
the cancellation of its replacement never read the same replacement at once, and the event settles
the invoice that stands in the chain when it holds the turn. A collection that finds the invoice
cancelled is not submitted, and a request only leaves once its attempt is marked, so no request is
sent for an invoice a cancellation has already replaced. A second cancellation that finds the
invoice already cancelled is refused; a mistake on the replacement is corrected by cancelling the
replacement. No invoice of a chain is collected while an attempt submitted for any invoice of that
chain is unresolved, so a replacement of a replacement waits for the attempt its first predecessor
sent. The turn covers the writes and not the gateway's answer, which arrives as an event of its own.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-037 — The tax a subscriber is charged is decided by a tax adapter for the issuer

🟡 _(Decided, not yet delivered.)_ 💰 SaaSiCat itself interprets no tax law, since an installation may
run in any country. `config/saas.yaml` names the installation's tax adapter, a package for the
country of the issuer. For each charge the adapter decides the treatment, such as the standard or a
reduced rate, an exemption, the reverse charge, not taxable in the issuer's country, or a small
business's exemption, together with the rate and the note the invoice has to carry. It decides from
the issuer, the period the charge covers and the subscriber's origin as its record stands when the
invoice is issued: the country of the billing address, whether the subscriber is a business, and its
validated tax identifier (`SC-PRIC-040`). A price shown before a subscriber's origin is known, such
as on the pricing page, states the treatment for a subscriber in the issuer's country and says so.
For an installation that invoices, `SC-PRIC-008`, `SC-PRIC-009`, `SC-PRIC-016`, `SC-MKT-023` and
`SC-CFG-034` are superseded in the change that delivers this entry, by successors that take the rate
from the adapter.

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-038 — A contract and an invoice record the tax treatment and the adapter that decided it

🟡 _(Decided, not yet delivered.)_ 💰 The treatment, the rate, the note and the adapter's name and
version are written with the contract when it is concluded and with each invoice when it is issued,
so a document still says why it carries the tax it does after the adapter is updated or replaced. An
update never changes a document already issued (`SC-PRIC-025`).

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-039 — A subscriber the tax adapter cannot treat is refused before a contract exists

🟡 _(Decided, not yet delivered.)_ 💰 Sign-up and an operator creating a subscriber ask the adapter
first. A case it answers as not supported is refused with a sentence saying so rather than invoiced
with a guessed tax. A subscriber whose origin changes into such a case (`SC-PRIC-043`) is shown to
the operator, and its next invoice is not issued until the operator resolves it.

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-040 — A tax identifier is validated before a tax treatment depends on it

🟡 _(Decided, not yet delivered.)_ 💰 The adapter names how, such as the European Union's VIES service
for a VAT identification number, and the result is kept with its date and the confirmation the
service returned. A check that cannot be completed, such as while the service is unavailable, leaves
the identifier unvalidated, and the adapter decides as though there were none; it never decides in
the subscriber's favour on an identifier it could not check.

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-041 — An invoice computes its tax once per rate, by the rule its tax adapter names

🟡 _(Decided, not yet delivered.)_ 💰 The German adapter names the rule of EN 16931: the tax of each
rate is that rate applied to the net total of its lines, rounded once, and the invoice total is the
net total plus that tax. The amount the invoice states, the amount collected and the amount a
payment settles are that one figure. The total is never the sum of the lines' own rounded taxes,
which can differ from it by cents: ten lines of 12.34 net at 19 % carry 2.34 each, 23.40 together,
while the rate applied to 123.40 gives 23.45.

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-042 — An invoice is issued in the format its tax adapter requires

🟡 _(Decided, not yet delivered.)_ 💰 The German adapter requires ZUGFeRD in the EN 16931 profile, one
file a person reads as a PDF and a program reads as structured data, for cancellation and
replacement invoices as well. That file is what is archived, sent (`SC-PRIC-047`) and downloaded
(`SC-AUD-014`). Rendering stays a port, so an application's own renderer can produce it. A rendered
file the adapter's format check refuses is not issued. The content check and the format check come
from one profile of the adapter, so content that passed before the number was drawn (`SC-PRIC-027`)
renders into a file that passes; a refusal after all is a defect of the renderer or the adapter, so
the invoice keeps its number, waits for its document as `SC-PRIC-033` has it until the defect is
fixed, and the operator is shown the refusal.

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-043 — A change to a subscriber's tax origin applies from its next invoice

🟡 _(Decided, not yet delivered.)_ 💰 The change is recorded with its date, and a new tax identifier
is validated first (`SC-PRIC-040`). An invoice already issued keeps its treatment; one issued under
a detail that was wrong is corrected by cancelling it (`SC-PRIC-025`).

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-044 — The German tax adapter covers Germany, businesses abroad and small businesses

🟡 _(Decided, not yet delivered.)_ 💰 It is the first adapter and the template for the others. It
treats a subscriber in Germany, business or consumer, at the German rate; a business in another
member state of the European Union with a validated VAT identification number under the reverse
charge, with both numbers and the note on the invoice; a business outside the European Union as not
taxable in Germany, with its note; and an issuer using the small business exemption without VAT and
with that note. A consumer outside Germany, and a business in another member state without a
validated number, are not supported yet and are refused (`SC-PRIC-039`). The adapter is a template,
not tax advice: the operator stays responsible for the tax it charges.

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-045 — Invoice dates and tax periods count in the installation's time zone

🟡 _(Decided, not yet delivered.)_ 💰 `config/saas.yaml` names it. The issue date, the period a charge
covers, the due date and the periods the invoice register exports (`SC-ADM-022`) are days in that
zone, so an invoice issued half an hour after midnight on the first of January belongs to the new
year whatever the server's clock says (`SC-OPS-011`).

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-046 — An invoice states the day it is due

🟡 _(Decided, not yet delivered.)_ 💰 An invoice collected by direct debit is due on the collection
date it announces (`SC-PRIC-028`), any other on its issue date plus the payment term named in
`config/saas.yaml`. The grace period of `SC-PRIC-035` counts from that day, and a collection
announced again with a later date leaves the due date as the invoice states it.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-047 — Every invoice reaches the subscriber by email, with its file attached

🟡 _(Decided, not yet delivered.)_ 💰 Cancellation and replacement invoices as well, sent to the
invoice email on the subscriber's record once the document is archived (`SC-PRIC-033`), so a
subscriber who never signs in, or whose tenant is gone, still receives it. A link in the message
leads to the tenant's sign-in rather than to an address anyone holding it could open. Where the
subscriber's record no longer holds an invoice email, as `SC-PRIV-013` allows once no claim is left,
the operator enters an address to deliver to when cancelling the invoice, and cannot cancel without
one; the address is kept with the cancellation and its reason and used for the replacement as well,
rather than written back onto the subscriber's record. A message that cannot be delivered is shown
to the operator, and the invoice stays issued: delivery is not what makes it an invoice.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-048 — A billing period whose charges are all zero issues no invoice

🟡 _(Decided, not yet delivered.)_ 💰 A free plan does not use up an invoice number every period. A
charge of zero is invoiced beside charges that are not, and an invoice whose total a discount brings
to zero is issued, because it records the service and the discount.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-049 — A subscriber's account is shown to the tenant's users holding the billing permission

🟡 _(Decided, not yet delivered.)_ 💰 Balance, what is open, and the history, in the subscriber's one
live tenant (`SC-SCOPE-012`), to whoever holds the billing permission (`SC-UI-023`). An open balance
a customer cannot see is a surprise at the moment it becomes a problem; one they can see is something
they can act on. The account belongs to the subscriber and shows its amounts, which not every user of
a tenant is meant to see. This entry supersedes `SC-PRIC-019` in the change that delivers it.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`
