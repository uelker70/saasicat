---
title: Prices, proration, tax and money
---

Money is the one area where an error is both invisible and unforgivable. This chapter fixes how
part-periods are calculated, what happens when arithmetic goes the wrong way, and which facts
about an amount are recorded rather than re-derived later. Some of it is decided and not yet
built; those entries say so.

### SC-PRIC-001 — SaaSiCat computes prices; the integrator bills them

🔴 _(Withdrawn on 2026-10-23.)_ 💰 `SC-SCOPE-011` covers this ground, the invoices with it. Nothing
is stored as an amount that was paid, which is also why no credit can be owed when a period is
shortened.

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

🔵 _(Superseded on 2026-10-06 by `SC-PRIC-076`.)_ 💰 A prorated fee is floored at zero. Where a change
lowers the price, the upgrade is free rather than producing a credit, and a cancellation is never
refunded pro rata — the booking stays active and paid to the end of its period.

_Source:_ #212 · release 1.0.0-rc.6

### SC-PRIC-076 — No charge is paid back, except the unused rest of what a withdrawal ends at once

🟢 💰 A prorated fee is floored at zero. Where a change lowers the price, the upgrade is free rather
than producing a credit, and a cancellation is never refunded pro rata — the booking stays active
and paid to the end of its period. The one exception is a subscription or a booking ended at once
while a feature it holds is withdrawn: the unused rest of what was charged is credited to the
account (`SC-PRIC-075`). SaaSiCat itself never initiates a refund.

_Source:_ #212 · release 1.0.0-rc.6 · #357

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
    - a subscriber on an older version of the plan
        - is quoted the version they keep for a change of rhythm, and loses nothing by it
        - sees the price they pay as their current one when changing plan
        - is refused a rhythm the version they keep is not sold in, rather than quoted it free
        - is quoted from the catalogue where no repository reads versions
        - is quoted a change at a version the change can name › another plan at the version on sale
          now, priced from that version and named by it
        - is quoted a change at a version the change can name › the plan it stays on at the version
          kept
        - is quoted a change at a version the change can name › none where nothing reads versions,
          priced from the catalogue
        - is shown the price they pay › at the version they keep, in either rhythm, not the
          catalogue's
        - is shown the price they pay › as none in a rhythm the version they keep is not sold in,
          not as 0
        - is shown the price they pay › as none where the version they keep is sold under a special
          contract
        - is shown the price they pay › as unknown, not the catalogue's, where the version bound
          cannot be read
        - is shown the price they pay › as unknown where the version bound is a version of another
          plan
        - is shown the price they pay › and a change is refused with a code rather than quoted from
          the catalogue
        - is shown the price they pay › from the catalogue where no repository reads versions, or
          none is bound
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

🔵 _(Superseded on 2026-10-04 by `SC-PRIC-065`.)_
💰 Gross follows from net and the configured rate, and the tax contained in a gross amount follows
from the same rate. Both are rounded once and mean the same thing everywhere they appear.

_Source:_ release 1.0.0-rc.7

### SC-PRIC-009 — An installation sells in one currency and applies one tax rate, both named once

🔵 _(Superseded on 2026-10-04 by `SC-PRIC-066`.)_
💰 The tax rate is required even when it is zero, so nobody is left wondering whether it was
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
    - ${route} asks the party about the contract it re-freezes
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

🔵 _(Superseded on 2026-10-04 by `SC-PRIC-067`.)_
💰 A contract concluded at 19 % is charged 19 % for its term, whatever the rate later becomes.

_Source:_ #217 · #214

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
    - getUsage states the price the subscription pays, as the plan preview reads it off the version
      bound
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

- `packages/core/tests/a-charge-row-becomes-a-record.test.js`
    - a counter-entry
        - takes what it corrects off the charge, under its contract line, source and period
        - takes off a cent at least and what the charge asks at most
        - takes off nothing else, not ${amount}
        - of a discount, which shrinks with what it reduced › gives back a cent at least and the
          whole discount at most
        - of a discount, which shrinks with what it reduced › gives back nothing else, not ${amount}
        - is never written for a charge of nothing, which has nowhere to move
        - is never written for a correction, but for the charge it corrects
        - reads back with what it corrects, and is written with it
        - read without ${missing}, stops the read naming the row
        - read with ${what}, stops the read naming the row
        - read with an amount given back, as a discount's correction carries it, reads as written
        - read on another charge, a part of a correction stops the read naming the row
        - one that moves its charge by an amount and says why is written, a cent either way among
          them
        - ${why} is not written
    - a correction is held to the charge it names, as the store read it
        - names each charge corrected once, and nothing for a charge that corrects nothing
        - one counterEntryOf made of it fits, beside a charge that corrects nothing
        - one standing in ${where} is refused, naming what differs
        - one taking off more than the charge asks is refused
        - one moving its charge away from nothing is refused: a charge that asks gains nothing
        - of a discount › one giving back part of it fits
        - of a discount › one taking off more of it, rather than giving back, is refused
        - one naming a correction is refused
        - one naming a charge the store did not find is left to the foreign key
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
        - the contract it writes records the latest of what the missed bookings were agreed under
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
        - an add-on period from the end an older row records in canceledAt alone

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
nothing, and nothing is paid out (`SC-PRIC-076`).

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

🔵 _(Superseded on 2026-10-21 by `SC-PRIC-096`.)_ 💰 Charges are invoiced when they arise: the
charges a billing period opens with together, and a charge that arises later in the period, such as
a bundle booked mid-period (`SC-BUN-003`) or the difference of an immediate upgrade (`SC-CHG-020`),
on an invoice of its own rather than added to one already issued. A charge correcting one on a
cancelled invoice is the exception: it goes on that invoice's replacement (`SC-PRIC-091`). A billing
period whose charges are all zero is the other: it issues no invoice (`SC-PRIC-048`). Once means on
one invoice that stands: a cancelled invoice and the replacement that follows it (`SC-PRIC-091`) are
not two. Each charge carries its period (`SC-AUD-011`). A subscription belongs to one tenant, so an
invoice stays inside the tenant it was for and what a tenant downloads never shows another tenant's
charges.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-096 — Every charge is invoiced once, a counter-entry by the cancellation that wrote it

🟡 _(Decided, not yet delivered.)_ 💰 Charges are invoiced when they arise: the charges a billing
period opens with together, and a charge that arises later in the period, such as a bundle booked
mid-period (`SC-BUN-003`) or the difference of an immediate upgrade (`SC-CHG-020`), on an invoice of
its own rather than added to one already issued. A counter-entry is the exception: the cancellation
that wrote it invoices it, on that invoice's replacement where the charge it corrects is still owed
in part, and on no invoice where that charge is owed no more, as the charge then stands on none
either (`SC-PRIC-095`); the invoice run never invoices one. A billing period whose charges are all
zero is the other: it issues no invoice (`SC-PRIC-048`). Once means on one invoice that stands: a
cancelled invoice and the replacement that follows it (`SC-PRIC-095`) are not two. Each charge
carries its period (`SC-AUD-011`). A subscription belongs to one tenant, so an invoice stays inside
the tenant it was for and what a tenant downloads never shows another tenant's charges.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md` · #334

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-invoice-is-drawn-up-from-its-charges.test.js`
    - the charges one invoice issues
        - are those booked at the same moment under the same contract
        - come the oldest first, whatever order the journal hands them in
        - issue nothing where all of them are zero
        - keep a zero beside an amount, and a discount that brings the total to zero
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - an invoice is issued for the charges booked together
        - the opening of a period is one invoice, its lines in the contract’s order
        - a charge that arises later in the period is an invoice of its own, numbered after
        - groups waiting from earlier are issued oldest first, so their numbers follow the charges
        - a second run issues nothing the first one issued
        - a charge another instance invoiced first is passed over, neither issued nor failed
        - a failure of one invoice holds up none of the others, and the next run issues it

<!-- END proof -->

### SC-PRIC-023 — Invoice numbers have no gaps within an installation, and a prefix sets it apart

🔵 _(Superseded on 2026-10-07 by `SC-PRIC-072`.)_
💰 The number is assigned in the transaction that writes the
invoice, so an issue that fails leaves no gap, and only after the tax adapter has accepted the
invoice's content (`SC-PRIC-027`), so a refusal leaves no number behind. The prefix is named in
`config/saas.yaml`, and two applications run by one issuer stay apart as long as each names its own.
The law asks for a unique, sequential number; the gapless range spares an audit the question of a
missing one.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-024 — An installation's invoice number prefix cannot change once an invoice exists

🟢 💰 Otherwise a number issued before the change and one issued
after it no longer read as one range.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/invoices-start-only-as-configured.test.js`
    - the prefix of the invoice numbers
        - may be anything while no invoice exists
        - is the one the issued invoices carry, and the start goes on
        - refuses the start where it is another, naming the one in use
        - refuses it where invoices carry two, even if one of them is the configured one

<!-- END proof -->

### SC-PRIC-025 — An issued invoice is never edited; a cancellation invoice corrects it

🔵 _(Superseded on 2026-10-20 by `SC-PRIC-091`.)_ 💰 An invoice is cancelled only once its document
is archived (`SC-PRIC-033`), so a cancellation never corrects a document the subscriber could not
have received. The cancellation invoice cancels the whole invoice, names it and the reason given
for it (`SC-ADM-020`), and carries the issuer and the subscriber of that invoice rather than
whatever `config/saas.yaml` or the subscriber's record names by then, so an invoice stays
correctable after either has changed. Where some or all of the charges it covered are still owed,
a replacement invoice for exactly those, and for any charge written to correct one of the
cancelled invoice's charges (`SC-PRIC-020`), follows under a new number, names the invoice it
replaces, and each of its lines names the line it replaces (`SC-AUD-013`). The replacement
carries both parties of the invoice it replaces, the issuer and the subscriber, rather than
whatever `config/saas.yaml` or the subscriber's record names by then: the charges are owed
between the parties of their contract, and the subscriber's record may have kept only what its
documents need (`SC-PRIV-013`). Where a party detail on the cancelled invoice was wrong, such as
the billing address, the name or a tax identifier, the operator records the corrected detail with
the cancellation and its reason, and the replacement carries it; a correction of the issuer
declared in `config/saas.yaml` (`SC-PRIC-026`) or of the subscriber's legal identity
(`SC-SUB-017`) applies as well. A correcting charge names the charge it corrects and goes on the
replacement rather than on an invoice of its own, so what was paid settles it like the others.
Those charges are then on the replacement, the cancelled invoice no longer counts for them
(`SC-PRIC-022`), and a charge no longer owed is on no invoice that stands. What a payment for the
cancelled invoice settles moves with the charges, whether it was paid before the cancellation or
confirmed by the gateway after it: it is applied to the replacement as a new entry rather than
collected again, and where there is no replacement, or the payment exceeds it, the rest is a
credit on the subscriber's account for the operator to refund (`SC-PRIC-083`). A collection for
the cancelled invoice not yet submitted to the gateway is not submitted, and no invoice of its
chain is collected while one already submitted for any of them is unresolved (`SC-PRIC-036`).
Where several payments settled the cancelled invoice, they settle the replacement in the order
they were confirmed, the oldest first, and what remains of the most recent ones becomes the
credit; each payment's share is recorded, so a later reversal takes back exactly that payment's
part (`SC-PRIC-084`). The cancellation invoice, its replacement and the movement of what was paid
onto the replacement or into a credit are written in one transaction, so an interruption leaves
all of them or none, and it takes its turn with everything else that changes the invoice
(`SC-PRIC-036`), so an invoice is cancelled once and a payment event that commits after the
cancellation settles the replacement or the credit rather than the cancelled invoice; archiving
each invoice then follows `SC-PRIC-033`.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-091 — An issued invoice is never edited; a cancellation invoice corrects it

