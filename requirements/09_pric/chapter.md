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

- `packages/ui-vue-tenant/tests/component/a-bundle-is-bought-in-a-rhythm.test.ts`
    - a monthly plan offers no choice
        - the card quotes the monthly price with the monthly unit
    - a yearly plan offers both
        - switching moves the price and the unit together

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

- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a yearly contract holding a monthly add-on
        - counts the add-on as often as it falls due
        - a yearly add-on beside a yearly plan is counted once
        - a monthly contract adds a monthly add-on as it stands
- `packages/nest/tests/tenant-subscription-bundles-refreeze.test.js`
    - add re-freezes the contract with an unchanged plan
    - cancel re-freezes the contract
    - without a ContractFreezePort, add works unchanged
    - freeze error is non-fatal — the mutation result still comes back
    - a failed mutation triggers no freeze

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
        - a currency other than the euro is the one that is recorded
- `packages/nest/tests/subscription-contract-service.test.js`
    - the money facts a contract inherits from its offer
        - a rate the offer states as a fraction is recorded in per cent
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
        - a rate the offer states as a fraction is recorded in per cent
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
        - a currency other than the euro is the one that is recorded
- `packages/nest/tests/subscription-contract-service.test.js`
    - the money facts a contract inherits from its offer
        - a rate the offer states as a fraction is recorded in per cent
        - and the rate it records explains the tax it records
        - every line names the currency the offer froze
        - and the tax on each closes the gap between its own net and gross
        - the discount the offer implies carries a negative tax, not a positive one
    - reading the unit an offer states its VAT rate in
        - a fraction beside totals that agree with it becomes a percentage
        - a percentage beside totals that agree with it is left as it is
        - zero is zero under either reading
        - totals that prove nothing fall to the unit this platform produces
        - a total of nothing is still read as the fraction it is
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a line item learns the money it was booked with
        - the values come from the contract the line belongs to
        - a rate no reading brings inside 0-100 stops the migration and is named
        - a free plan frozen from the catalogue keeps its rate as it stands

<!-- END proof -->

### SC-PRIC-018 — Rounding happens once, when a charge is written

🟡 _(Decided, not yet delivered.)_ 💰 The written figure is the truth from then on.

_Source:_ #214

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

🟡 _(Decided, not yet delivered.)_ 💰 A correction is a counter-entry. A record that can be rewritten
answers what somebody thinks today, not what happened.

_Source:_ #214

### SC-PRIC-021 — An internal account reference is never shown to a customer as an invoice number

🟡 _(Decided, not yet delivered.)_ Invoice numbering is sequential, gapless and legally constrained
per country, and an identifier a customer has already seen on a screen cannot become one later
without confusion.

_Source:_ #214
