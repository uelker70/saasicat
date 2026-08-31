---
title: Add-on bundles
---

An add-on is bought on top of a plan and lives and dies with it. Nearly everything here follows
from that one sentence: the rhythm it may be billed in, when its periods end, what happens when
the plan ends, and why no money ever comes back. The chapter also says what a tenant has to be
told before they buy, because several of these rules are only fair if they are read first.

### SC-BUN-001 — An add-on is bought on top of a plan, never instead of one

🟢 A tenant cannot use an add-on without a plan, so the plan is what an add-on hangs off.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - a tenant books a bundle
        - on a running plan it gets a window on the plan’s day
        - during a trial it is booked, and waits for a window rather than inventing one
        - a plan that has no price for it refuses the booking outright
        - …while a plan the override does not touch books it happily

<!-- END proof -->

### SC-BUN-002 — An add-on's periods end on the day the plan's do

🟢 The alignment is made when the add-on is booked rather than repaired when the plan ends, because a
period that has to be trimmed is one somebody was committed to more of than they received — and
then owed the difference.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - a monthly bundle on a yearly plan ending on the 31st
        - bills the first, short period to the end of February
        - and every month after it to the plan day, landing with the plan
    - a monthly bundle on a yearly plan ending on the 17th
        - runs its first period past the month end, to the plan day
        - and lands on the plan with every month between
    - a bundle booked on the plan day itself
        - gets a whole period rather than an empty one
        - while the day before it gets the short one it is entitled to
    - a plan whose periods do not end at midnight
        - a booking earlier that day still meets the boundary that day
        - a booking after it takes the next month, at the same time of day
        - and every period after it keeps that time
        - the pro-rata denominator keeps it too, so a cycle is a whole cycle
    - a yearly bundle
        - meets the plan on its own boundary, month and day together
        - and takes the following year when booked after that boundary
    - a plan whose anchor is not stored
        - falls back to the day its period ends on
    - rolling a booking on, period after period
        - a period that is over opens the next one, on the anchor
        - a period still running is left alone
        - a booking billed with the plan is left alone
        - a booking made before its plan had a period gets one once the plan does
        - a first window opened late lands after now, not months before it
        - a first window opened promptly is the short one it should be
        - a booking still waiting keeps waiting while the plan has no period either
        - a first window is capped by the plan’s end like any other
        - a window that would end at or before it starts is not opened at all
        - every window it does hand back ends after it starts
        - a job that missed months catches up in one go
        - catching up keeps the anchor rather than losing it to a short month
        - a declared cancellation caps the window it opens
        - a declared cancellation already passed opens nothing at all
        - whichever ends first wins — the plan or the booking
        - a first window is capped by a declared cancellation too
        - a cancelled booking is not given a first window either
        - a landed cancellation of the booking stops it; a declared one does not
        - a plan that has ended takes the booking with it, without a cancellation
        - a plan ending inside the new period cuts it back rather than outliving it
        - a plan ending exactly on the boundary gives the booking that period
        - a booking with no rhythm of its own follows the plan’s
        - a monthly booking beside a yearly plan keeps its own month
    - one answer for the plan’s billing day
        - a stored anchor is the answer
        - without one, the day that opened the window — never the day that closed it
        - without a window either, the day the subscription started
        - with nothing at all it says so, rather than inventing a day
        - a value that cannot be a day of a month is treated as absent
        - the preview and the booking reach the same day for the same subscription

<!-- END proof -->

### SC-BUN-003 — The first period of a booking is short, and charged for exactly that stretch

🟢 💰 It runs from the booking to the next occurrence of the plan's billing day and is charged pro
rata. The fraction is taken against a whole cycle of the add-on's own rhythm, so a monthly add-on on
a yearly plan is not charged a fraction of a year at a monthly price.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - a bundle booked on the plan day itself
        - gets a whole period rather than an empty one
        - while the day before it gets the short one it is entitled to
    - booked anywhere inside a plan period
        - on the first day it runs the whole way to the plan’s next day
        - in the middle it runs to the same day
        - on the last day it still gets a period rather than none
        - a day past the boundary belongs to the next period, not a zero-length one
    - booking one, through the service that writes it
        - a monthly bundle on a yearly plan is stored with the short first period
        - and defaults to the rhythm of the plan when the tenant does not choose
        - while a yearly bundle on a monthly plan is refused outright
        - and a monthly bundle on a monthly plan is not
    - what the short first period costs
        - the cycle it is charged against ends where the first period does
        - a yearly bundle is charged against a year, not a month
        - the anchor survives being walked backwards, the same as forwards
        - stepping back from January lands in December of the year before
        - a leap day retreats to the 28th, and forwards again to the 29th
        - the start it gives back is the boundary that leads to that end