🔵 _(Superseded on 2026-10-21 by `SC-PRIC-095`.)_ 💰 An invoice is cancelled only once its document
is archived (`SC-PRIC-033`), so a cancellation never corrects a document the subscriber could not
have received. The cancellation invoice cancels the whole invoice, names it and the reason given for
it (`SC-ADM-020`), and carries the issuer and the subscriber of that invoice rather than whatever
`config/saas.yaml` or the subscriber's record names by then, so an invoice stays correctable after
either has changed. Where some or all of the charges it covered are still owed, a replacement
invoice for exactly those, and for any charge written to correct one of the cancelled invoice's
charges (`SC-PRIC-020`), follows under a new number, names the invoice it replaces, and each of its
lines names the line it replaces (`SC-AUD-013`). The replacement names the parties of the invoice it
replaces, the legal entity it named as the issuer and the subscriber, rather than whichever entity
`config/saas.yaml` or whatever the subscriber's record names by then: the charges are owed between
the parties of their contract, and the subscriber's record may have kept only what its documents
need (`SC-PRIV-013`). It is a business letter of its own issue date, though: while
`config/saas.yaml` names that same entity, the replacement carries the address, the contact details
and the footer lines the file names for it on that day (`SC-PRIC-092`, `SC-PRIC-093`), so the
account to pay into and the managing directors are those of the day it is sent; the cancellation
invoice keeps everything of the invoice it cancels. Where a party detail on the cancelled invoice
was wrong, such as the billing address, the name or a tax identifier, the operator records the
corrected detail with the cancellation and its reason, and the replacement carries it; a correction
of the issuer declared in `config/saas.yaml` (`SC-PRIC-092`) or of the subscriber's legal identity
(`SC-SUB-017`) applies as well. A correcting charge names the charge it corrects and goes on the
replacement rather than on an invoice of its own, so what was paid settles it like the others. Those
charges are then on the replacement, the cancelled invoice no longer counts for them
(`SC-PRIC-022`), and a charge no longer owed is on no invoice that stands. What a payment for the
cancelled invoice settles moves with the charges, whether it was paid before the cancellation or
confirmed by the gateway after it: it is applied to the replacement as a new entry rather than
collected again, and where there is no replacement, or the payment exceeds it, the rest is a credit
on the subscriber's account for the operator to refund (`SC-PRIC-083`). A collection for the
cancelled invoice not yet submitted to the gateway is not submitted, and no invoice of its chain is
collected while one already submitted for any of them is unresolved (`SC-PRIC-036`). Where several
payments settled the cancelled invoice, they settle the replacement in the order they were
confirmed, the oldest first, and what remains of the most recent ones becomes the credit; each
payment's share is recorded, so a later reversal takes back exactly that payment's part
(`SC-PRIC-084`). The cancellation invoice, its replacement and the movement of what was paid onto
the replacement or into a credit are written in one transaction, so an interruption leaves all of
them or none, and it takes its turn with everything else that changes the invoice (`SC-PRIC-036`),
so an invoice is cancelled once and a payment event that commits after the cancellation settles the
replacement or the credit rather than the cancelled invoice; archiving each invoice then follows
`SC-PRIC-033`.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md` · #334

(decided 2026-10-20)

### SC-PRIC-095 — An issued invoice is never edited; its cancellation corrects what was not owed

🟡 _(Decided, not yet delivered.)_ 💰 An invoice is cancelled only once its document is archived
(`SC-PRIC-033`), so a cancellation never corrects a document the subscriber could not have received.
The cancellation invoice cancels the whole invoice, names it and the reason given for it
(`SC-ADM-020`), and carries the issuer and the subscriber of that invoice rather than whatever
`config/saas.yaml` or the subscriber's record names by then, so an invoice stays correctable after
either has changed. The operator may say which lines of the cancelled invoice are not owed, or owed
at a lower amount: a line whose charge asks for something — not a discount, a credit or a
correction —, owed at least nothing and below what it stands at, its charge with every correction
of it written along the chain, so the corrections of one charge never take it below nothing. Each
such line moves to what is owed of it by a counter-entry that names the charge, the cancelled
invoice and the reason (`SC-PRIC-020`), and each discount that reduced it moves in the share it fell
— a held add-on price, and a feature withdrawal's reduction of a booking, with that booking's
charges of its period, every other discount with the plan's —, to the cent, the remainder its own,
so no discount stays standing on what is no longer asked. Where something is still owed, a
replacement invoice follows under a new number and names the invoice it replaces: every charge
still owed in any part, a counter-entry that lowers it after its line, each line naming the line it
replaces and each counter-entry's line the line on the replacement whose charge it corrects
(`SC-AUD-013`); a charge owed no more, and its counter-entries, stand on no invoice that stands.
Where nothing is owed any more there is no replacement, and a replacement that would ask for less
than nothing is refused. The replacement names the parties of the invoice it replaces, the legal
entity it named as the issuer and the subscriber, rather than whichever entity `config/saas.yaml` or
whatever the subscriber's record names by then: the charges are owed between the parties of their
contract, and the subscriber's record may have kept only what its documents need (`SC-PRIV-013`).
It is a business letter of its own issue date, though: while `config/saas.yaml` names that same
entity, the replacement carries the address, the contact details and the footer lines the file
names for it on that day (`SC-PRIC-092`, `SC-PRIC-093`), so the account to pay into and the
managing directors are those of the day it is sent; the cancellation invoice keeps everything of
the invoice it cancels. Where a party detail on the cancelled invoice was wrong, such as the billing
address, the name or a tax identifier, the operator records the corrected detail with the
cancellation and its reason, and the replacement carries it; a correction of the issuer declared in
`config/saas.yaml` (`SC-PRIC-092`) or of the subscriber's legal identity (`SC-SUB-017`) applies as
well. The charges on the replacement are then invoiced there, so what was paid settles them like
the others, and the cancelled invoice no longer counts for them (`SC-PRIC-096`). What a payment for
the cancelled invoice settles moves with the charges, whether it was paid before the cancellation
or confirmed by the gateway after it: it is applied to the replacement as a new entry rather than
collected again, and where there is no replacement, or the payment exceeds it, the rest is a credit
on the subscriber's account for the operator to refund (`SC-PRIC-083`). A collection for the
cancelled invoice not yet submitted to the gateway is not submitted, and no invoice of its chain is
collected while one already submitted for any of them is unresolved (`SC-PRIC-036`). Where several
payments settled the cancelled invoice, they settle the replacement in the order they were
confirmed, the oldest first, and what remains of the most recent ones becomes the credit; each
payment's share is recorded, so a later reversal takes back exactly that payment's part
(`SC-PRIC-084`). The cancellation invoice, its replacement, its counter-entries and the movement of
what was paid onto the replacement or into a credit are written in one transaction, so an
interruption leaves all of them or none, and it takes its turn with everything else that changes the
invoice (`SC-PRIC-036`), so an invoice is cancelled once and a payment event that commits after the
cancellation settles the replacement or the credit rather than the cancelled invoice; archiving
each invoice then follows `SC-PRIC-033`.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md` · #334

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/invoice-cancel-cli-flow.test.js`
    - the preview is the command, and the cancellation the second one
        - without --apply it previews the invoice so numbered, and asks for neither factor nor
          confirmation
        - with --apply it asks for the second factor and the confirmation, cancels as the operator
          and records it
        - passes the corrections and the address on as typed, a correction left empty clearing its
          detail
        - passes each line on by its position, not owed as nothing and an amount as typed
- `packages/core/tests/a-cancellation-corrects-what-was-not-owed.test.js`
    - a line named as not owed, or owed in part
        - becomes what is owed of it, by a counter-entry that names it, the invoice and the reason
        - ${what}, moves by what is not owed
        - left out, stands as it stood, and no counter-entry is written
    - a discount, when what it reduced falls
        - falls in the same share, a counter-entry giving back what it no longer takes off
        - falls entirely with a plan owed no more
        - is rounded to the cent, the remainder its own
        - on half a cent, keeps the cent: away from nothing
        - held on a booking, follows the booking and leaves the plan’s discount alone
        - of the plan, follows the plan and leaves a booking’s held price alone
        - of another period, stays what it stands at
    - a line corrected before, along the chain
        - stands at its charge and every correction of it
        - moves from where it stands, so the corrections of a charge never take it below nothing
    - the replacement’s lines
        - carry a line owed in part with its counter-entry after it, naming it
        - leave out a line owed no more and what follows it, and keep a line that was nothing
        - are none where nothing is owed any more, a line of nothing aside
        - renumber a correction line carried over, still naming its charge’s line
- `packages/core/tests/a-reversal-takes-a-payment-back.test.js`
    - what a reversal opened, gathered on the invoice that stands in its chain
        - a give-back settles the replacement of a cancelled invoice the reversal opened
        - keeps the invoice where a cancellation left no replacement, and counts in cents
- `packages/core/tests/an-invoice-is-corrected-by-a-cancellation.test.js`
    - the cancellation invoice
        - states the cancelled invoice reversed, each line naming the line it cancels
        - carries the cancelled invoice’s parties, footer, treatment and period, not what holds
          today
        - asks for nothing: no payment, due on the day it is issued, nothing paid on issue
        - is numbered in the year of its issue date in the installation’s zone: ${why}
    - the replacement
        - invoices the same charges, each line naming the line it replaces, under the treatment
          decided now
        - names the parties and the footer it is given, and keeps the cancelled invoice’s period
        - runs its payment term from its own issue date
        - collected by direct debit, falls due on the day it is announced to be collected
        - takes over what was paid, as far as it owes it: ${why}
        - without a payment method in use, is collected by nothing
    - the subscriber a replacement names before the operator corrects it
        - takes each correction of its legal identity recorded after the invoice, the oldest first
        - leaves one recorded before the invoice, or at the same moment, to the invoice
    - the operator’s corrections of the subscriber
        - are applied, and recorded each with the value it replaced
        - a detail given as it stands, or none given, corrects nothing
        - a detail may be cleared, but a party is never named by nothing
    - each payment’s share of a cancelled invoice
        - is what its settlements there still come to, as each is signed
        - counts in cents, not in binary fractions
        - of a payment that was not read stops the cancellation
        - moves onto the replacement the oldest first, and what it does not take is credited
        - moves by what the replacement owes: ${why}
        - confirmed at the same moment, move in the order of their ids
        - state as paid on the replacement what moves onto it, a share below nothing counting for
          nothing
        - of nothing, or taken back in full, move nothing
    - what a corrected invoice owes
        - a cancelled invoice and its cancellation invoice owe nothing, whatever they state
        - any other owes its total less what is settled
- `packages/core/tests/an-invoice-row-becomes-a-record.test.js`
    - an invoice row becomes a record
        - that says what it corrects, as a cancellation invoice or a replacement, from either
          adapter’s row
- `packages/invoice-zugferd/tests/renders-an-invoice-the-german-adapter-accepts.test.js`
    - a replacement
        - paid already, states what was paid and that nothing is due, and names no way of paying
        - paid in part, announces the debit of what is left alone
    - a replacement that lowers a line
        - names, beside the counter-entry, the line it corrects, in the file and on the page
- `packages/nest/tests/a-corrected-vat-id-is-checked-and-recorded.test.js`
    - the tax origin of a party an invoice names
        - counts its number as validated where the record holds that same number with a valid check
        - counts a number the record does not hold as not validated, and takes the party’s country
        - counts a number the record held and no longer holds as not validated, however its check
          went
        - counts the record’s own number as not validated where its check found it invalid
- `packages/nest/tests/an-invoice-is-cancelled.test.js`
    - an invoice cancelled by the operator
        - is written as its preview showed it, and the preview writes nothing
        - is reversed by its cancellation invoice, which asks for nothing, and replaced under a term
          of its own
        - collected by direct debit, the replacement announces its own day
        - names the subscriber as the operator corrected it, and as its legal identity was corrected
          since, not its contact details
        - decides the replacement’s tax for the parties it names: a case the adapter does not treat
          is refused, and nothing is written
        - paid already, moves what was paid onto the replacement, which is then collected no further
        - paid in part, the replacement is collected for the rest alone
        - states as paid on the replacement what moves onto it, and no share below nothing
        - withdraws a collection of it planned and not yet made
    - a cancellation refused
        - for an invoice that does not exist
        - for an invoice cancelled already, and for a cancellation invoice, drawing no number
        - while the invoice’s document is not archived
        - where the subscriber can be reached at no address, until one is given
        - for an invoice that states a credit
        - where the direct debit in use names no mandate the replacement could announce
        - at every start without the transaction it is written on
    - a cancellation that says what was not owed
        - lowers a line owed in part, its discount in the same share, by counter-entries the
          replacement carries
        - owed no more, leaves no replacement, its charges and their counter-entries on no invoice
          that stands
        - owed no more and paid, credits everything that was paid
        - owed in part and paid, credits what the replacement no longer asks for
        - is written as its preview showed it, held to the digest of that preview
        - is refused where it ${what}, and nothing is written
        - names the line where it ${what}
        - lowers a held add-on price with its booking, read off its contract line, and leaves the
          plan’s discount
        - owed for a cent less than all of it, is written
        - is refused where what is left asks for less than nothing, and nothing is written
- `packages/tax-de/tests/an-invoice-document-is-the-file-german-law-asks-for.test.js`
    - a replacement
        - that took over what was paid for the invoice it replaces › stating it as paid, and the
          amount due less it, passes
        - that took over what was paid for the invoice it replaces › stating ${what} is refused

<!-- END proof -->

### SC-PRIC-089 — A cancellation is titled as one, and a correction names the invoice it corrects

🟢 💰 The shipped renderer gives a cancellation invoice the title "Stornorechnung", never
"Gutschrift", which German VAT law reads as a statement of self-billing by the recipient, and the
EN 16931 type of a credit note. Its page states the amounts of the invoice it cancels reversed, so
that the two add up to nothing, and asks for nothing; its XML states them as a credit note does, as
they stood on that invoice. A replacement is an invoice. Each names the invoice it corrects by number
and issue date, on the page and as the document reference a program reads, together with the reason
given for the cancellation, and each of its lines names the line it cancels or replaces
(`SC-AUD-013`). The format's own validators check both in CI, as they check every invoice
(`SC-PRIC-078`), and the German adapter's check of a document refuses one whose type, figures or
reference are not what the invoice records.

_Source:_ #334 (decided 2026-10-18) · #276

<!-- BEGIN proof -->

_Tested by:_

- `packages/invoice-zugferd/tests/renders-an-invoice-the-german-adapter-accepts.test.js`
    - a cancellation invoice
        - is titled Stornorechnung on its page and in its metadata, and no document is a Gutschrift
        - names the invoice it cancels and why, beside its facts and under its title
        - states the cancelled amounts reversed, each line naming the line it cancels, and asks for
          nothing
        - names no way of paying, whatever payment method its record still carries
        - under the reverse charge states its tax as nothing, not as minus nothing
        - carries a credit note stating the cancelled invoice’s amounts, naming it and why
    - a replacement
        - is an invoice naming the invoice it replaces and why, and each line the line it replaces
        - paid already, states what was paid and that nothing is due, and names no way of paying
        - paid in part, announces the debit of what is left alone
- `packages/tax-de/tests/an-invoice-document-is-the-file-german-law-asks-for.test.js`
    - a cancellation invoice
        - stating the cancelled figures as a credit note, naming the invoice it cancels, passes
        - ${what} is refused
    - a replacement
        - naming the invoice it replaces passes
        - naming none is refused, and so is one stated as a credit note
        - that took over what was paid for the invoice it replaces › stating it as paid, and the
          amount due less it, passes
        - that took over what was paid for the invoice it replaces › stating ${what} is refused

<!-- END proof -->

### SC-PRIC-026 — An invoice carries the issuer and the subscriber as they were on the day it was issued

🔵 _(Superseded on 2026-10-20 by `SC-PRIC-092`.)_ 💰 The issuer's identity, its legal name and tax
identifiers, is the counterparty a contract names (`SC-AUD-020`), so an invoice takes that identity
from the copy on the contract its charges belong to, with a declared correction of that entity
applied; its address and contact details come from `config/saas.yaml` on the issue date while the
configuration names that same identity, and from the contract's copy otherwise. The subscriber's
details are copied from its record. A cancellation or replacement invoice keeps both parties of the
invoice it corrects instead (`SC-PRIC-025`). Either way a later change leaves the invoice as it was,
and a new contract takes its issuer from `config/saas.yaml`. An installation that names a different
identity while contracts with the previous one still run does not start, and names those contracts:
moving a contract to another legal entity is a transfer, not an edit of a setting, and an invoice
never asks for payment on behalf of an entity the contract was not concluded with. A correction of
the same entity, such as a misspelt name, a wrong tax identifier or a change of name that entity
went through, starts once `config/saas.yaml` declares it as one beside the values it replaces; the
settings record keeps that declaration (`SC-CFG-025`), and invoices issued afterwards carry the
corrected identity.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-092 — An invoice carries the issuer and the subscriber as they were on the day it was issued

🟢 💰 The issuer's identity, its legal name and tax identifiers, is the counterparty a contract names
(`SC-AUD-020`), so an invoice takes that identity from the copy on the contract its charges belong
to, with a declared correction of that entity applied; its address and contact details come from
`config/saas.yaml` on the issue date while the configuration names that same identity, and from the
contract's copy otherwise. The subscriber's details are copied from its record. A cancellation
invoice keeps both parties of the invoice it cancels; a replacement names the legal entity and the
subscriber of the invoice it replaces, and takes the issuer's address and contact details as an
invoice issued on its day does (`SC-PRIC-095`). Either way a later change leaves the invoice as it
was, and a new contract takes its issuer from `config/saas.yaml`. An installation that names a
different identity while contracts with the previous one still run does not start, and names those
contracts: moving a contract to another legal entity is a transfer, not an edit of a setting, and an
invoice never asks for payment on behalf of an entity the contract was not concluded with. A
correction of the same entity, such as a misspelt name, a wrong tax identifier or a change of name
that entity went through, starts once `config/saas.yaml` declares it as one beside the values it
replaces; the settings record keeps that declaration (`SC-CFG-025`), and invoices issued afterwards
carry the corrected identity.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md` · #334

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
- `packages/core/tests/an-invoice-names-the-issuer-of-its-contract.test.js`
    - the issuer an invoice names
        - is the file’s, address and all, while the file names the entity the contract copied
        - is the file’s where the operator declared the change a correction of that entity
        - follows one declared correction after another back to the copy
        - stays the corrected one after the declaration has left the file
        - is the contract’s copy where nothing recorded connects it to the file’s entity
        - is the contract’s copy where the recorded change was not declared a correction
        - is the contract’s copy where the declaration names another value than the copy holds
        - is not moved by a correction of an entity the contract was not concluded with
        - is not moved by a recorded change of any other setting
        - is the contract’s copy where the file names no issuer
        - reads the copy and the file the way the start does, so a stray space is the same entity
        - reads a recorded block it cannot use as no identity rather than as a wrong one
    - the footer an invoice carries
        - is the file’s where the invoice names the entity the file names
        - is none where the invoice names the contract’s copy of another entity
        - is none where the file names no issuer
        - is a copy the file’s lines cannot change afterwards
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
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - the parties an invoice names
        - are the subscriber as its record stands and the issuer the file names
        - name the issuer’s corrected identity where the operator declared the correction
        - follow the corrections in the order the record went through them, whatever the clocks said
        - name the contract’s copy where nothing recorded connects it to the file’s issuer
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

(decided 2026-10-20)

### SC-PRIC-077 — An invoice carries the issuer's footer as it was on the day it was issued

🔵 _(Superseded on 2026-10-20 by `SC-PRIC-093`.)_ 💰 What a business letter of the issuer has to state
beyond the invoice's own content, such as the register court and number and the managing directors
of a GmbH, or the bank account to pay into, is named in `config/saas.yaml` as lines of text, so that
it fits any legal form. An invoice copies those lines on its issue date, as it does the issuer's
address (`SC-PRIC-026`), and its document shows them; a later change leaves the invoices issued
before as they were, and a cancellation or replacement invoice keeps the lines of the invoice it
corrects (`SC-PRIC-025`). The lines are those of the entity the file names, so an invoice that names
the contract's copy of another entity carries none rather than another company's register or
account.

_Source:_ #332 · #276

### SC-PRIC-093 — An invoice carries the issuer's footer as it was on the day it was issued

🟢 💰 What a business letter of the issuer has to state beyond the invoice's own content, such as the
register court and number and the managing directors of a GmbH, or the bank account to pay into, is
named in `config/saas.yaml` as lines of text, so that it fits any legal form. An invoice copies
those lines on its issue date, as it does the issuer's address (`SC-PRIC-092`), and its document
shows them; a later change leaves the invoices issued before as they were. A cancellation invoice
keeps the lines of the invoice it cancels, and a replacement, a letter of its own issue date,
carries the lines the file names on that day (`SC-PRIC-095`). The lines are those of the entity the
file names, so an invoice that names the contract's copy of another entity carries none rather than
another company's register or account.

_Source:_ #332 · #276 · #334 (decided 2026-10-20)

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-invoice-names-the-issuer-of-its-contract.test.js`
    - the footer an invoice carries
        - is the file’s where the invoice names the entity the file names
        - is none where the invoice names the contract’s copy of another entity
        - is none where the file names no issuer
        - is a copy the file’s lines cannot change afterwards
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - the footer of an invoice
        - is the lines the file names on the issue date, and stays when the file changes after
        - is none where the file names none
        - is none where the invoice names the contract’s copy of another entity
        - is the file’s where the invoice names the issuer’s corrected identity

<!-- END proof -->

### SC-PRIC-027 — An invoice carries what the tax law of its issuer requires of it

🟡 _(Decided, not yet delivered.)_ 💰 The installation's tax adapter (`SC-PRIC-037`) names that
content, the names of the documents and the note each tax treatment needs, and checks an invoice's
content against them before its number is drawn (`SC-PRIC-072`). An invoice missing any of it draws
no number and is not issued, and the operator is shown what is missing, such as a billing address
the format rejects; once it is corrected, the invoice takes the next number then. Another country's
law is another adapter rather than an addition to one, and German law is the first (`SC-PRIC-064`).

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-invoice-is-issued.test.js`
    - an invoice that cannot be issued yet
        - waits for the subscriber’s address, draws no number, and takes the next one once it is
          complete
        - is recorded in the audit log once, however many runs find it waiting
        - is recorded in the audit log once between two runs at the same moment
        - is recorded in the audit log by the next run where the write failed
        - waits where the adapter supports no treatment for the subscriber
        - waits for what the adapter finds missing, and draws no number
        - is shown to the adapter as it would be issued
        - waits under a contract ${what}
        - keeps no other subscription waiting, however many wait before it
- `packages/nest/tests/invoices-start-only-as-configured.test.js`
    - invoices start
        - where they are wired, the file names their range and term, an adapter decides and an
          issuer is named
        - with the quarter-hourly run unless the application leaves it out
        - not where the application wires them and the file names no range or term
        - not where the file names them and the application wires none
        - not without the ${port} of their documents, which the refusal names
        - not beside an archive that would let a document it keeps be changed, naming why
        - not without a tax adapter, nor without an issuer
        - not without a payment gateway, which the refusal names
        - and no wiring nor block at all is no invoicing, and starts
- `packages/tax-de/tests/an-invoice-carries-what-german-law-requires.test.js`
    - what an invoice of an issuer in Germany has to carry
        - a complete invoice lacks nothing
        - the ${side}'s ${field}, missing or blank, is named
        - the ${side}'s second address line may be missing
        - the issuer's tax number or its VAT number — either is enough, neither is a gap
        - the reverse charge names both parties' VAT numbers, and its note
        - a standard invoice asks for no VAT number of the subscriber
        - a ${kind} invoice says why it carries no German VAT
        - an invoice without lines, or with a line nobody named, is not complete
        - every gap is named, in the order an invoice reads
    - an invoice's tax, once per rate
        - is the rate applied to the net total, not the sum of the lines’ rounded taxes
        - keeps each rate apart, the lowest first, and a discount lowers its rate’s net

<!-- END proof -->

### SC-PRIC-028 — A direct debit is announced before it is collected

🟢 💰 The invoice states the amount, the collection date and the
mandate reference, and it reaches the subscriber at least the lead time named in
`config/saas.yaml` before the collection. A collection whose date or mandate differs from what the
invoice announced, such as after the payment method was replaced or a collection is retried, is
announced again with its own date and mandate reference, the same lead time before it; that notice
stands on its own and leaves the invoice as it was issued (`SC-PRIC-095`).

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-failed-collection-is-planned-once-more.test.js`
    - a payment method that failed
        - is charged once more where funds were short or a refusal named no cause
        - is not charged again for a reason that cannot pass
        - is not charged a third time: one earlier failure with it ends its tries
        - that replaced one which failed gets its own second try
        - a withdrawn plan with it does not count as a try
        - an attempt that did not fail is not followed by another
    - the day a card is charged again
        - is ${COLLECTION_RETRY_AFTER_DAYS} days after a failure on ${failedOn}: ${expected}
    - the day a direct debit announced again is collected
        - is the lead time after its announcement where that is later than the day planned
        - is the day planned where the lead time ends before it
        - is the day planned where the lead time ends on it
        - counts the lead time across a month and a year
- `packages/core/tests/an-invoice-is-drawn-up-from-its-charges.test.js`
    - how an invoice is paid
        - a direct debit is collected the lead time after the issue date, the day it falls due,
          under its mandate
        - the lead time counts in the installation’s zone, across a month and a year, whatever the
          payment term
        - a card is recorded with the invoice, which falls due the payment term after the issue date
        - without a payment method the invoice is not collected and falls due the payment term after
        - an invoice that asks for ${what} is collected with nothing
        - an invoice that asks for a cent is collected
        - refuses a direct debit without the mandate reference it would have to announce
        - is what the adapter is asked to check, the due date included
- `packages/core/tests/an-invoice-row-becomes-a-record.test.js`
    - an invoice row becomes a record
        - that says how the invoice is paid, from either adapter’s row
- `packages/invoice-zugferd/tests/renders-an-invoice-the-german-adapter-accepts.test.js`
    - an issued invoice rendered by the default renderer
        - (${name}) is the file the German adapter asks for, named by its number
        - is the same bytes every time, whatever was rendered in between
        - is dated from the moment the invoice was issued, not the clock
        - of another invoice is another file, under another identifier
    - what the page says
        - the parties, the invoice’s facts, its lines and its total, labelled in German and English
        - the subscriber’s VAT id and its country by name, under the reverse charge
        - a direct debit announced with its amount, the day it is collected from and its mandate, in
          German and English
        - a card named by the last four digits of its number, and nothing more
        - the treatment’s note before how the invoice is paid, each a paragraph of its own
        - no document for a direct debit without ${what}, which its announcement names
        - nothing about a payment where the invoice is not collected
        - the footer lines and the page’s number on every page of an invoice that runs on
        - a footer line wider than the page, broken onto the next line, on every page
        - a name or an address line wider than its column, all of it, line after line
        - no footer where the invoice carries none
        - Greek and Cyrillic in their letters, a character its font has no glyph for as ?, and the
          XML as written but for what XML cannot hold
    - where the page sets its text
        - (${name}) keeps every run of text between the margins, clear of every other
        - (${name}) leaves 5 mm at least between the foot and the text above it
    - a figure
        - of ${amount} reads ${page} on the page and ${xml} in the XML
        - taken off at the smallest amount reads -0,01, as one unit taken back at 0.01
    - the XML it carries
        - takes a line off as one unit taken back at a price that is not negative
        - names the categories and reasons EN 16931 asks for each treatment
        - outside the scope of VAT, names no VAT id and no rate, and identifies the seller otherwise
        - of a small business with a tax number only, identifies the seller by it
        - under the reverse charge, names both VAT ids
    - a cancellation invoice
        - is titled Stornorechnung on its page and in its metadata, and no document is a Gutschrift
        - names the invoice it cancels and why, beside its facts and under its title
        - states the cancelled amounts reversed, each line naming the line it cancels, and asks for
          nothing
        - names no way of paying, whatever payment method its record still carries
        - under the reverse charge states its tax as nothing, not as minus nothing
        - carries a credit note stating the cancelled invoice’s amounts, naming it and why
    - a replacement
        - is an invoice naming the invoice it replaces and why, and each line the line it replaces
        - paid already, states what was paid and that nothing is due, and names no way of paying
        - paid in part, announces the debit of what is left alone
        - paid in part, announces the debit of what is left alone
    - a replacement that lowers a line
        - names, beside the counter-entry, the line it corrects, in the file and on the page
    - an invoice that corrects none
        - names no invoice it corrects and no reason
    - a font the application passes
        - is the one the page is set in
- `packages/nest/tests/a-failed-collection-is-tried-again.test.js`
    - a direct debit that failed for a reason that can pass
        - is announced again under its mandate for the lead time after, and debited on that day, not
          the minute before
        - whose announcement the mail refused is announced the next day, for the lead time after
          that day
        - that was announced without the announcement being recorded keeps the day it was told, and
          is not announced twice
    - a direct debit whose invoice reached the subscriber too late for its day
        - is announced again for the lead time after, and debited then rather than on the day it
          named
- `packages/nest/tests/an-invoice-is-collected.test.js`
    - a direct debit and the lead time of its announcement
        - by direct debit mailed exactly the lead time before its day is collected on that day
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - how an invoice is paid
        - a direct debit in use is announced with its mandate, collected and due fourteen days after
          the issue date
        - the lead time the file names counts instead, whatever the payment term
        - a card in use is recorded, and the invoice falls due the payment term after the issue date
        - without a payment method the invoice is not collected and falls due the payment term after
        - a direct debit without a mandate reference holds the invoice, which draws no number until
          the payment method is replaced
        - a direct debit without a mandate reference holds nothing where the invoice asks for
          nothing
        - is the payment method in use when it is issued: not the one it replaced, and a later one
          changes nothing
        - is the subscriber’s own, beside another subscriber’s
        - is collected with nothing where the invoice asks for nothing
- `packages/nest/tests/invoices-start-only-as-configured.test.js`
    - the payment methods invoices are collected with
        - are read where the file names payment accounts and the platform composes the payments
        - refuse the start where the file names payment accounts and nothing reads them
        - refuse the start where the invoices are collected and nothing records what they brought
        - refuse the start where the invoices are collected and nothing records what the subscriber
          is told
        - refuse the start where the file names payment accounts and nothing collects the invoices

<!-- END proof -->

### SC-PRIC-029 — A payment is recorded against its invoice once the gateway has confirmed it

🟢 💰 A confirmation that arrives twice records one payment, as
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

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-payment-is-recorded-and-a-credit-paid-out.test.js`
    - a payment the gateway confirmed
        - is recorded against its invoice by the run that collected it, settling what it owes, and
          audited once
        - reported by the gateway's callback settles the attempt at once, and the run that asks
          later records nothing more
        - reported again is a duplicate, and reported under another event changes nothing
        - for an attempt this installation does not hold, or one another account reports, records
          nothing
        - under another reference than the attempt recorded records nothing
        - whose recording fails leaves the event unclaimed, and the redelivery records it
        - whose audit entry cannot be written stays recorded
        - reported after the attempt was recorded as failed is recorded all the same, and what was
          planned after it is not sent
    - an invoice a late payment covered
        - is collected no further when the attempt beside it fails, and nobody is told of a failure
          on a paid invoice
        - has a retry whose request never reached the gateway settled rather than sent again
        - sends nothing again for a request a report settled while the gateway was asked
        - records nothing twice for a report that arrives after the run decided to send again
        - has a planned attempt withdrawn rather than sent, naming why
- `packages/nest/tests/invoices-start-only-as-configured.test.js`
    - the payment methods invoices are collected with
        - refuse the start where the invoices are collected and nothing records what they brought
- `packages/payment-stripe/tests/a-payment-and-a-refund-are-reported.test.js`
    - what became of a payment intent
        - a success is reported with what Stripe received, for the attempt its key names
        - an event delivered late reports the intent as it stands now
        - a debit on its way, and a failure with its reason, are reported as they stand
        - an intent SaaSiCat did not create is not its to act on
    - a refund made in the Dashboard
        - ${status} is reported as ${reported}, with the payment it pays back
        - is read again from Stripe with its payment intent, whatever the event carried
        - of a payment SaaSiCat did not collect, or of none, is not its to act on
        - in a state Stripe does not document is refused, so Stripe delivers it again
    - a dispute of a payment
        - ${type} reports what Stripe withdrew and gave back so far, the fee left out
        - is read again from Stripe with its payment intent, and its charge's
        - naming no payment intent of its own is found through its charge
        - that withdrew nothing yet, an inquiry, is no reversal
        - of a payment SaaSiCat did not collect, or of none, is not its to act on
        - moving money in another currency than it disputes is refused, so Stripe delivers it again
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a payment is recorded, and a credit paid out
        - a database from before ends up with the schema the fragments declare, twice
        - a payment is taken once under its gateway account and reference, and another account may
          reuse the reference

<!-- END proof -->

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
- `packages/nest/tests/a-reversal-reopens-an-invoice.test.js`
    - the start
        - is refused while a credit not paid out is held at an account the file no longer names,
          which it names
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
- `packages/nest/tests/an-invoice-is-collected.test.js`
    - collecting starts
        - not while an attempt not settled is held at an account the file no longer names, which it
          names
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

🔵 _(Superseded on 2026-10-15 by `SC-PRIC-084`.)_ 💰 Either is recorded as a counter-entry rather than
an edit of the payment, and a report that arrives twice records one reversal. A reversal takes back
everything the payment settles when it arrives, divided across all of it: the invoice it was
collected for, or the replacement its settlement moved to under `SC-PRIC-025`, opens again by the
part the payment settled there, and the credit it became shrinks by its part; never an invoice
already cancelled. A partial reversal reduces the credit first and reopens invoices only with what
remains, so the operator is not left refunding what is owed again. Where the credit's part was
already refunded, that part is shown to the operator to reconcile. A refund is different: SaaSiCat
never initiates one (`SC-PRIC-076`), and one the operator makes in the gateway is recorded against
the credit it pays out, reopening nothing; a refund that matches no credit is shown to the operator
to reconcile. A credit the gateway can no longer refund, because the payment's gateway account is no
longer configured (`SC-PRIC-030`) or the gateway's own refund period has passed, is paid out by the
operator outside the gateway, such as by bank transfer, and the operator records that payout with
its reference against the credit; SaaSiCat still initiates nothing. What follows a reversal is
`SC-PRIC-081`'s: the invoice it reopens is unpaid like any other.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-083 — A credit is paid out by the operator, and never offset against a later invoice

🟢 💰 A credit arises where a payment brings more than its invoice
still owes, and where an invoice's total is negative, such as one carrying the unused rest a
withdrawal credits (`SC-PRIC-075`); either is recorded on the subscriber's account once. It is
never offset against a later invoice, so every invoice is collected for the amount it states. The
operator pays it out: by a refund in the gateway, recorded against the credit when the gateway
reports it — the credit the refunded payment left first, then the oldest —, or, where the gateway
can no longer refund, by a transfer the operator records with its reference (`SC-PRIC-084`). A
refund that fails or is canceled gives back what it paid out. SaaSiCat initiates neither
(`SC-PRIC-076`), and nothing is paid out beyond what a credit still owes: a payout over it is
refused, and the part of a refund that no credit takes is recorded as matching none.

_Source:_ #333 (decided 2026-10-14) · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-payment-settles-its-invoice-and-a-credit-is-paid-out.test.js`
    - what an invoice still owes
        - is its total less what is settled against it, to the cent
        - is negative for an invoice whose total is negative
    - a payment against what its invoice owes
        - ${why}
    - what a credit still owes
        - is its amount less what refunds and payouts paid out
        - takes back what a failed refund gave back
        - never goes below nothing
    - a refund divided across the open credits
        - takes the credit the refunded payment left first, then the oldest
        - takes the oldest first where the payment left none
        - leaves what no credit takes as matching nothing, one cent included
        - skips a credit that owes nothing
        - orders credits of one moment by id, so both adapters divide alike
    - a payment row
        - is written for the subscriber its invoice names, with the amount as written
        - reads back from either adapter’s amount
        - refuses an amount that is none
    - a settlement row
        - a payment and a reinstatement take their amount off what the invoice owes
        - a reversal adds its amount back to what the invoice owes
        - of a kind this release does not know stops the read
    - a credit row
        - reads back with the one place it comes from
        - naming two places or none stops the read
    - a credit entry row
        - of a payout carries its reference, its day and who recorded it, and no refund
        - reads the day back from a Prisma date
        - of a refund names the refund and its reference at the gateway, and its failure gives the
          same amount back
        - a payout naming a refund, or a refund entry naming none, stops the read
        - of a kind this release does not know stops the read
    - a refund row
        - is written against the payment it pays back, for that payment’s subscriber
        - first seen as failed or canceled is written as ended
        - reads back, and an end that does not fit its status stops the read
- `packages/nest/tests/a-payment-is-recorded-and-a-credit-paid-out.test.js`
    - a refund the operator made in the gateway
        - is recorded against the credit its payment left, once, and audited
        - beyond what the subscriber is owed is recorded, and what matches nothing is a case to
          reconcile, audited
        - that fails gives back what it paid out, once
        - of an attempt this installation does not hold, or another account sent, records nothing
          and is not refused
        - of a payment not recorded yet is refused, so the gateway delivers it again once it is
    - an invoice whose total is negative
        - is credited to its subscriber once, by the run after it was issued
- `packages/nest/tests/an-operator-reads-and-pays-out-a-credit.test.js`
    - the operator reads a subscriber's credits
        - the oldest first, each named by the invoice it comes from, with what is open
        - of a subscriber there is not are refused, by code
        - a refund paid out of a credit is shown with its reference at the gateway
    - a payout the operator records
        - is written against the credit, with its reference and who recorded it, up to what is open
        - beyond what the credit still owes is refused, naming what is open, and nothing is written
        - of another subscriber's credit is refused as one that does not exist
        - on a day still to come in the installation’s zone is refused, and today is not
- `packages/payment-stripe/tests/a-payment-and-a-refund-are-reported.test.js`
    - a refund made in the Dashboard
        - ${status} is reported as ${reported}, with the payment it pays back
        - is read again from Stripe with its payment intent, whatever the event carried
        - of a payment SaaSiCat did not collect, or of none, is not its to act on
        - in a state Stripe does not document is refused, so Stripe delivers it again
- `packages/ui-vue/tests/component/an-operator-pays-out-a-credit.test.ts`
    - the subscriber's record shows its credits
        - where each comes from, what was paid out and what is open, the oldest first
        - offers a payout only for a credit with something open
        - without the capabilities, shows nothing and reads nothing, and offers no payout with the
          view alone
    - a payout the operator records in the record
        - opens with what is open, is sent once a reference names it, with the second factor
        - is dated today in the installation's time zone, read again each time the dialog opens
        - more than is open cannot be sent
    - the payout the form describes
        - is what is open, a reference and a note trimmed, an empty note as none
- `packages/ui-vue/tests/subscriber-credits-resource.test.js`
    - subscribersResource.credits
        - asks for the subscriber's credits, with its id escaped
        - an answer with no credits is an error, not a subscriber with none
    - subscribersResource.recordPayout
        - posts the payout against the credit, both escaped, with the second factor
- `packages/ui-vue/tests/use-subscriber-credits.test.js`
    - the credits of a subscriber
        - are read where the platform serves them
        - are neither read nor offered where it does not, and a payout only with both
    - a payout
        - is recorded behind the second factor, announced, and the credits read again
        - where the operator steps back from the second factor records nothing and answers null
        - that fails rejects, so the dialog keeps the form, and announces nothing
        - belongs to the subscriber it was asked on, even if the page moved on meanwhile

<!-- END proof -->

### SC-PRIC-084 — A returned debit or a chargeback is recorded, and what the payment settled opens again

🟢 💰 Either is recorded as a counter-entry rather than an edit of the payment, and a report that
arrives twice records one reversal. A reversal takes back what the payment brought, the credit
first, so the operator is not left refunding what is owed again: the credit the payment left
shrinks by what is still open of it; the part of that credit already refunded or paid out is shown
to the operator to reconcile (`SC-ADM-039`); and only what remains opens again the invoices the
payment settles, each by no more than the payment settles there. A refund is different: SaaSiCat
never initiates one (`SC-PRIC-076`), and one the operator makes in the gateway is recorded against
the credit it pays out, reopening nothing; the part of a refund that no credit takes is shown to the
operator to reconcile. A credit the gateway can no longer refund — its own refund period has
passed, or the account at the provider refunds no more — is paid out by the operator outside the
gateway, such as by bank transfer, and the operator records that payout with its reference against
the credit (`SC-PRIC-083`); SaaSiCat still initiates nothing. What follows a reversal is
`SC-PRIC-085`'s, and a reversal the gateway takes back is `SC-PRIC-086`'s.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md` · #333

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/a-reversal-takes-its-turn-in-statements.test.js`
    - a reversal
        - takes the turn of every invoice its payment settles, in one order, then the credits, then
          its own row
        - of a payment this installation does not hold, holds and writes nothing
        - in another currency than its payment, is refused before anything is held
        - held under its reference against another payment, is refused
        - is found by its id, and none by another
    - the cases to reconcile
        - the open ones are read the oldest first, a page at a time, for one subscriber where named
        - the closed ones are read without a cursor in one statement
        - one is closed only where it is still open, and one closed before or unknown is answered as
          such
    - what the credits and invoices read
        - what each invoice owes is read in three statements, and nothing is asked for none
        - the accounts holding credits are asked with the kinds that give back
- `packages/adapter-prisma/tests/a-reversal-is-written-in-its-payments-turn.test.js`
    - a reversal
        - takes the turn of every invoice its payment settles, in one order, then the credits, then
          its own row
        - takes the open credit first, then opens the invoice, and writes its totals on its row
        - reported again unchanged, writes nothing but the row it skips
        - grown since the last report, writes only what grew
        - meeting a credit already paid out and going beyond the payment, opens one case
        - takes a credit another payment for the same invoice left before it opens the invoice
        - of a payment this installation does not hold, writes nothing
        - in another currency than its payment, is refused before anything is held
        - held under its reference against another payment, is refused
    - a reversal given back
        - in full, gives back what it took of the credit, settles the invoice again, and only once
        - closes the case it opened first, as SaaSiCat and saying why
        - after the invoice was paid again, leaves what it no longer owes as a credit from the
          reversal
    - the cases to reconcile
        - are read open or closed, the oldest first, a page after the case it names
        - one is closed with the operator’s note once, and an unknown one is answered as such
        - a refund’s part no credit takes opens one, once, and its failure closes it
    - what the credits and invoices read
        - what each invoice owes is read in three statements, and nothing is asked for none
        - a reversal is found by its id, and none by another
        - the accounts holding credits are asked with the kinds that give back, and read as texts
        - an invoice that owes less than nothing becomes a credit of its own, once
- `packages/core/tests/a-payment-settles-its-invoice-and-a-credit-is-paid-out.test.js`
    - a settlement row
        - a reversal adds its amount back to what the invoice owes
- `packages/core/tests/a-reversal-takes-a-payment-back.test.js`
    - what a reversal takes back of what its payment brought
        - without a credit, the invoices it settles, the oldest first
        - the credit first: its open part, then the invoice with the rest
        - a partial reversal no larger than the credit shrinks the credit alone
        - several credits of the payment are taken in the order given, each up to what of it is left
        - what of each of them is paid out is told apart, and matches nothing
        - why
        - the part of the credit already paid out matches nothing
        - takes from what of the credit an earlier reversal left
        - what goes beyond everything the payment brought matches nothing
        - passes over an invoice it already opened in full
        - counts in cents, not in binary fractions