<!-- END proof -->

### SC-BUN-004 — A tenant on a monthly plan cannot book a yearly add-on

🟢 The plan would end twelve times before the add-on's first period did, and each of those is a
moment the tenant could be left committed to something that grants nothing.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - which cycles a bundle may be sold on
        - every combination, not three of the four
        - ${bundle} bundle on a ${plan} plan is ${allowed ?

<!-- END proof -->

### SC-BUN-005 — A tenant on a yearly plan chooses the rhythm each add-on is billed in

🟢 Preselected to the plan's own rhythm, so a tenant who does nothing gets what they would have got
before. On a monthly plan no control appears: a question with one answer is not a question.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - the request bodies a tenant can send
        - a booking needs a version id, and it must be one
        - the rhythm is one of two words, and nothing else
        - the rhythm is optional — omitting it means the plan’s, and so does null
        - a minimum term is a whole number of months within ten years
        - a preview takes the same rhythm the booking does
        - a preview asks about exactly one thing, and either is optional alone
- `packages/nest/tests/subscription-bundle-preview.test.js`
    - a bundle billed in its own rhythm
        - a monthly bundle on a yearly plan is quoted monthly, over its own month
        - without a cycle it still quotes the plan’s
        - a yearly bundle beside a monthly plan is refused, not quoted
        - a bundle with no price in the asked rhythm is refused, not given away
        - the preview names the day the plan takes the bundle down with it
        - a plan that runs on names no end at all

<!-- END proof -->

### SC-BUN-006 — The price an add-on is advertised at is the price it is booked at

🟢 💰 Including its unit. A card saying "per month" beside a yearly plan is the figure a tenant
compares add-ons by, and comparing by the wrong one is a decision made on wrong information even
when the confirmation later shows the right amount.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - the price a booking is billed at
        - follows the rhythm the booking was made in
        - a monthly booking beside a yearly plan is billed monthly
        - a booking from before the rhythm was recorded takes the plan’s
        - a plan-specific override is what the tenant on that plan is billed
        - a booking whose version has vanished reports no price rather than a wrong one

<!-- END proof -->

### SC-BUN-007 — An add-on with no price in the chosen rhythm is shown as unavailable

🟢 Rather than as a button the server will refuse.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - the prices a store is shown
        - are resolved for the plan, in both rhythms
        - carry an override the public catalogue cannot know about
        - a bundle sold in one rhythm only says so for the other
        - an id nobody knows is left out rather than answered with nulls
        - asking for nothing costs nothing
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - a tenant books a bundle
        - on a running plan it gets a window on the plan’s day
        - during a trial it is booked, and waits for a window rather than inventing one
        - a plan that has no price for it refuses the booking outright
        - …while a plan the override does not touch books it happily

<!-- END proof -->

### SC-BUN-008 — An add-on carries no commitment unless an operator configures one

🟢 The default is none. A twelve-month commitment nobody asked for is a different product, and it
made "cancellable to the next period end" impossible for eleven of those months.

_Source:_ #239

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-add-on-comes-out-at-its-period-end.test.js`
    - a commitment an operator did configure
        - binds inside it, and still cannot outlast the plan
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — addBundleToSubscription
        - a booking commits the tenant to nothing unless somebody says so
        - an operator who wants a commitment still gets one
        - minimumTermMonths=0 → null (no minimum term)
        - plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan
        - plan compatibility: empty planIds array = all plans allowed
        - idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED
        - draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED
        - custom defaultMinimumTermMonths from the config token takes effect
- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - what a bundle may commit to
        - never past the parent, when the parent ends first
        - and its own term when that ends first
        - and no term at all where the caller asked for none
        - and the full term where nothing ends the parent

<!-- END proof -->

### SC-BUN-009 — An add-on can be cancelled at any time and ends with the period it is in

🟢 Up to the moment its next period begins. The premise behind it is that no money is ever paid back:
the tenant pays for the period they are in, it ends normally, and no refund arises.

_Source:_ #239 · #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - cancelling one, against its own period
        - a monthly booking ends with its month, not with the plan’s year
        - a booking from before the columns existed still ends with the plan
        - a minimum term still outranks the period when it runs longer
        - and the parent’s end still caps both
- `packages/nest/tests/an-add-on-comes-out-at-its-period-end.test.js`
    - a monthly add-on beside a yearly plan
        - commits to nothing and runs to the plan’s billing day
        - cancelling lands at the end of the period it is in
        - cancelling on the last day of the period still lands on that day
    - a yearly add-on beside a yearly plan
        - commits to nothing and ends with the plan period that pays for it
        - cancelling lands at that same end, not a year after the booking
- `packages/nest/tests/an-add-on-has-no-notice-period.test.js`
    - cancelling an add-on
        - on the last day of the period still ends with that period
        - on the first day of the period ends with the same period
        - a minimum term still binds, because that is what was committed to
        - and the plan ending first caps it, because the add-on cannot outlive it
        - a booking with no period of its own ends when it was declared
- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewCancel
        - effectiveAt = period end when minimum term expired
        - minimum term binds beyond period end → effectiveAt + warning
        - already canceled → blocker
        - foreign subscription → NotFound (no cross-tenant leak)
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — cancelBundleFromSubscription
        - canceledEffectiveAt = currentPeriodEnd when the minimum term has already elapsed
        - canceledEffectiveAt = minimumTermEndsAt when the minimum term is longer than the period
        - second cancellation → 422 SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED
        - unknown ID → 404

<!-- END proof -->

### SC-BUN-010 — The period an add-on ends at is its own, not the plan's

🟢 For a monthly add-on beside a yearly plan those are up to eleven months apart, and reading the
plan's boundary kept a cancelled booking committed and billed until the annual renewal.

_Source:_ #222 · release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - cancelling one, against its own period
        - a monthly booking ends with its month, not with the plan’s year
        - a booking from before the columns existed still ends with the plan
        - a minimum term still outranks the period when it runs longer
        - and the parent’s end still caps both
- `packages/nest/tests/an-add-on-comes-out-at-its-period-end.test.js`
    - a monthly add-on beside a yearly plan
        - commits to nothing and runs to the plan’s billing day
        - cancelling lands at the end of the period it is in
        - cancelling on the last day of the period still lands on that day
- `packages/nest/tests/subscription-bundle-preview.test.js`
    - a bundle billed in its own rhythm
        - a monthly bundle on a yearly plan is quoted monthly, over its own month
        - without a cycle it still quotes the plan’s
        - a yearly bundle beside a monthly plan is refused, not quoted
        - a bundle with no price in the asked rhythm is refused, not given away
        - the preview names the day the plan takes the bundle down with it
        - a plan that runs on names no end at all
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — cancelBundleFromSubscription
        - canceledEffectiveAt = currentPeriodEnd when the minimum term has already elapsed
        - canceledEffectiveAt = minimumTermEndsAt when the minimum term is longer than the period
        - second cancellation → 422 SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED
        - unknown ID → 404

<!-- END proof -->

### SC-BUN-011 — An add-on has no notice period

🟢 Cancelling one takes effect at the end of its own period, or at the end of its commitment where
that runs longer, or at the plan's end where that comes first — whenever it is declared, including
on the last day. An add-on hangs off the plan that pays for it, its commitment is the minimum
term, and a second waiting period on top is one nobody could explain to a customer.

_Source:_ #230 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-add-on-has-no-notice-period.test.js`
    - the bundle path does not consult a notice period
        - no source file on that path names anything that carries one
        - the effective date is decided from the booking alone
    - cancelling an add-on
        - on the last day of the period still ends with that period
        - on the first day of the period ends with the same period
        - a minimum term still binds, because that is what was committed to
        - and the plan ending first caps it, because the add-on cannot outlive it
        - a booking with no period of its own ends when it was declared

<!-- END proof -->

### SC-BUN-012 — An add-on can never be committed past the subscription that pays for it

🟢 Its commitment is capped at the plan's end, read afresh when the cancellation is worked out — a
cap applied at booking cannot see a cancellation that had not happened yet.

_Source:_ #221 · #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-plan-change-cannot-strand-a-bundle.test.js`
    - a yearly add-on blocks the move to a monthly plan
    - the blocker names the date the add-on runs to, so the tenant can act
    - and says both in either language, not only in the English message
    - the German sentence carries no English cycle word
    - staying on the yearly cycle is not blocked
    - a monthly add-on does not block a monthly plan
    - an add-on with no rhythm of its own follows the plan and blocks nothing
    - no active bookings, nothing to block
    - a consumer without the bundle module is not blocked by bookings it cannot have
    - moving to a LONGER cycle with a monthly add-on is fine
    - the date falls back to the minimum term where no period is stored
- `packages/nest/tests/an-add-on-comes-out-at-its-period-end.test.js`
    - a commitment an operator did configure
        - binds inside it, and still cannot outlast the plan
- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - what a bundle may commit to
        - never past the parent, when the parent ends first
        - and its own term when that ends first
        - and no term at all where the caller asked for none
        - and the full term where nothing ends the parent

<!-- END proof -->

### SC-BUN-013 — A commitment of none stays none

🟢 Capping an uncommitted booking at the plan's end would invent a commitment: the booking could then
not be cancelled until the plan ended, which is the opposite of what "no commitment" is for.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — addBundleToSubscription
        - a booking commits the tenant to nothing unless somebody says so
        - an operator who wants a commitment still gets one
        - minimumTermMonths=0 → null (no minimum term)
        - plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan
        - plan compatibility: empty planIds array = all plans allowed
        - idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED
        - draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED
        - custom defaultMinimumTermMonths from the config token takes effect
- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - what a bundle may commit to
        - never past the parent, when the parent ends first
        - and its own term when that ends first
        - and no term at all where the caller asked for none
        - and the full term where nothing ends the parent

<!-- END proof -->

### SC-BUN-014 — A tenant who has already cancelled may still book an add-on for the time left

🟢 The commitment is shortened rather than the purchase refused. An add-on is priced per period
rather than per commitment, so a shorter one cannot overcharge them.

_Source:_ #221 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - while the subscription is running
        - a bundle can be booked, priced and reactivated
        - and a cancellation still to come does not close it either
        - and cancelling a bundle still re-freezes, carrying the ending

<!-- END proof -->

### SC-BUN-015 — Ending with the plan is not a cancellation

🟢 No notice is given and none is needed, and the period the add-on is in when the plan ends is not
refunded. The alignment exists so that day is a period boundary in the first place.

_Source:_ #222

### SC-BUN-016 — A tenant reads what a booking commits to before confirming it

🟢 When the first period ends, when the plan it hangs on ends, and plainly that a shortened booking
is not refunded. The no-refund rule is fair only if it is read before the decision rather than
discovered after it, and it is stated as a plain sentence rather than a warning, because it holds
for every booking and a warning that always fires teaches people to skip warnings.

_Source:_ #222

<!-- BEGIN proof -->

_Tested by:_

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
- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - what the dialog promises before the booking
        - states the capped term, not the uncapped one
        - and the full term where nothing ends the parent

<!-- END proof -->

### SC-BUN-017 — An add-on without a price cannot be published

🟢 For every plan the add-on is offered to, a price has to resolve in that plan's rhythm — from the
add-on's own price or from an override set for that plan. A published add-on with no price was
bookable and handed over its features for nothing, and nobody downstream could tell that from a
deliberately free one. Catching it at publication puts the mistake at the operator's desk rather
than at a tenant's checkout.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - a bundle nobody can be charged for is not booked
        - a rhythm the bundle has no price in is refused
        - the rhythm it does have a price in goes through
        - a plan override that resolves nothing is refused as well
        - an override that resolves a price for one plan books for that plan
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - an operator publishes a bundle
        - a base price is enough
        - a price only for one plan is enough — that plan can buy it
        - no price anywhere is refused, and the message says why
        - an explicit zero is refused as a zero, not as a missing price
        - a bundle a compatible plan could not buy is refused, naming plan and cycle
        - …and the same bundle restricted to a monthly-only plan publishes
        - a plan override adds the cycle the base price is missing
        - …and an override that nulls a cycle takes that plan’s price away
        - without a plan repository the catalogue cannot be derived, so nothing is claimed
        - an override that removes the price for one plan still publishes

<!-- END proof -->

### SC-BUN-018 — A yearly price is never derived from a monthly one

🟢 💰 Multiplying by twelve invents a price nobody set. If a yearly price were always twelve monthly
ones, there would be no reason to have two figures.

_Source:_ #222

### SC-BUN-019 — What an add-on costs depends on the plan beside it and the rhythm it is billed in

🟢 💰 Not on the add-on alone. An operator may price the same add-on differently for one plan, or give
it its only price there.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - the price a booking is billed at
        - follows the rhythm the booking was made in
        - a monthly booking beside a yearly plan is billed monthly
        - a booking from before the rhythm was recorded takes the plan’s
        - a plan-specific override is what the tenant on that plan is billed
        - a booking whose version has vanished reports no price rather than a wrong one
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - an operator publishes a bundle
        - a base price is enough
        - a price only for one plan is enough — that plan can buy it
        - no price anywhere is refused, and the message says why
        - an explicit zero is refused as a zero, not as a missing price
        - a bundle a compatible plan could not buy is refused, naming plan and cycle
        - …and the same bundle restricted to a monthly-only plan publishes
        - a plan override adds the cycle the base price is missing
        - …and an override that nulls a cycle takes that plan’s price away
        - without a plan repository the catalogue cannot be derived, so nothing is claimed
        - an override that removes the price for one plan still publishes

<!-- END proof -->

### SC-BUN-020 — An add-on whose contents a tenant already has raises a warning, not a refusal

🟢 Whether the overlap comes from the plan or from another booking, the tenant is told they would pay
twice. Where a selection is fully covered by what is already chosen, it is dropped from the price
and from the booking rather than sold.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

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

### SC-BUN-021 — An add-on whose own dependencies nothing covers cannot be booked

🟢 If it needs a feature that neither the plan nor another active booking supplies, it would not
work.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

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

### SC-BUN-022 — An add-on cannot be booked on a subscription that has already ended

🟢 It would be charged, listed and inert. Reading and cancelling stay open, so somebody whose
subscription has ended can still see what they booked and explain their invoices; what closes is
the till.

_Source:_ #218 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - once the subscription has ended
        - a bundle cannot be booked
        - nor priced
        - nor reactivated, which is buying it again
        - while pricing a cancellation stays open, because that is tidying up
        - but what was booked can still be read
        - and still cancelled
        - without writing a contract that begins after it ended

<!-- END proof -->

### SC-BUN-023 — Only a published, current version of an add-on can be booked

🟢 A draft, a superseded version and one whose validity has not started are not on offer.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - which bundles a tenant may ask the price of
        - a draft is not priced, because it was never on offer
        - a superseded version is not priced either
        - a live version among dead ones still answers
    - a bundle the operator retired
        - is not priced, though its version is still live
- `packages/nest/tests/bundles-service.test.js`
    - BundlesService — Version lifecycle
        - createBundleDraft creates v1 with baseVersionId=null
        - createBundleDraft throws 422 if a draft already exists
        - updateBundleDraft throws 422 on published version
        - publishBundleVersion classifies diff (feature added = IMPROVEMENT)
        - publishBundleVersion blocks regressive version without forceRegressive
        - publishBundleVersion lets regressive version through with forceRegressive
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — addBundleToSubscription
        - a booking commits the tenant to nothing unless somebody says so
        - an operator who wants a commitment still gets one
        - minimumTermMonths=0 → null (no minimum term)
        - plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan
        - plan compatibility: empty planIds array = all plans allowed
        - idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED
        - draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED
        - custom defaultMinimumTermMonths from the config token takes effect

<!-- END proof -->

### SC-BUN-024 — An add-on version somebody has already booked cannot be edited

🟢 Same reason as for a plan version: what was sold does not change underneath the customer.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - a bundle the operator retired
        - is not priced, though its version is still live
- `packages/nest/tests/bundles-service.test.js`
    - BundlesService — Version lifecycle
        - createBundleDraft creates v1 with baseVersionId=null
        - createBundleDraft throws 422 if a draft already exists
        - updateBundleDraft throws 422 on published version
        - publishBundleVersion classifies diff (feature added = IMPROVEMENT)
        - publishBundleVersion blocks regressive version without forceRegressive
        - publishBundleVersion lets regressive version through with forceRegressive
    - BundlesService — Editability annotation (Pack 2c)
        - listBundleVersions sets isLatestInChain on the highest version
        - publishBundleVersion: without validFrom → 422 BUNDLE_VERSION_VALID_FROM_REQUIRED
        - publishBundleVersion: second version sets previous to supersededAt + auto-succession
          validUntil
        - publishBundleVersion: validFrom must be strictly after predecessor → 422
        - updateBundleDraft allows published-but-future BundleVersion (latest, 0 subs)
        - updateBundleDraft blocks published-but-future validFrom in the past
        - updateBundleDraft blocks validFrom before the predecessor version
        - updateBundleDraft blocks validUntil before validFrom
        - updateBundleDraft blocks published-but-future BundleVersion with subscription
        - discardBundleDraft removes draft + throws on published
        - updateBundleDraft blocks published version that is not latest-in-chain

<!-- END proof -->

### SC-BUN-025 — An add-on may be restricted to particular plans

🟢 Where no restriction is stated, every plan may book it.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - an operator publishes a bundle
        - a base price is enough
        - a price only for one plan is enough — that plan can buy it
        - no price anywhere is refused, and the message says why
        - an explicit zero is refused as a zero, not as a missing price
        - a bundle a compatible plan could not buy is refused, naming plan and cycle
        - …and the same bundle restricted to a monthly-only plan publishes
        - a plan override adds the cycle the base price is missing
        - …and an override that nulls a cycle takes that plan’s price away
        - without a plan repository the catalogue cannot be derived, so nothing is claimed
        - an override that removes the price for one plan still publishes
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — addBundleToSubscription
        - a booking commits the tenant to nothing unless somebody says so
        - an operator who wants a commitment still gets one
        - minimumTermMonths=0 → null (no minimum term)
        - plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan
        - plan compatibility: empty planIds array = all plans allowed
        - idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED
        - draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED
        - custom defaultMinimumTermMonths from the config token takes effect

<!-- END proof -->

### SC-BUN-026 — An add-on that is not sold self-service says so and says who to ask

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

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
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — Self-Service-Policy (#37)
        - sales-only bundle throws 422 BUNDLE_NOT_SELF_SERVICE
        - without a policy the bundle stays bookable

<!-- END proof -->

### SC-BUN-027 — The same add-on cannot be booked twice on one subscription

🟢 Not while the first booking is still running.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — addBundleToSubscription
        - a booking commits the tenant to nothing unless somebody says so
        - an operator who wants a commitment still gets one
        - minimumTermMonths=0 → null (no minimum term)
        - plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan
        - plan compatibility: empty planIds array = all plans allowed
        - idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED
        - draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED
        - custom defaultMinimumTermMonths from the config token takes effect

<!-- END proof -->

### SC-BUN-028 — A cancelled booking can be reinstated only before its cancellation takes effect

🟢 Afterwards it is booked again rather than revived.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewCancel
        - effectiveAt = period end when minimum term expired
        - minimum term binds beyond period end → effectiveAt + warning
        - already canceled → blocker
        - foreign subscription → NotFound (no cross-tenant leak)
- `packages/nest/tests/subscription-bundles-service.test.js`
    - SubscriptionBundlesService — cancelBundleFromSubscription
        - canceledEffectiveAt = currentPeriodEnd when the minimum term has already elapsed
        - canceledEffectiveAt = minimumTermEndsAt when the minimum term is longer than the period
        - second cancellation → 422 SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED
        - unknown ID → 404
- `packages/nest/tests/the-till-closes-with-the-subscription.test.js`
    - once the subscription has ended
        - a bundle cannot be booked
        - nor priced
        - nor reactivated, which is buying it again
        - while pricing a cancellation stays open, because that is tidying up
        - but what was booked can still be read
        - and still cancelled
        - without writing a contract that begins after it ended

<!-- END proof -->

### SC-BUN-029 — A move to a shorter plan rhythm is refused while a longer add-on is running

🟢 The tenant cancels the add-on first, and the change then goes through. It is refused rather than
converted or ended: ending it early owes the customer the difference, and converting it invents a
price nobody agreed to. The refusal is judged as of the day the change would land, so following
the advice actually works.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - which cycles a bundle may be sold on
        - every combination, not three of the four
        - ${bundle} bundle on a ${plan} plan is ${allowed ?
- `packages/nest/tests/a-plan-change-cannot-strand-a-bundle.test.js`
    - a yearly add-on blocks the move to a monthly plan
    - the blocker names the date the add-on runs to, so the tenant can act
    - and says both in either language, not only in the English message
    - the German sentence carries no English cycle word
    - staying on the yearly cycle is not blocked
    - a monthly add-on does not block a monthly plan
    - an add-on with no rhythm of its own follows the plan and blocks nothing
    - no active bookings, nothing to block
    - a consumer without the bundle module is not blocked by bookings it cannot have
    - moving to a LONGER cycle with a monthly add-on is fine
    - the date falls back to the minimum term where no period is stored

<!-- END proof -->

### SC-BUN-030 — An add-on price of exactly zero has to be meant

🟢 💰 A deliberately free add-on leaves its price unset. An explicit zero is refused unless the
operator says it is intended, for the same reason it is on a plan.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/catalog-publish-controller.test.js`
    - PlanVersions.publish passes allowZeroPrice through to the service (#63)
    - PlanVersions.publish: allowZeroPrice stays undefined without the DTO flag
    - BundleVersions.publish passes allowZeroPrice through to the service (#63)
    - BundleVersions.publish: allowZeroPrice stays undefined without the DTO flag
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - an operator publishes a bundle
        - a base price is enough
        - a price only for one plan is enough — that plan can buy it
        - no price anywhere is refused, and the message says why
        - an explicit zero is refused as a zero, not as a missing price
        - a bundle a compatible plan could not buy is refused, naming plan and cycle
        - …and the same bundle restricted to a monthly-only plan publishes
        - a plan override adds the cycle the base price is missing
        - …and an override that nulls a cycle takes that plan’s price away
        - without a plan repository the catalogue cannot be derived, so nothing is claimed
        - an override that removes the price for one plan still publishes

<!-- END proof -->

### SC-BUN-031 — An add-on booked against a plan that has no period yet gets no invented one

🟢 During a trial, or while an enterprise deal is still with sales, there is nothing to align to. The
booking is left without a period and without a commitment rather than being given a made-up one,
and it joins the plan's rhythm once the plan has a paid period. Both ends of a period are written
together or neither: a half-stated period is a state no reader can interpret.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - a plan with no period at all
        - gives the bundle no period either, rather than an invented one
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - a tenant books a bundle
        - on a running plan it gets a window on the plan’s day
        - during a trial it is booked, and waits for a window rather than inventing one
        - a plan that has no price for it refuses the booking outright
        - …while a plan the override does not touch books it happily

<!-- END proof -->

### SC-BUN-032 — An add-on's key never changes

🟢 Renaming one means creating a new add-on and retiring the old one, because customers are bound to
the old key.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/bundles-service.test.js`
    - BundlesService — Master operations
        - createBundle creates a new bundle master record
        - createBundle throws 422 on a duplicate bundleKey
        - updateBundle changes label, leaves bundleKey untouched
        - softDeleteBundle is idempotent
        - listBundles filters out soft-deleted
- `packages/nest/tests/every-way-a-tenant-meets-a-bundle.test.js`
    - a key an operator has retired
        - creating the same key again is refused, with the code that says why
        - a key nobody used is still free

<!-- END proof -->

### SC-BUN-033 — An add-on bought after a contract was agreed takes effect immediately

🟢 It used to grant nothing until something re-froze the contract, and where the optional hook was
not configured that never happened — silently.

_Source:_ release 0.14.0