- `packages/core/tests/an-invoice-is-corrected-by-a-cancellation.test.js`
    - the credits a payment left, once a cancellation left one more
        - are its own, its surplus and its share alike
        - are taken by a reversal the earliest first, what its reversals took counted against them
          in that order
        - are what a refund of the payment pays back first, the oldest of them first
- `packages/nest/tests/a-reversal-reopens-an-invoice.test.js`
    - a reversal the gateway reports
        - opens the invoice again, marks the attempt reversed, and is recorded and audited once
        - that only shrinks a credit leaves the attempt and the invoice as they were
        - of an attempt this installation does not hold records nothing
        - of a payment not recorded yet is refused, and recorded when the gateway delivers it again
        - that meets a credit already refunded opens a case, audited for the operator
- `packages/payment-stripe/tests/a-payment-and-a-refund-are-reported.test.js`
    - a dispute of a payment
        - ${type} reports what Stripe withdrew and gave back so far, the fee left out
        - is read again from Stripe with its payment intent, and its charge's
        - naming no payment intent of its own is found through its charge
        - that withdrew nothing yet, an inquiry, is no reversal
        - of a payment SaaSiCat did not collect, or of none, is not its to act on
        - moving money in another currency than it disputes is refused, so Stripe delivers it again
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a payment is recorded, and a credit paid out
        - a database the first version of it left gains the reversals and the cases, twice
        - a reversal is taken once under its gateway account and reference

<!-- END proof -->

(decided 2026-10-14 and 2026-10-15)

### SC-PRIC-085 — A reversal is told, and the payment method it reversed collects nothing again

🟢 💰 A reversal that opens an invoice again is told to the subscriber at the invoice email, once:
which invoice is open again and by how much, and what follows. Nothing is collected again with the
payment method the reversed payment was made with — a direct debit collected again within the
weeks a bank honours a return without question comes back the same way, and charging a card again
after a chargeback counts against the operator —, so the notice asks the subscriber to replace it;
where another payment method is already in use, the invoice is collected with that one, as after
a failure that asks for a replacement (`SC-PRIC-080`). A reversal that only shrinks a credit opens
nothing and tells nobody. An invoice left open is unpaid like any other (`SC-PRIC-081`).

_Source:_ #333 (decided 2026-10-14)

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-reversal-takes-a-payment-back.test.js`
    - a recorded collection-reversed notice
        - reads back as it was recorded
        - with what follows unknown, or without what it owes, stops the read
- `packages/nest/tests/a-reversal-reopens-an-invoice.test.js`
    - after a reversal opened an invoice again
        - the subscriber is told once, asked to replace the payment method, and nothing is collected
          from it again
        - with another payment method in use, the subscriber is told so and the invoice is collected
          with it
        - a direct debit that replaces the payment method waits until the subscriber heard of the
          reversal
        - a reversal given back before the run follows it up tells nobody
    - a payment that arrived late beside another attempt, reversed
        - is told once, and the invoice is collected with no payment method it was reversed on
        - waits while the attempt beside it is on its way, and tells nobody once that one paid
        - while the attempt beside it never left, that one is not sent with the reversed card, and
          one notice tells the subscriber
- `packages/nest/tests/an-invoice-is-cancelled.test.js`
    - the collections of a cancelled invoice’s chain
        - a failure of the cancelled invoice’s attempt is recorded and told to nobody, and the
          replacement is collected once it is resolved
        - a reversal is told only once no attempt of any invoice of the chain is on its way, about
          the invoice that stands
        - a reversal of a payment that moved tells the subscriber the replacement is open again
        - a reversal is followed up in its chain’s turn: read, told and marked on the transaction
          that holds the chain

<!-- END proof -->

### SC-PRIC-086 — A dispute won takes its reversal back, and what was paid meanwhile becomes a credit

🟢 💰 Where the gateway gives back what a reversal withdrew — a card dispute decided for the
operator —, the reversal is taken back part for part, once however often it is reported: the
credit it shrank is owed again, the cases it opened to reconcile are closed, saying why, and the
invoices it opened again are settled again as far as they still owe. What one of them no longer
owes, because the subscriber paid it meanwhile, becomes a credit on the subscriber's account
(`SC-PRIC-083`). A returned direct debit and a dispute lost are final, and nothing takes them back.

_Source:_ #333 (decided 2026-10-14)

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/a-reversal-is-written-in-its-payments-turn.test.js`
    - a reversal
        - takes the turn of every invoice its payment settles, in one order, then the credits, then
          its own row
        - takes the open credit first, then opens the invoice, and writes its totals on its row
        - reported again unchanged, writes nothing but the row it skips
        - grown since the last report, writes only what grew
        - meeting a credit already paid out and going beyond the payment, opens one case
        - takes a credit another payment for the same invoice left before it opens the invoice
        - of a payment this installation does not hold, writes nothing
        - in another currency than its payment, is refused before anything is held
        - held under its reference against another payment, is refused
    - a reversal given back
        - in full, gives back what it took of the credit, settles the invoice again, and only once
        - closes the case it opened first, as SaaSiCat and saying why
        - after the invoice was paid again, leaves what it no longer owes as a credit from the
          reversal
    - the cases to reconcile
        - are read open or closed, the oldest first, a page after the case it names
        - one is closed with the operator’s note once, and an unknown one is answered as such
        - a refund’s part no credit takes opens one, once, and its failure closes it
    - what the credits and invoices read
        - what each invoice owes is read in three statements, and nothing is asked for none
        - a reversal is found by its id, and none by another
        - the accounts holding credits are asked with the kinds that give back, and read as texts
        - an invoice that owes less than nothing becomes a credit of its own, once
- `packages/core/tests/a-reversal-takes-a-payment-back.test.js`
    - what the gateway gives back of a reversal
        - in full: the unmatched part, the credit, and the invoice settled again
        - in part: the unmatched part first, as Stripe gives back a refunded part
        - what an invoice paid meanwhile no longer owes becomes a credit
        - an invoice paid in part is settled as far as it owes, and the rest is a credit
        - an invoice owing the subscriber is settled by nothing
        - what goes beyond everything the reversal took is taken by nothing
- `packages/nest/tests/a-reversal-reopens-an-invoice.test.js`
    - a reversal the gateway gives back
        - after the invoice was paid again leaves that payment as a credit, audited
        - closes the cases it opened, audited as closed because the money came back
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - an invoice is corrected by a cancellation invoice
        - a reversal given back before records what of that covered its cases, once
- `packages/ui-vue/tests/component/an-operator-reconciles-what-matched-nothing.test.ts`
    - the subscriber's payments in its record
        - a credit a reversal given back left names the reversal

<!-- END proof -->

### SC-PRIC-087 — A credit left for the same invoice covers what a reversal would open again

🟢 💰 Where a reversal would open an invoice again (`SC-PRIC-084`) and another payment collected
for that invoice left a credit that is still open — a payment that arrived late, while a later
attempt paid the invoice as well —, that credit covers what the reversal would open, the oldest
such credit first and no more than the reversal would open: the invoice stays settled by money
collected for it, and only what remains opens it again. The credit the reversed payment left still
goes first; its part already paid out, and whatever goes beyond everything the payment brought,
still match nothing. This is no offset against a later invoice, which a credit never is
(`SC-PRIC-083`). What the gateway gives back of the reversal gives back what it took of those
credits as well (`SC-PRIC-086`).

_Source:_ #333 (decided 2026-10-15)

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/a-reversal-is-written-in-its-payments-turn.test.js`
    - a reversal
        - takes the turn of every invoice its payment settles, in one order, then the credits, then
          its own row
        - takes the open credit first, then opens the invoice, and writes its totals on its row
        - reported again unchanged, writes nothing but the row it skips
        - grown since the last report, writes only what grew
        - meeting a credit already paid out and going beyond the payment, opens one case
        - takes a credit another payment for the same invoice left before it opens the invoice
        - of a payment this installation does not hold, writes nothing
        - in another currency than its payment, is refused before anything is held
        - held under its reference against another payment, is refused
    - a reversal given back
        - in full, gives back what it took of the credit, settles the invoice again, and only once
        - closes the case it opened first, as SaaSiCat and saying why
        - after the invoice was paid again, leaves what it no longer owes as a credit from the
          reversal
    - the cases to reconcile
        - are read open or closed, the oldest first, a page after the case it names
        - one is closed with the operator’s note once, and an unknown one is answered as such
        - a refund’s part no credit takes opens one, once, and its failure closes it
    - what the credits and invoices read
        - what each invoice owes is read in three statements, and nothing is asked for none
        - a reversal is found by its id, and none by another
        - the accounts holding credits are asked with the kinds that give back, and read as texts
        - an invoice that owes less than nothing becomes a credit of its own, once
- `packages/core/tests/a-reversal-takes-a-payment-back.test.js`
    - what credits other payments for the same invoice left cover of a reversal
        - they cover what would open the invoice again, the oldest first
        - why
        - come after the credit the payment itself left
        - do not cover the part of that credit already paid out, nor what goes beyond the payment
        - one with nothing open is passed over
        - they cover the invoices in the order given
- `packages/nest/tests/a-reversal-reopens-an-invoice.test.js`
    - a payment that arrived late while the attempt beside it paid the invoice too, reversed
        - is covered by the credit the other payment left, and nobody is told

<!-- END proof -->

### SC-PRIC-088 — Reversals of an invoice end alike in any order, and it is collected again

🔵 _(Superseded on 2026-10-19 by `SC-PRIC-090`.)_ 💰 Where a payment whose credit covered another
reversal of its invoice (`SC-PRIC-087`) is reversed itself, the cover is lifted before anything
else: the earlier reversal opens the invoice by what the credit covered, as it would have without
the credit, and the later one takes the credit as its own. Two reversals of one invoice's payments
therefore end alike whatever order the gateway reports them in. Where a reversal leaves an invoice
owing — itself, or through a cover it lifted —, every attempt of that invoice that succeeded is
marked reversed beside the attempt whose payment was taken back: none of them settles the invoice
any more, and one that succeeded would keep every other attempt from being made. Its payment method
collects that invoice no more either, even where its payment was paid out rather than reversed
(`SC-PRIC-085`), and the subscriber is told once.

_Source:_ #333 (decided 2026-10-15)

### SC-PRIC-090 — Reversals of an invoice end alike in any order, and it is collected again

🟢 💰 Where a payment whose credit covered another reversal of its invoice (`SC-PRIC-087`) is
reversed itself, the cover is lifted before anything else, and the later reversal takes the credit
as its own. The earlier one then takes what the credit covered as it would have without that
credit, as everything stands when the cover is lifted (`SC-PRIC-084`): the credits its own payment
left first — its share of a cancelled invoice that the replacement did not take among them
(`SC-PRIC-095`) —, then the open credits other payments left for its invoice, and only then the
invoice of its chain that payment still settles — the replacement, where its invoice was cancelled
—, which it opens again by no more than that. What goes beyond all of them, such as a credit of its
payment already paid out, is a case to reconcile. Two reversals of one invoice's payments therefore
end alike whatever order the gateway reports them in, and whether the invoice was cancelled between
them. The one exception is a credit of the earlier payment that covered a third reversal in turn:
the lift does not lift that cover again, and what reaches it is a case as well. Where a reversal
leaves an invoice owing — itself, or through a cover it lifted —, every attempt of that invoice
that succeeded is marked reversed beside the attempt whose payment was taken back: none of them
settles the invoice any more, and one that succeeded would keep every other attempt from being
made. Its payment method collects that invoice no more either, even where its payment was paid out
rather than reversed (`SC-PRIC-085`), and the subscriber is told once.

_Source:_ #333 (decided 2026-10-15) · #334

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-reversal-takes-a-payment-back.test.js`
    - the covers a credit gave other reversals
        - are what reversals other than its own payment's took of it and still hold, in the order
          given
        - why
        - are reached only by what the withdrawal takes of the credit beyond its open part, the
          first first
        - are reached only by what was taken beyond the open part of the credit that gave them
        - given back, return to the payment's own credit first, then the others, the oldest first
- `packages/nest/tests/a-reversal-reopens-an-invoice.test.js`
    - two payments of one invoice, both no longer there
        - ${what}: both attempts reversed, told once, collected with a new card only
        - a cover lifted that a third payment’s credit takes again opens nothing, and leaves both
          attempts standing
        - a lifted cover that meets a credit of its payment already paid out is the covered
          reversal’s case, and audited as its
        - a failure followed up before the reversal holds no later direct debit back
        - a failure on the reversed card holds no direct debit back once the reversal was told

<!-- END proof -->

### SC-PRIC-032 — No contract is frozen and no invoice issued before the subscriber's identity is complete

🟢 💰 The identity is the legal name, the billing address and the
tax identifiers. Sign-up asks for it before the tenant is activated. A subscriber created
another way is asked for what is missing before its subscription becomes a paid one, which is
when its contract is frozen (`SC-SPEC-005`, `SC-AUD-020`); until then the operator sees the
subscription waiting and why, because a party copied onto a contract incomplete cannot be
completed afterwards.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-invoice-is-issued.test.js`
    - an invoice that cannot be issued yet
        - waits for the subscriber’s address, draws no number, and takes the next one once it is
          complete
        - is recorded in the audit log once, however many runs find it waiting
        - is recorded in the audit log once between two runs at the same moment
        - is recorded in the audit log by the next run where the write failed
        - waits where the adapter supports no treatment for the subscriber
        - waits for what the adapter finds missing, and draws no number
        - is shown to the adapter as it would be issued
        - waits under a contract ${what}
        - keeps no other subscription waiting, however many wait before it

<!-- END proof -->

### SC-PRIC-033 — An invoice interrupted in archiving keeps its number and is never issued twice

🟢 💰 Its content has passed the tax adapter's check before the
number is drawn (`SC-PRIC-027`), so what can still fail afterwards is rendering or archiving the
document rather than the invoice itself. The invoice and its number are written in one transaction,
and the rendered document is then archived under that number, which makes a repeated attempt the
same write rather than a second document. Until the archive confirms, the invoice is neither sent
nor offered for download, the register shows it as awaiting its document (`SC-ADM-042`), and an
attempt that fails is retried; it never draws a new number for the same charges (`SC-PRIC-096`,
`SC-PRIC-072`).

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-invoice-document-is-archived-and-mailed.test.js`
    - an invoice interrupted in archiving
        - before the archive took the file is neither offered nor mailed, and the next run archives
          the same file
        - after the archive took the file is confirmed by the next run as kept, whatever the
          renderer makes since
        - confirmed by another run in between is not counted as archived by this one
        - holds up no other invoice, and a renderer that does not answer counts as interrupted
        - is archived by a run however many pages of invoices wait before it
    - the quarter-hourly run
        - issues an invoice, archives it and mails it in one run
        - whose archiving fails still mails, and the next run archives again

<!-- END proof -->

### SC-PRIC-034 — A collection retried after an unanswered request never charges twice

🟢 💰 An invoice has at most one active collection attempt, claimed
atomically in the database before any request reaches the gateway, so two workers that find the
same invoice open do not both collect it. Asking the gateway to collect an invoice carries a key
that stays the same for that invoice and attempt across every retry, so a request whose answer was
lost is repeated as the same request rather than a second charge. A result that stays uncertain is
reconciled with the gateway before anything is retried under a new key. An attempt is marked as
submitted in the invoice's turn (`SC-PRIC-036`) before its request leaves, so a cancellation never
meets an attempt that is about to be sent without knowing it. Deduplicating the gateway's callbacks
(`SC-PRIC-029`) covers the other direction.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/an-attempt-is-written-in-the-invoices-turn.test.js`
    - starting an attempt
        - locks the invoice, reads its attempts, then writes the first one as submitted, without a
          conflict raised
        - writes no first attempt where one is ${status.toLowerCase()}
        - writes none where another invoice of its chain holds it back
        - answers no attempt where the insert met one, and refuses an invoice that does not exist
        - writes none for an invoice that owes nothing, reading no attempt
    - planning an attempt
        - locks the invoice, reads its attempts, then writes the next one as planned for its day
        - writes nothing where another attempt came after the one it follows
        - an announcement is written only to a planned attempt not announced yet
        - a planned attempt is taken up as sent, or withdrawn, in the invoice’s turn and only while
          it is planned
        - what follows a failure is recorded only once, and only for a failure
    - settling and taking on an attempt
        - an outcome is written only to an attempt not settled, and says whether it was
        - a hold is taken only where the last one is older than the lease
    - reading
        - the invoices due are mailed, with a payment, on or before their date, and without an
          attempt
        - the attempts not settled are the submitted ones past the lease and the pending ones past
          the hour
        - the planned attempts are listed by id
        - the failed attempts not followed up are listed by id
        - the invoices another payment method can collect are read by their last attempt and the one
          in use
        - the accounts in use are those of attempts not settled, each once
        - an attempt reads back as a record, by id and with its invoice’s others, the first first
- `packages/core/tests/a-collection-attempt-row-becomes-a-record.test.js`
    - the key of a collection attempt
        - names the invoice and the attempt, the same however often it is asked for
        - counts from 1: ${attempt} is refused
    - a second try
        - can pass where funds were short or a refusal named no cause, and nowhere else
    - an attempt row
        - is written as submitted, under its key, with the amount as two-place text
        - planned is written for its day, with nothing sent and nothing held
        - planned reads back with its day, from a Prisma date or a Drizzle text
        - withdrawn before it left reads back without a moment it was sent at
        - reads back from either adapter’s shape: a numeric string, or a Prisma decimal
        - refuses ${what}
        - refuses ${what}
        - one that left is read as sent, and a planned one is refused as such
    - the attempt an invoice’s turn writes
        - is numbered after the last, from 1
        - is the first only where the invoice has none, whatever became of an earlier one
        - is planned after the attempt it follows, where none is open or succeeded
        - is not planned from attempts read before another came
    - an outcome
        - collected settles the attempt at its moment, with the gateway’s reference
        - on its way leaves it open
        - failed settles it with the reason and the gateway’s code
- `packages/nest/tests/an-invoice-is-collected.test.js`
    - an invoice that reached the subscriber
        - by card is collected at once, through the account its payment method is held at, under its
          attempt key
        - is collected once: a second run, and one running beside the first, send nothing more
        - not yet mailed is not collected
        - by direct debit is collected from the day it announced, not the day before
    - a failed collection
        - is recorded with its reason and the gateway’s code, and written to the audit log once
    - a request whose answer was lost
        - stays submitted, and no run sends anything for it while the lease holds
        - is not taken on within the lease by a run called for a later moment than the clock’s
        - is taken on once the clock is past the lease, by a run called for an earlier moment
        - is asked about once the lease has passed, and what the gateway made is recorded, with
          nothing sent again
        - found by two runs after the lease is taken on by one: it asks, and the other sends nothing
        - that never reached the gateway is sent again once the lease has passed: the same request
          under the same key
        - whose gateway does not answer in time counts as unanswered, and the next run after the
          lease asks
        - whose answer arrived and could not be recorded is asked about later, and charged once
        - whose gateway cannot be asked stays as it is, and is asked again after the next lease
    - a direct debit on its way
        - is asked about once an hour, and settled by what the gateway says
        - that the gateway holds nothing of is left on its way, and nothing is sent again
- `packages/payment-stripe/tests/an-invoice-is-collected-off-session.test.js`
    - an invoice is collected off session
        - as a payment intent confirmed for the payment method it announced, under the attempt key
        - a direct debit is on its way until the bank settles it
        - the same attempt sent again is the same request, under the same key
    - a refusal is a failure with its reason
        - ${what}
    - an answer that says nothing about a charge is thrown, so the attempt is asked about later
        - ${what}
        - a conflict is thrown by its status where the library classes it as ${what}
    - what became of an attempt is asked of Stripe
        - by its key among the customer’s intents created since an hour before it was submitted
        - nothing under its key: the request never arrived
        - by its reference where an answer named one: a direct debit the bank refused names the
          charge’s code
        - a card the bank refused is named by its decline code, not by the charge’s
        - a direct debit to an account the bank does not know names an unusable payment method
        - an intent under its reference that carries another attempt is not taken for it
    - the currency
        - one Stripe takes ${what}, as ${currency}, is refused before anything is collected in it
        - an invoice in another currency than the account’s is refused without a request

<!-- END proof -->

### SC-PRIC-079 — An invoice is collected once it has reached the subscriber

🔵 _(Superseded on 2026-10-14 by `SC-PRIC-082`.)_ 💰 An invoice that names the payment method it is
collected with (`SC-PRIC-028`) is collected through the gateway account that payment method is held
at once it was handed to the mail: by card at once, by direct debit from the collection date it
announced. It is collected only as it announced it. Where the subscriber's payment method in use is
another than the invoice named, or the invoice reached the subscriber less than the lead time before
the date its direct debit announced, it is not collected and waits, and the operator is shown why.
Collecting is the fourth step of the quarter-hourly run that issues, archives and mails invoices, so
nothing is collected before the subscriber was sent what it is collected for.

_Source:_ #333 (decided 2026-10-13: collected at once, by the same run) · #276

### SC-PRIC-080 — A failed collection is tried once more, and the subscriber is told of every failure

🟢 💰 A collection that fails is told to the subscriber at their invoice email, with the invoice, the
amount, the reason and what follows. Where the reason can pass — funds short, or a refusal that
gives no cause — the same payment method is charged once more: a card seven days after the
failure, a direct debit on the day its new announcement names, which is seven days after the
failure at the earliest and the lead time after the announcement reached the subscriber
(`SC-PRIC-028`). A second failure of the same payment method, and a failure for a reason that cannot
pass, is not tried again: the subscriber is asked to replace the payment method, and the
replacement collects the invoice (`SC-PRIC-082`). A gateway tries nothing again of its own. The
invoice stays as it was issued, its due date included (`SC-PRIC-046`).

_Source:_ #333 (decided 2026-10-13 and 2026-10-14) · #276

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/an-attempt-is-written-in-the-invoices-turn.test.js`
    - starting an attempt
        - locks the invoice, reads its attempts, then writes the first one as submitted, without a
          conflict raised
        - writes no first attempt where one is ${status.toLowerCase()}
        - writes none where another invoice of its chain holds it back
        - answers no attempt where the insert met one, and refuses an invoice that does not exist
        - writes none for an invoice that owes nothing, reading no attempt
    - planning an attempt
        - locks the invoice, reads its attempts, then writes the next one as planned for its day
        - writes nothing where another attempt came after the one it follows
        - an announcement is written only to a planned attempt not announced yet
        - a planned attempt is taken up as sent, or withdrawn, in the invoice’s turn and only while
          it is planned
        - what follows a failure is recorded only once, and only for a failure
    - settling and taking on an attempt
        - an outcome is written only to an attempt not settled, and says whether it was
        - a hold is taken only where the last one is older than the lease
    - reading
        - the invoices due are mailed, with a payment, on or before their date, and without an
          attempt
        - the attempts not settled are the submitted ones past the lease and the pending ones past
          the hour
        - the planned attempts are listed by id
        - the failed attempts not followed up are listed by id
        - the invoices another payment method can collect are read by their last attempt and the one
          in use
        - the accounts in use are those of attempts not settled, each once
        - an attempt reads back as a record, by id and with its invoice’s others, the first first
- `packages/adapter-prisma/tests/prisma-invoice-collection.repository.test.js`
    - writing an invoice’s next attempt
        - the first is started in the invoice’s turn after its attempts were read
        - none is started where another invoice of its chain holds it back
        - no first attempt is started where the invoice has one, and nothing is written
        - a planned one is written for its day, the day as midnight UTC, on the caller’s transaction
        - no planned one is written after another attempt than the one it follows
        - an invoice that does not exist is refused
    - a write that names the state it expects
        - what
        - a planned attempt is taken up as sent, or withdrawn, in the invoice’s turn
        - a planned attempt is taken up as sent once, and read back as written
        - nothing is written for an invoice that owes nothing, started, planned or sent
    - reading
        - the invoices due and the invoices another payment method can collect are raw queries
        - the failed and the reversed attempts not followed up are listed by id
        - the planned and the unsettled attempts are listed by id, page by page
        - an attempt, an invoice’s attempts and the accounts in use read back as records
- `packages/core/tests/a-collection-notice-reads-back.test.js`
    - a failure notice
        - reads back as it was recorded, whatever follows it
        - refuses ${what}
    - an announcement
        - reads back with the day it named and its mandate
        - refuses ${what}
- `packages/core/tests/a-failed-collection-is-planned-once-more.test.js`
    - a payment method that failed
        - is charged once more where funds were short or a refusal named no cause
        - is not charged again for a reason that cannot pass
        - is not charged a third time: one earlier failure with it ends its tries
        - that replaced one which failed gets its own second try
        - a withdrawn plan with it does not count as a try
        - an attempt that did not fail is not followed by another
    - the day a card is charged again
        - is ${COLLECTION_RETRY_AFTER_DAYS} days after a failure on ${failedOn}: ${expected}
    - the day a direct debit announced again is collected
        - is the lead time after its announcement where that is later than the day planned
        - is the day planned where the lead time ends before it
        - is the day planned where the lead time ends on it
        - counts the lead time across a month and a year
- `packages/nest/tests/a-failed-collection-is-tried-again.test.js`
    - a card that failed for a reason that can pass
        - is told to the subscriber once, at their invoice email, with the day it is charged again
        - is charged once more with the same card seven days after the failure, not the minute
          before
        - that fails again is told so, and not tried a third time: the subscriber is asked to
          replace the card
    - a collection that failed for a reason that cannot pass
        - is told, and not tried again until the payment method is replaced
    - a direct debit that failed for a reason that can pass
        - is announced again under its mandate for the lead time after, and debited on that day, not
          the minute before
        - whose announcement the mail refused is announced the next day, for the lead time after
          that day
        - that was announced without the announcement being recorded keeps the day it was told, and
          is not announced twice
    - a payment method that replaced the one an invoice named, or the one that failed
        - before the invoice is collected, a card in use instead of its direct debit is charged on
          the day it named
        - before the invoice is collected, a direct debit in use instead of its card is announced
          and debited the lead time after
        - after a failure that cannot pass, the replacement collects the invoice
        - a failure learned after the payment method was replaced is followed by the replacement at
          once, as the subscriber is told
        - while a second charge is planned, the plan is withdrawn and the replacement charged
          instead
        - no payment method in use: the invoice waits, and the audit log says so once
        - a direct debit without a mandate reference is not announced, and waits
    - a direct debit whose invoice reached the subscriber too late for its day
        - is announced again for the lead time after, and debited then rather than on the day it
          named
    - what the subscriber is told of a failure
        - a run that stops after it planned records the notice the next time, saying what was
          planned, once
        - a plan whose card was replaced before the failure was told is not told: its replacement
          is, and charged
        - a notice that cannot be read holds up no planned collection
        - is sent by the next run where the mail refused it
        - a run that stops before it planned what follows plans it the next time, from the day it
          failed, and tells it once
    - a failure the subscriber has not heard of yet
        - holds back the direct debit announced after it until it is told, and the audit log says
          why
        - a debit held behind each of two failures is audited for each
        - never announces a debit after a failure nobody was told of, even one marked followed up
        - holds back a direct debit planned by a run that stopped before it recorded the failure
    - runs side by side
        - two runs that both see a failure tell it once and plan one second charge
        - two runs on the day a second charge is due send it once
- `packages/nest/tests/an-invoice-is-collected.test.js`
    - collecting starts
        - not without the record of what the subscriber is told, which it names
- `packages/nest/tests/invoices-start-only-as-configured.test.js`
    - the payment methods invoices are collected with
        - refuse the start where the invoices are collected and nothing records what the subscriber
          is told
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - an invoice is collected through its payment gateway
        - a table without the columns of a planned attempt is brought to the shape the fragments
          declare, twice, keeping its attempts

<!-- END proof -->

### SC-PRIC-082 — An invoice is collected as it, or an announcement after it, says

🟢 💰 An invoice that names the payment method it is collected with (`SC-PRIC-028`) is collected
through the gateway account that payment method is held at once it was handed to the mail: by card
at once, by direct debit from the collection date it announced. Where the subscriber's payment
method in use is another than the invoice named, the invoice is collected with the one in use: a
card at once, a direct debit from the date a new announcement names (`SC-PRIC-028`); so is an
invoice that could not be collected (`SC-PRIC-080`) once its payment method is replaced. A direct
debit whose invoice reached the subscriber less than the lead time before the date it announced is
announced again rather than collected early. Without a payment method in use nothing is collected,
and the operator is shown why. Collecting is the fourth step of the quarter-hourly run that issues,
archives and mails invoices, so nothing is collected before the subscriber was sent what it is
collected for.

_Source:_ #333 (decided 2026-10-13 and 2026-10-14) · #276

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-failed-collection-is-tried-again.test.js`
    - a payment method that replaced the one an invoice named, or the one that failed
        - before the invoice is collected, a card in use instead of its direct debit is charged on
          the day it named
        - before the invoice is collected, a direct debit in use instead of its card is announced
          and debited the lead time after
        - after a failure that cannot pass, the replacement collects the invoice
        - a failure learned after the payment method was replaced is followed by the replacement at
          once, as the subscriber is told
        - while a second charge is planned, the plan is withdrawn and the replacement charged
          instead
        - no payment method in use: the invoice waits, and the audit log says so once
        - a direct debit without a mandate reference is not announced, and waits
    - a direct debit whose invoice reached the subscriber too late for its day
        - is announced again for the lead time after, and debited then rather than on the day it
          named
- `packages/nest/tests/an-invoice-is-collected.test.js`
    - an invoice that reached the subscriber
        - by card is collected at once, through the account its payment method is held at, under its
          attempt key
        - is collected once: a second run, and one running beside the first, send nothing more
        - not yet mailed is not collected
        - by direct debit is collected from the day it announced, not the day before
    - the quarter-hourly run
        - issues, archives, mails and collects an invoice by card in one run
        - whose collection fails says so and leaves the next run to try again
- `packages/nest/tests/invoices-start-only-as-configured.test.js`
    - the payment methods invoices are collected with
        - refuse the start where the file names payment accounts and nothing collects the invoices

<!-- END proof -->

### SC-PRIC-035 — An invoice left unpaid past its grace period makes the tenant read-only

🔵 _(Superseded on 2026-10-14 by `SC-PRIC-081`.)_ 💰 A collection that fails, the first one after
sign-up included, and a reversal (`SC-PRIC-031`) leave the invoice open; the gateway retries, and
the subscriber is told. An invoice still open when the grace period named in `config/saas.yaml` has
passed, counted from its due date (`SC-PRIC-046`), puts the tenant into read-only (`SC-ADM-024`),
where a user holding the billing permission (`SC-UI-023`) can still replace the payment method.
Settling every overdue invoice lifts that reason and no other: a tenant whose subscription has ended
(`SC-CANC-020`), that the operator suspended or that is being deleted (`SC-PRIV-014`) stays as
restricted as that reason makes it. Suspending the tenant stays the operator's decision
(`SC-ADM-005`). Sign-up activates on a confirmed payment method rather than a completed collection
(`SC-REG-022`), and this is what keeps that from being service against an invoice nobody pays.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-081 — An invoice left unpaid past its grace period makes the tenant read-only

🟡 _(Decided, not yet delivered.)_ 💰 A collection that fails, the first one after sign-up included,
and a reversal (`SC-PRIC-084`) leave the invoice open; it is collected again and the subscriber told
as `SC-PRIC-080` says. An invoice still open when the grace period named in `config/saas.yaml` has
passed, counted from its due date (`SC-PRIC-046`), puts the tenant into read-only (`SC-ADM-024`),
where a user holding the billing permission (`SC-UI-023`) can still replace the payment method.
Settling every overdue invoice lifts that reason and no other: a tenant whose subscription has ended
(`SC-CANC-020`), that the operator suspended or that is being deleted (`SC-PRIV-014`) stays as
restricted as that reason makes it. Suspending the tenant stays the operator's decision
(`SC-ADM-005`). Sign-up activates on a confirmed payment method rather than a completed collection
(`SC-REG-022`), and this is what keeps that from being service against an invoice nobody pays.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md` · #333
(decided 2026-10-14)

### SC-PRIC-036 — What an invoice owes and how it is paid changes one step at a time

🟢 💰 Cancelling an invoice (`SC-PRIC-095`), recording a payment event (`SC-PRIC-029`) or a reversal
(`SC-PRIC-084`) against it, and marking a collection for it as submitted to the gateway
(`SC-PRIC-034`) take turns, and the turn belongs to the invoice's chain: the invoice and every
replacement that follows it, however many cancellations deep, share one. Each reads the chain's
state only once it holds the turn, so a payment event for a cancelled invoice and the cancellation
of its replacement never read the same replacement at once, and the event settles the invoice that
stands in the chain when it holds the turn. A collection that finds the invoice cancelled is not
submitted, and a request only leaves once its attempt is marked, so no request is sent for an
invoice a cancellation has already replaced. A second cancellation that finds the invoice already
cancelled is refused; a mistake on the replacement is corrected by cancelling the replacement. No
invoice of a chain is collected while an attempt submitted for any invoice of that chain is
unresolved, so a replacement of a replacement waits for the attempt its first predecessor sent. The
turn covers the writes and not the gateway's answer, which arrives as an event of its own.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/an-attempt-is-written-in-the-invoices-turn.test.js`
    - starting an attempt
        - locks the invoice, reads its attempts, then writes the first one as submitted, without a
          conflict raised
        - writes no first attempt where one is ${status.toLowerCase()}
        - writes none where another invoice of its chain holds it back
        - answers no attempt where the insert met one, and refuses an invoice that does not exist
        - writes none for an invoice that owes nothing, reading no attempt
    - planning an attempt
        - locks the invoice, reads its attempts, then writes the next one as planned for its day
        - writes nothing where another attempt came after the one it follows
        - an announcement is written only to a planned attempt not announced yet
        - a planned attempt is taken up as sent, or withdrawn, in the invoice’s turn and only while
          it is planned
        - what follows a failure is recorded only once, and only for a failure
    - settling and taking on an attempt
        - an outcome is written only to an attempt not settled, and says whether it was
        - a hold is taken only where the last one is older than the lease
    - reading
        - the invoices due are mailed, with a payment, on or before their date, and without an
          attempt
        - the attempts not settled are the submitted ones past the lease and the pending ones past
          the hour
        - the planned attempts are listed by id
        - the failed attempts not followed up are listed by id
        - the invoices another payment method can collect are read by their last attempt and the one
          in use
        - the accounts in use are those of attempts not settled, each once
        - an attempt reads back as a record, by id and with its invoice’s others, the first first
- `packages/core/tests/an-invoice-is-corrected-by-a-cancellation.test.js`
    - the invoice that stands in a chain
        - is the first invoice where nothing was cancelled
        - is the last replacement, however many cancellations deep
        - is none where the last cancellation left no replacement
- `packages/nest/tests/an-invoice-is-cancelled.test.js`
    - a cancellation refused
        - for an invoice that does not exist
        - for an invoice cancelled already, and for a cancellation invoice, drawing no number
        - while the invoice’s document is not archived
        - where the subscriber can be reached at no address, until one is given
        - for an invoice that states a credit
        - where the direct debit in use names no mandate the replacement could announce
        - at every start without the transaction it is written on
    - the collections of a cancelled invoice’s chain
        - a failure of the cancelled invoice’s attempt is recorded and told to nobody, and the
          replacement is collected once it is resolved
        - a reversal is told only once no attempt of any invoice of the chain is on its way, about
          the invoice that stands
        - a reversal of a payment that moved tells the subscriber the replacement is open again
        - a reversal is followed up in its chain’s turn: read, told and marked on the transaction
          that holds the chain
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - an invoice is corrected by a cancellation invoice
        - a database from before ends up with the schema the fragments declare, twice
        - an invoice issued before begins a chain of its own, paid on issue by nothing
        - a reversal given back before records what of that covered its cases, once
        - a correction's line names a line of its invoice, and no other line names one
        - a correction's line already there without the line it corrects stops it, and says so
        - the files that created the invoices and the payments, run again, leave the chain in place
        - an installation whose invoices are not collected gains the chain, and runs through
        - an installation without invoices is left without them, and runs through

<!-- END proof -->

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
For an installation that names an adapter, `SC-PRIC-065`, `SC-PRIC-066`, `SC-PRIC-067`,
`SC-MKT-027` and `SC-CFG-037` take the rate from it.

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-038 — A contract and an invoice record the tax treatment and the adapter that decided it

🟡 _(Decided, not yet delivered.)_ 💰 The treatment, the rate, the note and the adapter's name and
version are written with the contract when it is concluded and with each invoice when it is issued,
so a document still says why it carries the tax it does after the adapter is updated or replaced. An
update never changes a document already issued (`SC-PRIC-095`).

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-invoice-is-issued.test.js`
    - the tax of an invoice
        - is the adapter’s, computed once per rate, with the treatment and the adapter recorded
        - is decided for the issuer the invoice names, where that is the contract’s and not the
          file’s
        - is decided anew for the subscriber as it stands when the invoice is issued

<!-- END proof -->

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

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-tax-origin-reads-what-was-checked.test.js`
    - a VAT id counts as validated only on a counting check that found that number valid
        - a valid check of the number the subscriber has validates it
        - a check that found it invalid does not
        - nor does a valid check of another number
        - nor no check at all, and a subscriber without a number has none to validate
    - a check counts only for the number held, completed while held, never over a later one
        - over no check, an older check, or one of a number corrected away
        - not over a check that completed later, so an older valid never replaces a newer invalid
        - of two with the same date, the one written last
        - not for a number the subscriber does not hold
        - not when it completed before the number was last set, and from that moment on
- `packages/tax-de/tests/a-vat-id-is-checked-through-vies.test.js`
    - an answer about the number is a completed check, kept as the service sent it
        - found valid, with the request identifier that confirms it
        - dated when the whole answer has arrived, not when its headers did
        - found invalid
        - a number VIES cannot read as one is found invalid
    - no answer about the number is a check that did not complete, never a valid one
        - a failure VIES reports, such as a member state that cannot answer
        - a failure without an error code
        - an HTTP error
        - a body that is not JSON, or JSON that says nothing about validity
        - no answer within the time allowed
        - headers within the time allowed, but no body
        - a service that cannot be reached

<!-- END proof -->

### SC-PRIC-041 — An invoice computes its tax once per rate, by the rule its tax adapter names

🟢 💰 The German adapter names the rule of EN 16931: the tax of each
rate is that rate applied to the net total of its lines, rounded once, and the invoice total is the
net total plus that tax. The amount the invoice states, the amount collected and the amount a
payment settles are that one figure. The total is never the sum of the lines' own rounded taxes,
which can differ from it by cents: ten lines of 12.34 net at 19 % carry 2.34 each, 23.40 together,
while the rate applied to 123.40 gives 23.45.

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-invoice-is-drawn-up-from-its-charges.test.js`
    - the tax an invoice states
        - is the rate applied once to the net of its lines, not the sum of each line’s rounded tax
        - is the adapter’s, whatever rule it names
        - carries the treatment the adapter decided, and its rate on every line
        - is computed per rate, the lowest rate first, and a discount lowers its rate’s net
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - the tax of an invoice
        - is the adapter’s, computed once per rate, with the treatment and the adapter recorded
        - is decided for the issuer the invoice names, where that is the contract’s and not the
          file’s
        - is decided anew for the subscriber as it stands when the invoice is issued
- `packages/tax-de/tests/an-invoice-carries-what-german-law-requires.test.js`
    - what an invoice of an issuer in Germany has to carry
        - a complete invoice lacks nothing
        - the ${side}'s ${field}, missing or blank, is named
        - the ${side}'s second address line may be missing
        - the issuer's tax number or its VAT number — either is enough, neither is a gap
        - the reverse charge names both parties' VAT numbers, and its note
        - a standard invoice asks for no VAT number of the subscriber
        - a ${kind} invoice says why it carries no German VAT
        - an invoice without lines, or with a line nobody named, is not complete
        - every gap is named, in the order an invoice reads
    - an invoice's tax, once per rate
        - is the rate applied to the net total, not the sum of the lines’ rounded taxes
        - keeps each rate apart, the lowest first, and a discount lowers its rate’s net

<!-- END proof -->

### SC-PRIC-042 — An invoice is issued in the format its tax adapter requires

🟡 _(Decided, not yet delivered.)_ 💰 The German adapter requires ZUGFeRD in the EN 16931 profile, one
file a person reads as a PDF and a program reads as structured data, for cancellation and
replacement invoices as well. That file is what is archived, sent (`SC-PRIC-094`) and downloaded
(`SC-AUD-014`). Rendering stays a port, so an application's own renderer can produce it. A rendered
file the adapter's format check refuses is not issued. The content check and the format check come
from one profile of the adapter, so content that passed before the number was drawn (`SC-PRIC-027`)
renders into a file that passes; a refusal after all is a defect of the renderer or the adapter, so
the invoice keeps its number, waits for its document as `SC-PRIC-033` has it until the defect is
fixed, and the operator is shown the refusal.

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/invoice-zugferd/tests/renders-an-invoice-the-german-adapter-accepts.test.js`
    - an issued invoice rendered by the default renderer
        - (${name}) is the file the German adapter asks for, named by its number
        - is the same bytes every time, whatever was rendered in between
        - is dated from the moment the invoice was issued, not the clock
        - of another invoice is another file, under another identifier
    - what the page says
        - the parties, the invoice’s facts, its lines and its total, labelled in German and English
        - the subscriber’s VAT id and its country by name, under the reverse charge
        - a direct debit announced with its amount, the day it is collected from and its mandate, in
          German and English
        - a card named by the last four digits of its number, and nothing more
        - the treatment’s note before how the invoice is paid, each a paragraph of its own
        - no document for a direct debit without ${what}, which its announcement names
        - nothing about a payment where the invoice is not collected
        - the footer lines and the page’s number on every page of an invoice that runs on
        - a footer line wider than the page, broken onto the next line, on every page
        - a name or an address line wider than its column, all of it, line after line
        - no footer where the invoice carries none
        - Greek and Cyrillic in their letters, a character its font has no glyph for as ?, and the
          XML as written but for what XML cannot hold
    - where the page sets its text
        - (${name}) keeps every run of text between the margins, clear of every other
        - (${name}) leaves 5 mm at least between the foot and the text above it
    - a figure
        - of ${amount} reads ${page} on the page and ${xml} in the XML
        - taken off at the smallest amount reads -0,01, as one unit taken back at 0.01
    - the XML it carries
        - takes a line off as one unit taken back at a price that is not negative
        - names the categories and reasons EN 16931 asks for each treatment
        - outside the scope of VAT, names no VAT id and no rate, and identifies the seller otherwise
        - of a small business with a tax number only, identifies the seller by it
        - under the reverse charge, names both VAT ids
    - a cancellation invoice
        - is titled Stornorechnung on its page and in its metadata, and no document is a Gutschrift
        - names the invoice it cancels and why, beside its facts and under its title
        - states the cancelled amounts reversed, each line naming the line it cancels, and asks for
          nothing
        - names no way of paying, whatever payment method its record still carries
        - under the reverse charge states its tax as nothing, not as minus nothing
        - carries a credit note stating the cancelled invoice’s amounts, naming it and why
    - a replacement
        - is an invoice naming the invoice it replaces and why, and each line the line it replaces
        - paid already, states what was paid and that nothing is due, and names no way of paying
        - paid in part, announces the debit of what is left alone
    - a replacement that lowers a line
        - names, beside the counter-entry, the line it corrects, in the file and on the page
    - an invoice that corrects none
        - names no invoice it corrects and no reason
    - a font the application passes
        - is the one the page is set in
- `packages/nest/tests/an-invoice-document-is-archived-and-mailed.test.js`
    - an issued invoice’s document
        - is rendered from the invoice as issued, checked, its checksum recorded, and archived
        - is archived once: the next run renders nothing again
        - that the adapter refuses waits under its number, recorded nowhere, until the defect is
          fixed
        - whose hold could not be written to the audit log is written there by the next run
        - rendered in another shape before anything was archived takes the place of the recorded
          one, both named in the audit log
        - rendered again is not put in place of the recorded one where the audit log cannot say so
        - the archive already keeps is the one it was issued as: the record follows it, and nothing
          is rendered
        - the archive keeps in another shape than the one recorded is the one the record follows,
          both named in the audit log
        - the archive keeps and the adapter refuses is held, and the archived one stays
        - the archive keeps that no longer matches its own checksum is held for the operator
- `packages/tax-de/tests/an-invoice-document-is-the-file-german-law-asks-for.test.js`
    - a rendered invoice
        - that is ZUGFeRD EN 16931 and says what the invoice records passes
        - that is not a PDF at all is refused as such, and nothing further is read
    - the container
        - ${what} is refused
    - a container written with the wrong types
        - ${what} is refused for it
    - the embedded XML
        - ${what} is refused
        - naming a party whose recorded name holds a character XML cannot hold passes with ? in its
          place, and not otherwise
        - naming a party whose recorded name holds a carriage return passes as the line feed every
          parser reads
        - stating what the format gives once twice, once as the invoice records it, is refused
        - stating 58.30 where the invoice is 58.31 is refused, wherever in the totals it says so
        - stating a total as nothing, or as no number, is refused
        - stating a day in another format than 102 is refused
        - that holds nothing but its root names everything the invoice records as missing
        - filed in a kid of the name tree, its name a literal string, is found and passes
        - the buyer's VAT id › the invoice records one: stated as recorded, or left out, passes
        - the buyer's VAT id › under the reverse charge, stated as recorded passes
        - the buyer's VAT id › under the reverse charge, left out, another one, or a second one is
          refused
        - outside the scope of VAT › names no VAT id and states no rate, as EN 16931 asks, and
          passes
        - outside the scope of VAT › naming the seller’s VAT id is refused (BR-O-02)
        - outside the scope of VAT › naming the buyer’s VAT id is refused (BR-O-02)
        - outside the scope of VAT › stating a rate is refused (BR-O-05)
        - outside the scope of VAT › stating a rate on a line is refused (BR-O-05)
        - outside the scope of VAT › a line without any VAT breakdown is refused (BR-CO-04)
        - outside the scope of VAT › categorised S rather than O is refused, in the breakdown and on
          the lines
        - outside the scope of VAT › stating a rate on a line in a second VAT breakdown is refused
          (BR-O-05)
        - of an issuer without a tax number may leave the registration out
        - of an issuer with a tax number must carry it
    - a cancellation invoice
        - stating the cancelled figures as a credit note, naming the invoice it cancels, passes
        - ${what} is refused
    - a replacement
        - naming the invoice it replaces passes
        - naming none is refused, and so is one stated as a credit note
        - that took over what was paid for the invoice it replaces › stating it as paid, and the
          amount due less it, passes
        - that took over what was paid for the invoice it replaces › stating ${what} is refused
    - an invoice that corrects none
        - naming an invoice it corrects is refused

<!-- END proof -->

### SC-PRIC-078 — The shipped renderer issues an invoice the format's own validators accept

🟢 💰 SaaSiCat ships a renderer for ZUGFeRD in the EN 16931 profile,
so an installation invoices without writing one: a PDF/A-3 with embedded fonts that a person reads,
labelled in German with English beside it, carrying the CII XML a program reads (`SC-PRIC-042`). Its
fonts set Latin, Greek and Cyrillic script; a character they have no glyph for is shown on the page
as `?` and kept in the XML as written, unless XML cannot hold it at all, as a control character,
which is `?` there too, and a carriage return is written as the line feed every XML parser reads
it as. An application whose subscribers write in another script
passes a font of its own, or uses a renderer of its own instead. The shipped renderer's
output is checked in CI by validators independent of SaaSiCat — PDF/A by veraPDF, the XML against
the EN 16931 and Factur-X schematron — for each treatment the German adapter decides, so a change
that breaks the standard fails the build rather than reaching a subscriber's bookkeeping.

_Source:_ #332 · #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-e-invoice-says-only-what-its-xml-can-hold.test.js`
    - the VAT category of a treatment
        - is the one EN 16931 names, for every treatment an adapter can decide
    - a character in an e-invoice
        - stands as it is: ${what}
        - cannot stand, and is written as ?: ${what}
        - a carriage return, alone or before a line feed, is the line feed any XML parser reads
        - is judged the same however often it is asked, each one replaced
- `packages/invoice-zugferd/tests/every-glyph-on-the-page-is-drawn.test.js`
    - a rendered page
        - (${name}) draws every character it shows
        - set in a font of the application whose glyph data has odd lengths, draws every character
          it shows
    - a font whose glyph data has odd lengths, padded
        - has every glyph at an even offset, its outline and its advance as they were
        - keeps the checksum a font carries over its whole file
        - leaves the bytes it was handed as they were
        - padded again is the same font
        - without TrueType outlines is left as it came
- `packages/invoice-zugferd/tests/renders-an-invoice-the-german-adapter-accepts.test.js`
    - an issued invoice rendered by the default renderer
        - (${name}) is the file the German adapter asks for, named by its number
        - is the same bytes every time, whatever was rendered in between
        - is dated from the moment the invoice was issued, not the clock
        - of another invoice is another file, under another identifier
    - what the page says
        - the parties, the invoice’s facts, its lines and its total, labelled in German and English
        - the subscriber’s VAT id and its country by name, under the reverse charge
        - a direct debit announced with its amount, the day it is collected from and its mandate, in
          German and English
        - a card named by the last four digits of its number, and nothing more
        - the treatment’s note before how the invoice is paid, each a paragraph of its own
        - no document for a direct debit without ${what}, which its announcement names
        - nothing about a payment where the invoice is not collected
        - the footer lines and the page’s number on every page of an invoice that runs on
        - a footer line wider than the page, broken onto the next line, on every page
        - a name or an address line wider than its column, all of it, line after line
        - no footer where the invoice carries none
        - Greek and Cyrillic in their letters, a character its font has no glyph for as ?, and the
          XML as written but for what XML cannot hold
    - where the page sets its text
        - (${name}) keeps every run of text between the margins, clear of every other
        - (${name}) leaves 5 mm at least between the foot and the text above it
    - a figure
        - of ${amount} reads ${page} on the page and ${xml} in the XML
        - taken off at the smallest amount reads -0,01, as one unit taken back at 0.01
    - the XML it carries
        - takes a line off as one unit taken back at a price that is not negative
        - names the categories and reasons EN 16931 asks for each treatment
        - outside the scope of VAT, names no VAT id and no rate, and identifies the seller otherwise
        - of a small business with a tax number only, identifies the seller by it
        - under the reverse charge, names both VAT ids
    - a cancellation invoice
        - is titled Stornorechnung on its page and in its metadata, and no document is a Gutschrift
        - names the invoice it cancels and why, beside its facts and under its title
        - states the cancelled amounts reversed, each line naming the line it cancels, and asks for
          nothing
        - names no way of paying, whatever payment method its record still carries
        - under the reverse charge states its tax as nothing, not as minus nothing
        - carries a credit note stating the cancelled invoice’s amounts, naming it and why
    - a replacement
        - is an invoice naming the invoice it replaces and why, and each line the line it replaces
        - paid already, states what was paid and that nothing is due, and names no way of paying
        - paid in part, announces the debit of what is left alone
    - a replacement that lowers a line
        - names, beside the counter-entry, the line it corrects, in the file and on the page
    - an invoice that corrects none
        - names no invoice it corrects and no reason
    - a font the application passes
        - is the one the page is set in

<!-- END proof -->

### SC-PRIC-043 — A change to a subscriber's tax origin applies from its next invoice

🟡 _(Decided, not yet delivered.)_ 💰 The change is recorded with its date, and a new tax identifier
is validated first (`SC-PRIC-040`). An invoice already issued keeps its treatment; one issued under
a detail that was wrong is corrected by cancelling it (`SC-PRIC-095`).

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-says-whether-it-is-a-business.test.js`
    - the business status
        - changes as a change of the tax origin, recorded with its date and who made it
        - with ${what} is refused, and nothing moves
    - the changes of the tax origin
        - are listed the latest first, whichever way each arrived, and only those that moved it
- `packages/nest/tests/a-tenant-keeps-its-billing-details.test.js`
    - the tenant changes how it is reached
        - a change of the country is recorded with the user who made it, as the audit log tags them
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - the tax of an invoice
        - is the adapter’s, computed once per rate, with the treatment and the adapter recorded
        - is decided for the issuer the invoice names, where that is the contract’s and not the
          file’s
        - is decided anew for the subscriber as it stands when the invoice is issued

<!-- END proof -->

### SC-PRIC-044 — The German tax adapter covers Germany, businesses abroad and small businesses

🔵 _(Superseded on 2026-10-04 by `SC-PRIC-064`.)_ 💰 It is the first adapter and the template for
the others. It
treats a subscriber in Germany, business or consumer, at the German rate; a business in another
member state of the European Union with a validated VAT identification number under the reverse
charge, with both numbers and the note on the invoice; a business outside the European Union as not
taxable in Germany, with its note; and an issuer using the small business exemption without VAT and
with that note. A consumer outside Germany, and a business in another member state without a
validated number, are not supported yet and are refused (`SC-PRIC-039`). The adapter is a template,
not tax advice: the operator stays responsible for the tax it charges.

_Source:_ #276 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

### SC-PRIC-045 — Invoice dates and tax periods count in the installation's time zone

🟢 💰 `config/saas.yaml` names it. The issue date, the period a charge
covers, the due date and the periods the invoice register exports (`SC-ADM-043`) are days in that
zone, so an invoice issued half an hour after midnight on the first of January belongs to the new
year whatever the server's clock says (`SC-OPS-011`).

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-invoice-is-drawn-up-from-its-charges.test.js`
    - the days an invoice states
        - are read in the installation’s zone: a month starting at midnight in Berlin is that month
        - span every line: from the first day any covers to the last
        - belong to the new year half an hour after midnight on 1 January, whatever UTC says
        - belong to the old year until midnight in the zone
        - fall due the payment term after the issue date, across a month and a year
    - a calendar day in a zone
        - is the day the instant falls on there, on either side of midnight
        - is read in a named zone only
        - ends a period on the day before the moment it ends
        - moves on by whole days, through the end of February in a leap year
        - belongs to its year
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - the days and the number of an invoice
        - are counted in the installation’s zone: issued at 00:30 on 1 January in Berlin it is the
          new year’s first
        - fall due the payment term the file names after the issue date
        - carry the prefix the file names

<!-- END proof -->

### SC-PRIC-046 — An invoice states the day it is due

🟡 _(Decided, not yet delivered.)_ 💰 An invoice collected by direct debit is due on the collection
date it announces (`SC-PRIC-028`), any other on its issue date plus the payment term named in
`config/saas.yaml`. The grace period of `SC-PRIC-081` counts from that day, and a collection
announced again with a later date leaves the due date as the invoice states it.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-invoice-is-drawn-up-from-its-charges.test.js`
    - the days an invoice states
        - are read in the installation’s zone: a month starting at midnight in Berlin is that month
        - span every line: from the first day any covers to the last
        - belong to the new year half an hour after midnight on 1 January, whatever UTC says
        - belong to the old year until midnight in the zone
        - fall due the payment term after the issue date, across a month and a year
    - how an invoice is paid
        - a direct debit is collected the lead time after the issue date, the day it falls due,
          under its mandate
        - the lead time counts in the installation’s zone, across a month and a year, whatever the
          payment term
        - a card is recorded with the invoice, which falls due the payment term after the issue date
        - without a payment method the invoice is not collected and falls due the payment term after
        - an invoice that asks for ${what} is collected with nothing
        - an invoice that asks for a cent is collected
        - refuses a direct debit without the mandate reference it would have to announce
        - is what the adapter is asked to check, the due date included
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - the days and the number of an invoice
        - are counted in the installation’s zone: issued at 00:30 on 1 January in Berlin it is the
          new year’s first
        - fall due the payment term the file names after the issue date
        - carry the prefix the file names
    - how an invoice is paid
        - a direct debit in use is announced with its mandate, collected and due fourteen days after
          the issue date
        - the lead time the file names counts instead, whatever the payment term
        - a card in use is recorded, and the invoice falls due the payment term after the issue date
        - without a payment method the invoice is not collected and falls due the payment term after
        - a direct debit without a mandate reference holds the invoice, which draws no number until
          the payment method is replaced
        - a direct debit without a mandate reference holds nothing where the invoice asks for
          nothing
        - is the payment method in use when it is issued: not the one it replaced, and a later one
          changes nothing
        - is the subscriber’s own, beside another subscriber’s
        - is collected with nothing where the invoice asks for nothing
- `packages/nest/tests/invoices-start-only-as-configured.test.js`
    - invoices start
        - where they are wired, the file names their range and term, an adapter decides and an
          issuer is named
        - with the quarter-hourly run unless the application leaves it out
        - not where the application wires them and the file names no range or term
        - not where the file names them and the application wires none
        - not without the ${port} of their documents, which the refusal names
        - not beside an archive that would let a document it keeps be changed, naming why
        - not without a tax adapter, nor without an issuer
        - not without a payment gateway, which the refusal names
        - and no wiring nor block at all is no invoicing, and starts

<!-- END proof -->

### SC-PRIC-047 — Every invoice reaches the subscriber by email, with its file attached

🔵 _(Superseded on 2026-10-20 by `SC-PRIC-094`.)_ 💰 Cancellation and replacement invoices as well,
sent to the invoice email on the subscriber's record once the document is archived
(`SC-PRIC-033`), so a subscriber who never signs in, or whose tenant is gone, still receives it.
A link in the message leads to the tenant's sign-in rather than to an address anyone holding it
could open. Where the subscriber's record no longer holds an invoice email, as `SC-PRIV-013`
allows once no claim is left, the operator enters an address to deliver to when cancelling the
invoice, and cannot cancel without one; the address is kept with the cancellation and its reason
and used for the replacement as well, rather than written back onto the subscriber's record. A
message that cannot be delivered is shown to the operator, and the invoice stays issued: delivery
is not what makes it an invoice.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-094 — Every invoice reaches the subscriber by email, with its file attached

🟢 💰 Cancellation and replacement invoices as well, sent to the invoice email on the subscriber's
record once the document is archived (`SC-PRIC-033`), so a subscriber who never signs in, or
whose tenant is gone, still receives it. A link in the message leads to the tenant's sign-in
rather than to an address anyone holding it could open. The operator may give an address to
deliver to when cancelling an invoice, and has to where the subscriber's record no longer holds
an invoice email, as `SC-PRIV-013` allows once no claim is left. Where one is given, the
cancellation invoice, its replacement and what the subscriber is told about collecting the
replacement (`SC-PRIC-028`, `SC-PRIC-080`) go there, one address for all of it; the address is
kept with the cancellation and its reason rather than written back onto the subscriber's record.
A message that cannot be delivered is shown to the operator, and the invoice stays issued:
delivery is not what makes it an invoice.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md` · #334

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-invoice-document-is-archived-and-mailed.test.js`
    - an archived invoice’s mail
        - goes to the invoice email on the subscriber’s record, with the archived file attached
        - is sent once: the next run sends nothing again
        - held by another run is left to it
        - of two runs at the same moment goes out once
        - to a subscriber without an invoice email waits, recorded once, and goes out once one is
          entered
        - the mail refuses is shown to the operator without the address, and tried again by the next
          run
        - the mail refuses in words whose case changes their length still loses the address whole
        - that does not answer in time is held for its answer, and a late success is recorded
        - that fails after the timeout is let go for the next run
        - whose archived file no longer matches its checksum is not sent, and shown to the operator
    - the quarter-hourly run
        - issues an invoice, archives it and mails it in one run
        - whose archiving fails still mails, and the next run archives again
- `packages/nest/tests/an-invoice-is-cancelled.test.js`
    - the documents of a cancellation
        - go to the address given with the cancellation, and the record keeps its own
        - go to the invoice email on the record where no address was given
        - of a replacement cancelled in turn before it was sent go where each cancellation said
        - send the replacement’s notices where they sent the replacement, the record’s email beside
          it
        - reach a subscriber whose record holds no invoice email, the replacement’s notices too

<!-- END proof -->

(decided 2026-10-20)

### SC-PRIC-048 — A billing period whose charges are all zero issues no invoice

🟢 💰 A free plan does not use up an invoice number every period. A
charge of zero is invoiced beside charges that are not, and an invoice whose total a discount brings
to zero is issued, because it records the service and the discount.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-invoice-is-drawn-up-from-its-charges.test.js`
    - the charges one invoice issues
        - are those booked at the same moment under the same contract
        - come the oldest first, whatever order the journal hands them in
        - issue nothing where all of them are zero
        - keep a zero beside an amount, and a discount that brings the total to zero
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - a period whose charges are all zero
        - issues no invoice and draws no number
        - beside a period with an amount leaves that one to be issued

<!-- END proof -->

### SC-PRIC-049 — A subscriber's account is shown to the tenant's users holding the billing permission

🟡 _(Decided, not yet delivered.)_ 💰 Balance, what is open, and the history, in the subscriber's one
live tenant (`SC-SCOPE-012`), to whoever holds the billing permission (`SC-UI-023`). An open balance
a customer cannot see is a surprise at the moment it becomes a problem; one they can see is something
they can act on. The account belongs to the subscriber and shows its amounts, which not every user of
a tenant is meant to see. This entry supersedes `SC-PRIC-019` in the change that delivers it.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIC-061 — A derived amount is rounded the way a person computing it by hand rounds

🟢 💰 A discount taken as a percentage, gross from net and net from gross, the tax a gross amount
includes, and the share of a price a part of a period costs are each computed from the decimals the
amounts and rates were written as, and rounded once, to the cent, half away from zero. 5 % of 20.10
is 1.01, and 11.50 net at 19 % is 13.69 gross — what an accountant, an import into the bookkeeping
and a customer with a calculator arrive at, not a cent less because a binary fraction lay just
below the half. A percentage discount rounds the discount and takes it off, the same way for a promo
code and for a promotion.

_Source:_ #370

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/money-is-rounded-as-written.test.js`
    - the cases a binary double gets wrong
        - 5 % of 20.10 is 1.01
        - 25 % of 9.54 is 2.39
        - 11.50 net at 19 % is 13.69 gross
        - 13.50 net at 19 % is 16.07 gross
    - a half cent
        - rounds up
        - and the value just below it rounds down
        - a credit rounds away from zero, mirrored
        - zero stays zero
    - against whole-number arithmetic
        - a percentage of a price
        - gross from net, net from gross, and the tax a gross amount holds
        - a share of a price for part of a period
    - a sum, and a difference
        - is taken from the decimals, not from their binary difference
        - of any number of cent amounts is their sum in cents
        - of nothing is 0
    - an amount that is not a number of any kind
        - NaN is refused rather than rounded
        - Infinity, either sign, is refused rather than rounded
- `packages/core/tests/promotion-helpers.test.js`
    - applyPromo
        - a percentage takes off its discount rounded, as a promo code does
- `packages/nest/tests/an-offer-is-concluded-with-its-contract.test.js`
    - concluding an offer
        - refuses an offer whose gross was rounded a cent short, rather than conclude another total
- `packages/nest/tests/an-upgrade-runs-inside-the-paid-period.test.js`
    - half of a price that ends on an odd cent
        - is charged as 0.58 for the rest of the period
        - and is 0.58 of rest a new period is reduced by
- `packages/nest/tests/promo-calculator.test.js`
    - a percentage discount on a half cent rounds the way a person computing it rounds

<!-- END proof -->

### SC-PRIC-062 — A period from a retirement's date is charged at the replacement's price

🟢 💰 A plan line of the version being retired prices no period that starts on or after the date the
subscriber was told. Such a period waits, uncharged, for the contract the move writes, and is then
charged at the replacement's price — also where the move is written after the period has ended, or
an application wrote a contract on the retired version in between. A contract a retirement writes,
by its move or by the switch it offers, adds no prorated difference: it is not an upgrade the
subscriber chose.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retired-version-is-charged-to-its-date.test.js`
    - a period from the date the subscriber was told
        - waits while the subscription is on the version retired, and is charged from the move
        - is charged from a move written after it ended, and so is every period in between
        - is not charged from a contract an application wrote on the version retired in between
        - is not priced by a change the subscriber made later, on another plan
        - leaves the add-ons the contract names to be charged as before
        - a period that starts before the date is the version retired’s, at its price
        - a contract a retirement writes adds no difference inside a period the version left priced
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a contract a retirement writes
        - marks its plan line with the retirement, and adds nothing to the move

<!-- END proof -->

### SC-PRIC-063 — After a free switch to a dearer replacement, the price is held until the date

🟢 💰 The contract the switch writes names the replacement at its own price and holds the
difference as a discount line until the date the subscriber was told. The journal takes it off every
period on the replacement that starts before that date, also where a later contract was written in
between; a period that starts on the date or after it is charged in full. Leaving the replacement
ends it, and a change of rhythm moves what is left of it to the first period in the new rhythm,
once, as it does for every agreed discount.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retired-version-is-charged-to-its-date.test.js`
    - the price a switch holds
        - takes the difference off each period before the date, and nothing from it
        - stays where it was agreed when a contract is written again before the date
        - ends when the subscriber leaves the version switched to
        - a cheaper replacement holds nothing: its price applies from the next period
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a contract a retirement writes
        - holds the price of a switch to a dearer replacement as a discount line until the date

<!-- END proof -->

### SC-PRIC-064 — The German tax adapter decides Germany, businesses abroad and small businesses

🟢 💰 `@saasicat/tax-de` is the first adapter and the template for the others. For an issuer in
Germany it decides:

- a subscriber in Germany, business or consumer: the German standard rate in force on the last day
  of the period the charge covers, that day counted in the installation's time zone
  (`SC-PRIC-045`);
- where the issuer declares the small business exemption, an option of the adapter: a subscriber in
  Germany without VAT and with the note § 19 UStG asks for, in German; the exemption reaches
  subscribers in Germany only;
- a business in another member state of the European Union with a validated VAT identification
  number: the reverse charge, with the note § 14a (5) UStG asks for and its English beside it,
  provided the issuer has a VAT identification number of its own for the invoice to name beside the
  subscriber's;
- a business outside the European Union: not taxable in Germany, with a note saying so in German
  and English.

Every other case is answered as not supported and refused (`SC-PRIC-039`): an issuer outside
Germany, a subscriber whose country or business status is not stated, a consumer outside Germany, a
business in another member state without a validated number, a validated number of another state
than the billing address, a German one included, a number of a member state with a billing address
outside the European Union, a reverse charge for an issuer without a VAT identification number, a
subscriber in Monaco, which belongs to the French VAT territory, and a period ending before the
first rate the adapter knows. A note is recorded word for word with
the contract and the invoice. A VAT identification number is checked through VIES, naming the issuer's
own number as the requester where it has one, so the answer carries the request identifier that
confirms it; a number VIES cannot read as one is a completed check that found it invalid, and an
error, a timeout or an answer the adapter cannot read is a check that did not complete
(`SC-PRIC-040`). The adapter is a template, not tax advice: the operator stays responsible for the
tax it charges.

_Source:_ #331 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/tax-de/tests/a-charge-is-decided-by-german-law.test.js`
    - a charge for an issuer in Germany
        - to a subscriber in Germany carries the German rate, business or consumer or not stated
        - to a business elsewhere in the Union with a validated number is under the reverse charge
        - to a business outside the Union is not taxable in Germany
        - by a small business is free of VAT for a subscriber in Germany, and only there
        - names the adapter and the version it was published as on every treatment
        - the CommonJS build reads the same version
    - a case the adapter does not decide is refused, saying why
        - an issuer outside Germany, or one whose country is not configured
        - a subscriber whose country is not known
        - a consumer outside Germany, in the Union or beyond it
        - a subscriber outside Germany who has not said whether it is a business
        - a business elsewhere in the Union whose number is entered but not validated
        - a reverse charge for an issuer without a VAT identification number, small business or not
        - a validated number of another member state than the address, a German one included
        - a number of a member state with an address outside the Union, validated or only entered
        - a number is one of a member state by its prefix and the format of that state, not its
          first letters
        - a business in Monaco, which belongs to the French VAT territory
    - the rate is the one in force on the period's last day, in the installation's time zone
        - each change, on its last day and the millisecond after
        - a period ending before the first rate the adapter knows is refused
        - the same period ends on another day in another zone, and takes the rate of that day
        - a malformed period or zone is an error on every path, not only where a rate is looked up
        - a period that does not end after it begins, or a zone nobody knows, is an error
- `packages/tax-de/tests/a-vat-id-is-checked-through-vies.test.js`
    - the request names the number, and the issuer as requester where it has a number
        - with the number of the issuer: prefix and rest of both
        - without one: the number alone

<!-- END proof -->

### SC-PRIC-065 — Gross, net and tax are one calculation at the rate that applies, stated once

🟢 💰 Gross follows from net and the rate that applies — the file's rate where `config/saas.yaml`
names no tax adapter, and where it names one, the rate the adapter decides for the subscriber, or
for a subscriber in the issuer's country while the subscriber is not known yet. The tax contained in
a gross amount follows from the same rate. Both are rounded once and mean the same thing everywhere
they appear.

_Source:_ #331 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contract-takes-the-rate-its-tax-adapter-decides.test.js`
    - a contract takes the rate the tax adapter decides for its subscriber
        - a subscriber in Germany: 19 %, the code is 8.40 € net, the treatment recorded
        - a business in Austria with a validated number: reverse charge at 0 %, and the code takes
          10 € off
        - a business in Switzerland: not taxable, at 0 %
        - a consumer in France is refused with the adapter sentence, and nothing is written
        - a business in Austria whose number is not validated is refused
        - a contract handed over at a rate other than the decided one is refused, naming the field
        - a subscriber the adapter cannot treat gets no new contract: refused before a change moves
          anything
        - a change that ends in no contract asks for the party alone
        - the question before a change is asked over the contract it ends in: its start, its rhythm
          and its end
        - a successor is decided before the contract in force ends, so a refusal leaves that one
          running
    - a sign-up concludes its offer at the rate decided for the subscriber it creates
        - a consumer in Germany: 19 %, the treatment recorded
        - a business in Switzerland: not taxable, every line at 0 %
        - a business in Austria is refused before anything is written: nothing of a subscriber not
          created yet is validated
        - a business in Austria whose number step 4 checked: reverse charge, and the check kept with
          the subscriber
        - a consumer in France is refused before anything is written
        - a tenant with its subscriber already is refused as such, before the new details are asked
          about
        - a tenant with its subscriber already is decided from that one
- `packages/nest/tests/the-shown-rate-is-the-adapters-for-the-issuers-country.test.js`
    - the shown rate is the tax adapter answer for the issuer country
        - the adapter is asked for a subscriber in the issuer country whose other details are
          unknown
        - the pricing page shows it, and says it is the rate for the issuer country
        - a rate passed beside the adapter is refused, not shown
        - without an adapter the page shows the rate passed, for everybody
        - the configurator shows the adapter rate, and refuses a provider rate beside it
        - the admin manifest shows it, in the application as composed
        - without an adapter the configurator needs the provider rate

<!-- END proof -->

### SC-PRIC-066 — An installation sells in one currency, and its rate comes from one source named once

🟢 💰 The currency is named once, and changing it after contracts exist is a migration rather than
an edit, because a currency change must not silently relabel history. The rate comes from one
source: `vatRate`, required even when it is zero, where the installation names no tax adapter, or
the adapter named under `tax`, which then decides every rate and needs the installation's time zone
(`SC-PRIC-045`). A file naming both, or neither, does not load, and says which line to change; an
application that binds an adapter the file does not name, or names a rate beside one, does not
start.

_Source:_ #331 · #217 · #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-file-names-its-rate-or-its-tax-adapter.test.js`
    - a file names its rate or its tax adapter, one of the two
        - vatRate alone loads, as it always did
        - tax with a time zone loads, without vatRate
        - both are refused, naming the vatRate line
        - neither is refused, naming vatRate as Ajv did while it was required
        - tax without a time zone is refused, naming timeZone
        - a time zone the runtime does not know is refused, naming it
        - the refusals hold when the caller skips the cross-field checks
    - the bound adapter is the one the file names, and it can decide
        - a file with vatRate and no bound adapter takes the file rate
        - a file naming tax with the factory bound shows the adapter rate for the issuer country
        - the start is refused when ${name}
        - the start is refused when the adapter cannot decide a charge in the issuer country
        - a case the adapter does not support is refused with 422 and its sentence

<!-- END proof -->

### SC-PRIC-067 — A contract records the rate and the treatment it was concluded at

🟢 💰 A contract concluded at 19 % records 19 % for its term, whatever the rate of the file later
becomes. Where a tax adapter decides, a contract records the rate and the treatment decided for its
subscriber's origin when it was concluded, with the adapter's name and version; every later
contract — a plan change, an add-on, a refresh — is decided again from the origin as it stands, and
one whose stated rate is not the decided one is refused rather than written.

_Source:_ #331 · #217 · #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contract-takes-the-rate-its-tax-adapter-decides.test.js`
    - a contract takes the rate the tax adapter decides for its subscriber
        - a subscriber in Germany: 19 %, the code is 8.40 € net, the treatment recorded
        - a business in Austria with a validated number: reverse charge at 0 %, and the code takes
          10 € off
        - a business in Switzerland: not taxable, at 0 %
        - a consumer in France is refused with the adapter sentence, and nothing is written
        - a business in Austria whose number is not validated is refused
        - a contract handed over at a rate other than the decided one is refused, naming the field
        - a subscriber the adapter cannot treat gets no new contract: refused before a change moves
          anything
        - a change that ends in no contract asks for the party alone
        - the question before a change is asked over the contract it ends in: its start, its rhythm
          and its end
        - a successor is decided before the contract in force ends, so a refusal leaves that one
          running
    - a contract is decided for the party it copies, read once
        - an address cleared while the contract is written: the contract names the complete one it
          was checked on
        - a country changed while a successor is written: the successor names the country its rate
          was decided for
    - a sign-up concludes its offer at the rate decided for the subscriber it creates
        - a consumer in Germany: 19 %, the treatment recorded
        - a business in Switzerland: not taxable, every line at 0 %
        - a business in Austria is refused before anything is written: nothing of a subscriber not
          created yet is validated
        - a business in Austria whose number step 4 checked: reverse charge, and the check kept with
          the subscriber
        - a consumer in France is refused before anything is written
        - a tenant with its subscriber already is refused as such, before the new details are asked
          about
        - a tenant with its subscriber already is decided from that one
    - a plan change is frozen at the rate decided for the subscriber
        - a business in Switzerland: 0 %, the treatment recorded
        - a consumer in France gets no contract
- `packages/nest/tests/an-operator-carries-a-vocabulary-into-running-contracts.test.js`
    - where a tax adapter decides
        - the features are carried over while the rate decided for the subscriber stands
        - a subscriber the adapter now decides another rate for is refused in the preview and in the
          run
        - a subscriber the adapter supports no treatment for is refused with its sentence
        - a features refresh keeps the agreed parties, so an address emptied since does not hold it
          back
        - a full re-freeze copies the parties anew, and an incomplete address refuses it
        - re-freezing in full at a newly decided rate is a change of money, refused
- `packages/nest/tests/an-upgrade-runs-inside-the-paid-period.test.js`
    - a plan change asks the party about the contract it ends in
        - one made today: from today, in the rhythm asked for
        - one made today in a trial ends in no contract: the party is asked, the tax is not
        - one scheduled: from the date it takes effect, before anything is scheduled
- `packages/nest/tests/subscription-contract-service.test.js`
    - the money facts a contract inherits from its offer
        - the rate the offer states is recorded as the percentage it is
        - and the rate it records explains the tax it records
        - every line names the currency the offer froze
        - and the tax on each closes the gap between its own net and gross
        - the discount the offer implies carries a negative tax, not a positive one

<!-- END proof -->

### SC-PRIC-068 — A new subscriber is asked about before it exists

🟢 💰 Where a tax adapter decides, a sign-up's step 4 and an application creating a subscriber of its
own ask it first, outside any transaction, from the details as given. Only where it supports no
treatment and a VAT identification number is given is the number checked, with the service the
adapter names, and the adapter asked again from the check: which numbers a treatment depends on is
the adapter's to say. A case it still does not support is refused with its sentence. A check that
does not complete refuses the step, to be tried again later, and is never read as a validation. The
check is kept with the subscriber it becomes, and a check of another number than the subscriber's is
refused before anything is written. This is the part of `SC-PRIC-039` and `SC-PRIC-040` that comes
before a subscriber exists.

_Source:_ #331 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-new-subscriber-is-assessed-before-it-is-created.test.js`
    - an application asks before it creates a subscriber
        - a subscriber in Germany is treated as given: no number is checked
        - a business in Austria: its number checked as it will be held, and the check attached
        - a consumer outside Germany with a number: checked, and still refused with the adapter
          sentence
        - a check that does not complete is a 503 naming the adapter and why, never a validation
        - an adapter that fails is not taken for a refusal: its error comes through
        - without an adapter the details come back as they are, nothing checked
    - a subscriber created with a check keeps it
        - the attached check is recorded, and the number counts as validated
        - a check is recorded only on the transaction the subscriber is created on
        - assessed details need the transaction even where no check was needed
        - a check of another number is refused before anything is written
        - created without a check, no number counts as validated
- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - where a tax adapter decides, step 4 asks it before the gateway form opens
        - a business elsewhere in the Union: its number is checked once, kept, and the form opens
        - and the subscriber it becomes takes the check over, so its number counts as validated
        - ${what} is refused, nothing is kept, and the form does not open
        - where no form can open, the adapter and the number service are not asked at all
        - a repository that does not keep ${dropped} is a wiring error in step 4
        - a business outside the Union is not taxable as given: its number is not checked
        - it is asked over the contract the sign-up will have: a year, where a yearly rhythm was
          chosen
        - without an adapter the business status is kept, and nothing is checked
        - a business status that is not true or false is refused at the door

<!-- END proof -->

### SC-PRIC-069 — With a tax adapter, a contract names its subscriber only with a complete address

🟢 💰 Every contract names its subscriber with the address an invoice names: street and number,
postal code, city and country (`SC-PRIC-032`). Where `config/saas.yaml` names a tax adapter, a
contract is concluded only for a subscriber that has all four, whichever way it comes about — a
sign-up, an offer, a plan change, an add-on, a full re-freeze. The refusal names the empty fields,
before the adapter is asked. A refresh that keeps the parties a running contract already names is
not refused, and without an adapter nothing changes. This is the part of `SC-PRIC-032` a contract
holds; the invoice's part comes with the invoices.

_Source:_ #331 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contract-takes-the-rate-its-tax-adapter-decides.test.js`
    - where a tax adapter decides, a contract copies a complete invoice address
        - a subscriber without part of its address gets no contract, the empty fields named
        - and is refused before a change moves anything, but not for a change in a trial
        - a sign-up whose details lack the address is refused before any transaction
        - an empty country is a gap in the address, named before the adapter is asked
        - the address is asked before the tax: an incomplete one in France names the address
    - a contract is decided for the party it copies, read once
        - an address cleared while the contract is written: the contract names the complete one it
          was checked on
        - a country changed while a successor is written: the successor names the country its rate
          was decided for

<!-- END proof -->

### SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back

🟢 💰 Where a tax adapter decides, a subscriber's standing is computed when it is read, from the
record and the adapter as they are then: the empty fields of its address, and the adapter's sentence
where it supports no treatment for the subscriber as it stands. The operator sees it beside the
tenant, with the subscriber's address, whether it acts as a business, its VAT identification number
and whether the check that counts found it valid; the lists of tenants and of subscriptions mark each
tenant held back, and ask only where an adapter decides. The tenant sees it with its billing details,
beside whether it acts as a business. An adapter that fails is not read as a refusal: its error comes
through. This is the part of `SC-PRIC-032` and `SC-PRIC-039` that shows the operator a subscriber
waiting and why.

_Source:_ #331 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-shows-what-holds-its-next-contract-back.test.js`
    - what holds a subscriber’s next contract back
        - nothing, for a consumer in Germany with its address
        - the empty fields of its address, in the order an invoice names them
        - the adapter sentence, for a case it supports no treatment for
        - a business in Austria: held back until its number is validated, then not
        - an adapter that fails is not read as a refusal: its error comes through
        - a tenant without a subscriber is told so
        - without an adapter nothing holds a contract back, so there is no answer
- `packages/nest/tests/a-tenant-keeps-its-billing-details.test.js`
    - the tenant sees what holds its next contract back
        - nothing, with its address complete in a case the adapter treats; and whether it acts as a
          business
        - the fields of its address that are empty — and none once it fills them in
        - the adapter sentence where it treats no such case — and none once the country it can treat
          is named
- `packages/nest/tests/an-operator-sees-a-tenants-subscriber.test.js`
    - the operator sees a tenant's subscriber beside the tenant
        - its address and tax details, and that nothing holds its next contract back
        - a VAT id counts as validated where the check that counts found it valid
        - the empty fields of its address, and the adapter sentence, where they hold it back
        - a tenant without a subscriber has none to show
        - an unknown tenant is answered as not found, by code, and no subscriber is read
        - the tenant is found and its subscriber read outside the tenants' row-level policy
    - the tenants of a list whose subscriber is held back
        - each named with what holds it back; the ready ones and those without a subscriber are left
          out
        - one tenant as the query sent it, where the pipe does not transform: still that tenant
        - only among the tenants named
    - where no tax adapter decides
        - the subscriber is shown without a standing, and the lists are not asked to mark one
- `packages/ui-vue/tests/component/lists-mark-a-held-back-subscriber.test.ts`
    - the tenant list
        - marks the tenants held back, each with its reason, and asks once for the page
        - without a tax adapter it asks nothing and marks nobody
    - the subscription list
        - marks the tenant of each subscription held back, beside its name
- `packages/ui-vue/tests/component/tenant-detail-shows-the-subscriber.test.ts`
    - the tenant detail shows the tenant's subscriber
        - whom the contracts are concluded with, and the way into its record
        - a warning names each reason the next contract is held back
        - a tenant without a subscriber says so, and offers no record
        - a read that fails says so
        - without the capability, nothing is asked and no section is shown
- `packages/ui-vue/tests/tenant-subscriber-resource.test.js`
    - tenantsResource.subscriber
        - asks for the tenant's subscriber, with its slug escaped
        - an answer with no body is an error, not a tenant without a subscriber
    - tenantsResource.subscriberAttention
        - names each tenant once, and answers what the server holds back
        - a list longer than the server takes is asked in pages of two hundred
        - no tenants, no request
- `packages/ui-vue/tests/use-subscriber-attention.test.js`
    - useSubscriberAttention
        - asks once for the tenants shown, and answers each by its id
        - with ${label}, nothing is asked and nobody is held back
        - an empty list asks nothing
        - another page of tenants is asked about again
        - a read that fails leaves an error, and nobody marked
- `packages/ui-vue/tests/use-tenant-subscriber.test.js`
    - useTenantSubscriber
        - where the manifest announces the subscriber, it is read for the tenant
        - with ${label}, nothing is asked and nothing is shown
        - another tenant is another subscriber, and no tenant asks nothing
        - a read that fails leaves an error and no subscriber
- `packages/ui-vue-tenant/tests/component/a-tenant-finds-its-billing-under-billing.test.ts`
    - what holds the next contract back
        - the customer type is shown with the identity, as the operator keeps it
        - the empty address fields by their labels, then the adapter sentence
        - once the tenant fills the address in and nothing holds it back, the notice goes
        - where ${label}, there is no notice

<!-- END proof -->

### SC-PRIC-071 — A VAT number the operator corrects or checks is checked, and every outcome kept

🟢 💰 Where a tax adapter decides, a VAT identification number a correction gives the subscriber is
checked with the service the adapter names as soon as the subscriber holds it, and the operator can
check the number held again at any time, without the second factor. A completed check is kept with
its date and the service's confirmation, valid or not; the number counts as validated only on a
valid answer, and only for the number it checked. A check that does not complete keeps nothing and
says why: the correction stands, and the number is as validated as it was — never validated on a
number not checked (`SC-PRIC-040`). Without an adapter a number is corrected and not checked, and a
check is refused as unavailable. This is the part of `SC-PRIC-040` and `SC-PRIC-043` the corrections
hold.

_Source:_ #331 · `docs/explanation/adr/0013-tax-law-is-an-adapter.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-corrected-vat-id-is-checked-and-recorded.test.js`
    - a correction that gives the subscriber another VAT number
        - has the number checked once it holds it: a valid answer counts, and the next contract may
          follow
        - keeps the correction where the number is found invalid: the check is recorded, and nothing
          is validated
        - keeps the correction where the check does not complete: nothing is recorded, and why is
          said
        - checks the number it wrote where another correction ${what} before the check
        - a valid check of the number replaced does not count for the new one
    - a correction that checks nothing
        - ${what}: the service is not asked
        - the correction alone: written, and the service is asked only when its number is checked
        - where no tax adapter decides: the number is corrected, and nothing is checked
    - checking the number held, again
        - records a valid answer, which then counts
        - records an invalid answer, which a later valid one replaces
        - kept, and not counting, where the number was corrected while the service answered
        - says why where it does not complete, and leaves an earlier valid check counting
        - is refused for a subscriber without a number, and the service is not asked
        - is refused where no tax adapter names a service to check with
        - is refused for a tenant without a subscriber
- `packages/nest/tests/an-operator-corrects-a-subscriber-in-the-administration.test.js`
    - the operator corrects a subscriber's legal identity
        - a VAT number it gives is checked right after, and a valid answer releases the next
          contract
    - the operator checks the VAT number held, again
        - the answer is recorded, counts for the number, and is audited
        - an answer that did not come is said, and the earlier valid check still counts
        - a subscriber without a number has none to check
        - without a tax adapter there is no service to check with
- `packages/ui-vue/tests/component/an-operator-corrects-the-subscriber.test.ts`
    - the operator corrects the subscriber in its record
        - a check is asked without the second factor
- `packages/ui-vue/tests/use-subscriber-corrections.test.js`
    - useSubscriberCorrections
        - after a correction, the service's answer — ${found} — is announced as such, the correction
          beneath it
        - a check needs no second factor, announces what the service found, and reads again

<!-- END proof -->

### SC-PRIC-072 — Invoice numbers run without gaps in one range per issuer, restarting each year

🟢 💰 An invoice number is `<prefix>-<year>-<sequence>`, such as `AHP-2026-000123`: the prefix
`config/saas.yaml` names under `invoicing`, the year of the issue date in the installation's time
zone (`SC-PRIC-045`), and the sequence, which starts at 1 again on 1 January and is written with six
digits at least. The number is drawn in the transaction that writes the invoice, so an invoice that
fails to be written leaves no gap, and two issued at the same moment take two numbers one after the
other; and it is drawn only after the tax adapter has accepted the invoice's content
(`SC-PRIC-027`), so a refusal leaves no number behind. An installation is the range of exactly one
issuer, and an issuer keeps one range: a second application of the same issuer is not supported.
The law asks for a unique, sequential number; the gapless range spares an audit the question of a
missing one.

_Source:_ #332 · #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-invoice-is-drawn-up-from-its-charges.test.js`
    - an invoice number
        - is the prefix, the year and the sequence in six digits at least
        - has no sequence below 1, and no fraction of one
        - takes the prefix the invoice is drawn up with
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - the days and the number of an invoice
        - are counted in the installation’s zone: issued at 00:30 on 1 January in Berlin it is the
          new year’s first
        - fall due the payment term the file names after the issue date
        - carry the prefix the file names
- `packages/nest/tests/invoices-start-only-as-configured.test.js`
    - the range of one issuer
        - needs the record of the applied settings, without which another legal entity could take it
          over

<!-- END proof -->

### SC-PRIC-073 — A line that loses a withdrawn feature is charged less for the time without it

🟢 💰 Each plan line and each booking the withdrawal reached is reduced by the amount named for its
plan or add-on in its rhythm, for the days without the feature, pro rata within a period and never
below nothing. Where the date falls inside a period already charged, the rest of that period from
the date is credited. The reduction is written into the contract as a generated discount line — at
the announcement, or into the next contract written for another reason — and it stays with the line
it reached: across a move to another version of the same plan or add-on that still grants the
feature, and not past a change of plan or rhythm the subscriber makes, which ends it from the new
plan's first period. What is concluded after the announcement is not reduced (`SC-CAT-017`).

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-reduction-is-written-into-the-contract.test.js`
    - the reductions of a withdrawal
        - are written into a successor of the contract in force, which keeps everything else
        - are written once
        - reduce a line no further than its price
        - keep the amount named for the periods to come, though the line takes off no more than its
          price
        - reduce only the lines the subscription was told of, as it was told of them
        - reduce the line a change scheduled before the announcement brings, once its contract is
          written
        - write nothing for a withdrawal lifted before its date
        - wait for a contract where none is in force
        - go into a contract a later change writes, where none records them yet
- `packages/nest/tests/a-withdrawn-feature-is-charged-less.test.js`
    - a period charged before the withdrawal takes effect
        - is credited from its date for the rest of the period, and not before the date
    - a period charged while the feature is withdrawn
        - is reduced with its charge, and the next one is not once the feature is back
        - is reduced in advance for the days from a date that falls inside it
        - is reduced pro rata where the return is known when it is charged
        - is never taken below nothing
    - two withdrawals of one line
        - each take off their own days, up to what those days cost
        - take off no more than their days cost where another discount lowers the period
        - never take more together than the period costs, and the other gains what one gives back
        - give the other nothing of the days one returns before they have returned
        - never take more together than the period costs before one returns, where the other holds
          nothing yet
        - never take more together than the period costs where one begins after the other
    - the line a reduction stays with
        - is the plan in its rhythm on any version that grants the feature
        - and not a version that no longer grants it
        - and not another plan the subscriber changed to
    - a reduction no contract records yet
        - is written into the contract before the period is charged
        - is asked for only where the subscription was told of a withdrawal
        - leaves the rest charged where writing it fails

<!-- END proof -->

### SC-PRIC-074 — A reduction for days the feature turned out not to miss is taken back

🟢 💰 Where the days without the feature turn out fewer than a period was reduced for — the withdrawal
is lifted, or the line stops running before the period ends — the journal takes back the reduction
for the days it no longer covers, under its own origin `reductionTakenBack` rather than as a
correction.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-withdrawn-feature-is-charged-less.test.js`
    - a reduction granted for days the feature turned out to be there
        - is taken back from the day it returned, on that day
        - takes nothing back where the withdrawal was lifted before its date
        - ends with a change into a longer rhythm, which credits the rest of the period

<!-- END proof -->

### SC-PRIC-075 — Ending at once under a withdrawal credits the unused rest of what was charged

🟢 💰 A subscription ended at once (`SC-CANC-024`) is credited the unused rest of every period already
charged — its plan's and every add-on's — and a booking ended at once (`SC-BUN-062`) its own, each
net of the reduction for those days. The credit is shown before the end is confirmed and written to
the subscriber's account once; SaaSiCat starts no payment, and the operator pays it out.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-withdrawn-feature-is-charged-less.test.js`
    - ending at once while the feature is withdrawn
        - shows first what it then credits: ${name}
        - credits the unused rest of the plan and of every add-on, net of the reduction
        - credits no more than the period cost, however the rest and the reduction round
        - credits no more than a longer rhythm's period cost, whatever the period it replaced gave
          back
        - credits the rest of a booking that ends at once alone, and its reduction
        - shows first the credit it then writes, and writes nothing to show it
        - credits nothing for an end the account was not told was at once
        - credits nothing where the end recorded is not the one the notice names
        - writes each entry once however often the account is brought up to date

<!-- END proof -->
