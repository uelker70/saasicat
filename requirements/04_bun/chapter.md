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

🟢 The alignment is made when the add-on is booked rather than repaired when the plan ends, because
a period that has to be trimmed is one somebody was committed to more of than they received — and
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
- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - an add-on is charged its short first period, then whole ones
        - the first period for exactly that stretch of a whole month, the next in full
        - an add-on no contract names yet is not charged, and is once one does
        - a cancelled add-on is not charged from its effective date on
- `packages/nest/tests/tenant-subscription-bundles-refreeze.test.js`
    - an add-on booking brings the account up to date
        - after the contract takes the booking in
        - a journal that fails does not undo the booking
        - a cancellation charges nothing new

<!-- END proof -->

### SC-BUN-004 — A tenant on a monthly plan cannot book a yearly add-on

🟢 The plan would end twelve times before the add-on's first period did, and each of those is a
moment the tenant could be left committed to something that grants nothing.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-booking-fits-every-plan-ahead.test.js`
    - the preview of such a booking
        - names every reason an add-on cannot run beside the plan of today, at once
- `packages/nest/tests/a-bundle-runs-in-step-with-its-plan.test.js`
    - which cycles a bundle may be sold on
        - every combination, not three of the four
        - ${bundle} bundle on a ${plan} plan is ${allowed ? 'allowed' : 'refused'}

<!-- END proof -->

### SC-BUN-005 — A tenant on a yearly plan chooses the rhythm each add-on is billed in

🟢 Preselected to the plan's own rhythm, so a tenant who does nothing gets what they would have got
before. On a monthly plan no control appears: a question with one answer is not a question.

_Source:_ #234

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-bundle-booking-row-becomes-a-record.test.js`
    - a bundle booking row becomes a record
        - every column is carried over as it is
        - both rhythms are read
        - a booking made before the billing columns existed reads as null throughout
        - a schema without the billing columns reads the same as one holding nulls
        - a rhythm of '${value}' stops the read, naming the row
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
- `packages/ui-vue/tests/use-tenant-subscription-bundles.test.js`
    - useTenantSubscriptionBundles
        - the endpoint is required — there is no prefix the platform could guess
        - load() maps the wire dates on a record onto Dates
        - the booking’s own period arrives as dates, not as wire strings
        - a booking with no period of its own keeps null, not the epoch
        - a nullable date that is set is mapped too
        - load() keeps the list usable and reports the failure on `error`
        - a 204 to load() is an empty list, not a failure
        - add() prepends the new bundle and sends the token
        - without a token no Authorization header is invented
        - cancel() replaces the row it cancelled
        - switchToReplacement() posts the version shown to the booking’s switch, then reloads
        - a mutation the server answered without a body says the change may have landed
        - a mutation that failed outright is not that — it says check the status
        - autoLoad fetches without being asked
- `packages/ui-vue-tenant/tests/component/a-bundle-is-bought-in-a-rhythm.test.ts`
    - a monthly plan offers no choice
        - no control appears, because there is one legal answer
        - the card quotes the monthly price with the monthly unit
        - buying sends the rhythm rather than leaving it to be guessed
    - a yearly plan offers both
        - the control appears, preselected to the plan — nobody is repriced by an upgrade
        - switching moves the price and the unit together
        - buying sends what was chosen, not what the plan is
    - a bundle that is not sold in the chosen rhythm
        - is not offered, and says why instead of showing a price
        - becomes bookable again when the other rhythm is chosen
        - keeps the reason that actually explains it when it is already booked
    - a plan whose rhythm changes underneath the section
        - an untouched control follows the plan when it turns yearly
        - a rhythm the tenant chose survives a plan change that still offers it
        - a choice the plan took away does not come back as a choice
        - drops a selection the plan no longer offers
    - what a booked bundle says it costs
        - a yearly booking states the yearly charge, not a monthly figure
        - a monthly booking beside a yearly plan reads as monthly
        - a price only an override supplies is shown, though no catalogue price exists
        - a booking from before the rhythm was recorded takes the plan's
        - a price the server did not send is joined from the catalogue in the booking's rhythm
        - a price the server resolved to nothing is shown as nothing

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
- `packages/ui-vue/tests/use-tenant-billing-catalog.test.js`
    - useTenantBillingCatalog
        - load() reads all three endpoints under the default prefix
        - a trailing slash in the prefix does not become a double slash
        - the wire form of a bundle becomes the shape the page renders
        - the optional wire fields default rather than arriving as undefined
        - a missing /bundles endpoint is not fatal — the plan page still renders
        - a failing /plans clears what it could not load
        - a client that resolves with status 0 fails the load rather than emptying it
        - a client that rejects is reported, not swallowed
        - it loads on its own unless the consumer says otherwise

<!-- END proof -->

### SC-BUN-008 — An add-on carries no commitment unless an operator configures one

🟢 The default is none. A twelve-month commitment nobody asked for is a different product, and it
made "cancellable to the next period end" impossible for eleven of those months.

_Source:_ #239

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/bundle-defaults-are-decided-once.test.js`
    - what a new draft starts from
        - an omitted quota map is empty, not absent
        - an omitted price is null, not zero
        - an unstated bundle is marketed
        - …and an explicit false stays false
        - an omitted change note is empty, and lineage is null
        - everything given is passed through untouched
        - it says nothing about validity windows
    - what a new bundle stem starts from
        - an omitted description or icon is null, not an empty string
        - an unstated sort order is zero, and an explicit zero survives
        - an omitted translation map is empty
        - the identity fields are carried straight over
    - reading a stored stem back
        - dates become ISO strings, because that is what the row type says
        - a retired stem carries its date rather than a flag
        - an i18n map is passed through
        - anything that is not a map becomes one
    - the fields a caller actually gave
        - an omitted field is not in the patch at all
        - an explicit null is kept, because somebody chose it
        - falsy values are values
        - a key that was not asked for is not in the patch
        - an empty patch is empty, not undefined
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
        - a retirement told for the booking lets it go at the period end, with no term to warn of
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
    - moving to a shorter cycle with a longer add-on booked
        - a yearly add-on blocks the move to a monthly plan
        - the blocker names the add-on and the date it runs to, so the tenant can act
        - and says both in either language, not only in the English message
        - the German sentence carries no English cycle word
        - staying on the yearly cycle is not blocked
        - a monthly add-on does not block a monthly plan
        - an add-on with no rhythm of its own follows the plan and blocks nothing
        - no active bookings, nothing to block
        - a consumer without the bundle module is not blocked by bookings it cannot have
        - moving to a LONGER cycle with a monthly add-on is fine
        - where no period is stored, the date is the plan's period end or a longer commitment
    - a plan change, and an add-on told it continues on another version
        - is refused where the version it continues on cannot run beside the target plan, naming
          that version
        - goes through where that version can run beside it
        - asks nothing of a booking that ends before its version would change
        - tells a booking under a minimum term to cancel, which the retirement lets it do
        - names the end of its period as well where the version it is on cannot run beside the plan
        - names the day it can end instead once the date has passed and the move is still to come
        - names the day a booking cancelled already ends, which cancelling again cannot move
        - asks nothing of a retirement told for a version the booking is no longer on
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

- `packages/core/tests/bundle-defaults-are-decided-once.test.js`
    - what a new draft starts from
        - an omitted quota map is empty, not absent
        - an omitted price is null, not zero
        - an unstated bundle is marketed
        - …and an explicit false stays false
        - an omitted change note is empty, and lineage is null
        - everything given is passed through untouched
        - it says nothing about validity windows
    - what a new bundle stem starts from
        - an omitted description or icon is null, not an empty string
        - an unstated sort order is zero, and an explicit zero survives
        - an omitted translation map is empty
        - the identity fields are carried straight over
    - reading a stored stem back
        - dates become ISO strings, because that is what the row type says
        - a retired stem carries its date rather than a flag
        - an i18n map is passed through
        - anything that is not a map becomes one
    - the fields a caller actually gave
        - an omitted field is not in the patch at all
        - an explicit null is kept, because somebody chose it
        - falsy values are values
        - a key that was not asked for is not in the patch
        - an empty patch is empty, not undefined
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
- `packages/ui-vue-tenant/tests/component/a-booking-states-what-it-commits-to.test.ts`
    - the first period is named before it is agreed to
        - the date the first period runs to is on the screen
        - a booking with no period to align to says nothing rather than nothing-as-a-date
    - ending with the plan is stated, not left to be discovered
        - a plan that is already ending names the day
        - a plan that runs on shows no end date
        - the no-refund rule holds whether or not the plan is ending
        - a cancellation preview does not repeat the booking terms
    - a reason the booking cannot be made reads in the chosen language
        - each of two reasons with one code, with its own values
        - and read again in another order, each still keeps its own
    - a reason against the plan of today reads as a sentence, not as data
        - naming the plan rather than the version, and the rhythm in words of its own

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

🔵 _(Superseded on 2026-10-01 by `SC-BUN-035`.)_ A draft, a superseded version and one whose validity
has not started are not on offer.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-024 — An add-on version somebody has already booked cannot be edited

🟢 Same reason as for a plan version: what was sold does not change underneath the customer.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/a-bundle-version-has-a-window.integration.test.js`
    - two versions inside the same moment
        - the one whose window opened later wins
        - a version with no window at all loses to one that has a window it is inside
        - a closed window is excluded even when it is the later one
        - a superseded version without a last day does not come back when its successor closes
    - the edges of one window
        - a version is active throughout its last day, and not the next
        - a version is not active before its window opens
        - a bundle with no published version at all answers null, not an error
    - a version read back
        - carries the window it has stored
- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - a bundle the operator retired
        - is not priced, though its version is still live
- `packages/nest/tests/an-operator-counts-past-the-tenant-policy.test.js`
    - an add-on version tenants have booked, behind a tenant policy
        - stays locked against editing
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

- `packages/core/tests/bundle-availability.test.js`
    - missingRequiresFor
        - returns uncovered requires sorted + deduplicated
        - empty when all requires are covered
        - empty when the bundle has no requires
    - resolveBundleAvailability
        - bookable when requires covered and features are new
        - missing-requires grays out bundle on uncovered prerequisite
        - covered when all bundle features are already covered (already included)
        - covered beats missing-requires (fully covered bundle never bookable)
        - partial coverage stays bookable (not covered)
        - bundle without features is never covered
    - coverageExcludingSelf
        - plan ∪ features of the other selected bundles, without the bundle itself
        - excludes own features (otherwise every bundle would be trivially covered)
    - isBundleRedundant
        - Y is redundant when C is already covered by Z
        - Z is not redundant — D is not covered elsewhere
        - redundant when the plan already contains the features
        - single selected bundle is not redundant (self-exclusion)
    - selectChargeableBundles
        - mutual coverage Y={C},Z={C} → exactly ONE bundle remains (deterministically Z)
        - input order irrelevant — sorting determines the kept one (z remains)
        - sortOrder controls which bundle is kept
        - 3-cycle of identical bundles → exactly ONE remains
        - chain of proper subsets X⊂Y⊂Z → only the superset Z remains
        - asymmetric Y={C} ⊂ Z={C,D} → Y discarded, Z kept (regression)
        - bundles covered by the plan are discarded
        - disjoint bundles are all kept
        - empty selection → empty result
        - does not mutate the input
- `packages/nest/tests/a-booking-fits-every-plan-ahead.test.js`
    - reinstating a cancelled booking, which books it again
        - is refused where the plan of today cannot carry it
    - the preview of such a booking
        - names every reason an add-on cannot run beside the plan of today, at once
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
- `packages/nest/tests/tenant-subscription-bundles-plan-compat.test.js`
    - add passes the plan KEY (sub.plan) as currentPlanKey, not the planVersion UUID
    - preview passes the plan KEY (sub.plan) as currentPlanKey, not the planVersion UUID

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

- `packages/adapter-drizzle/tests/integration/a-booking-outlives-the-request.integration.test.js`
    - what a booking carries
        - a booking with a window keeps every part of it
        - a booking from before those columns keeps null, not an invented window
        - an id nobody booked answers null rather than throwing
        - the list is the subscription’s own, not the neighbour’s
        - a subscription with no bookings lists nothing, rather than everything
    - what counts as active
        - a booking nobody cancelled is active
        - a cancellation still ahead leaves it active
        - a cancellation that has landed ends it
        - the effective date itself is the first moment it is over
        - asking without a moment asks about now
    - undoing a cancellation
        - reactivating clears both dates and the booking is active again
        - cancelling something that is not there says so, rather than doing nothing quietly
        - reactivating something that is not there says so too
    - counting what a catalogue version still owes
        - active bookings of that version are counted, across subscriptions
        - a different version is not counted
        - a booking whose cancellation has landed is not counted
        - a version nobody booked counts zero
- `packages/adapter-prisma/tests/prisma-bundle.repository.test.js`
    - PrismaBundleRepository validity windows
        - validity dates round-trip on create and update
        - the version on sale is resolved with inclusive days and deterministic priority
        - a superseded version without a last day does not come back when its successor closes
        - publishing is internally atomic and applies auto-succession
        - publishing refuses a version somebody else published first
        - publishing reuses a caller transaction instead of nesting one
- `packages/nest/tests/an-add-on-is-booked-once.test.js`
    - a tenant booking an add-on
        - is refused a newer version while a booking of an older one runs
        - is refused it while the older booking is cancelled but has not ended
        - books it once the older booking has ended
        - books a different add-on beside it
    - the preview of that booking
        - says what the booking would say
        - has no word against a different add-on
- `packages/nest/tests/an-offer-is-priced-from-the-catalogue.test.js`
    - where each amount comes from
        - two different add-ons, each at its own price
    - what cannot be priced is refused, not priced at nothing
        - the same add-on twice, in two of its versions
- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService
        - consume refuses an offer naming two versions of one add-on, for that reason
- `packages/nest/tests/subscription-bundle-repo.test.js`
    - SubscriptionBundleRepository — lifecycle
        - add + listBySubscription returns the new booking
        - listActiveBySubscription filters canceled bookings with a past effective date
        - cancel: second call throws
        - countActiveByBundleVersionId counts only non-canceled (or future-effective) bookings
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
- `packages/ui-vue-tenant/tests/component/a-held-add-on-is-not-offered-again.test.ts`
    - the store, while a version of an add-on is held
        - says a newer version of it is booked, and offers no button
        - still says so while the booking is cancelled for a day to come
        - offers it again once the cancellation has taken effect
        - offers a different add-on beside it
        - knows the add-on of a booking whose key the server did not send, from the catalogue

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
        - a retirement told for the booking lets it go at the period end, with no term to warn of
        - already canceled → blocker
        - foreign subscription → NotFound (no cross-tenant leak)
- `packages/nest/tests/subscription-bundle-repo.test.js`
    - SubscriptionBundleRepository — lifecycle
        - add + listBySubscription returns the new booking
        - listActiveBySubscription filters canceled bookings with a past effective date
        - cancel: second call throws
        - countActiveByBundleVersionId counts only non-canceled (or future-effective) bookings
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
        - ${bundle} bundle on a ${plan} plan is ${allowed ? 'allowed' : 'refused'}
- `packages/nest/tests/a-plan-change-cannot-strand-a-bundle.test.js`
    - moving to a shorter cycle with a longer add-on booked
        - a yearly add-on blocks the move to a monthly plan
        - the blocker names the add-on and the date it runs to, so the tenant can act
        - and says both in either language, not only in the English message
        - the German sentence carries no English cycle word
        - staying on the yearly cycle is not blocked
        - a monthly add-on does not block a monthly plan
        - an add-on with no rhythm of its own follows the plan and blocks nothing
        - no active bookings, nothing to block
        - a consumer without the bundle module is not blocked by bookings it cannot have
        - moving to a LONGER cycle with a monthly add-on is fine
        - where no period is stored, the date is the plan's period end or a longer commitment
    - a plan change, and an add-on told it continues on another version
        - is refused where the version it continues on cannot run beside the target plan, naming
          that version
        - goes through where that version can run beside it
        - asks nothing of a booking that ends before its version would change
        - tells a booking under a minimum term to cancel, which the retirement lets it do
        - names the end of its period as well where the version it is on cannot run beside the plan
        - names the day it can end instead once the date has passed and the move is still to come
        - names the day a booking cancelled already ends, which cancelling again cannot move
        - asks nothing of a retirement told for a version the booking is no longer on
- `packages/nest/tests/tenant-subscription-bundles-plan-compat.test.js`
    - add passes the plan KEY (sub.plan) as currentPlanKey, not the planVersion UUID
    - preview passes the plan KEY (sub.plan) as currentPlanKey, not the planVersion UUID
- `packages/nest/tests/the-plan-preview-sees-the-bookings.test.js`
    - the plan-change rule reaches the bookings in a real container
        - a yearly add-on blocks a move to monthly when the module is composed normally
        - it asks as of the day the change lands, not today
        - nothing booked, nothing blocked

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

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/entitlement-service.test.js`
    - EntitlementService — bundles booked after the contract was signed
        - adds features and quotas of a bundle missing from the contract
        - does not count a bundle already frozen into the contract twice
        - skips a bundle already covered by a contract line item
        - does not grant a plannedOnly feature from a later bundle
        - ignores a booking that is already canceled

<!-- END proof -->

### SC-BUN-034 — A cancelled add-on ends on its effective date, whatever contract is in force

🟢 Its features and quotas: until that date the add-on grants what it granted before, counted once;
from that date it grants nothing, and nobody has to write the contract again for that. A contract
written while the cancellation is declared keeps the add-on's line, because the add-on is billed
until then, and leaves it out of the entitlements the contract records.

Where this stops: it relies on the contract being written again when an add-on is cancelled, which
the platform does where `contractFreeze` is configured. An installation that concludes contracts
without it keeps the add-on in whatever entitlements its contract recorded.

_Source:_ #318

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancelled-add-on-ends-on-its-date.test.js`
    - an add-on cancelled under a contract
        - grants what it granted until its effective date, counted once
        - still grants it a moment before the date
        - grants nothing of it from the date on, with no write in between
        - the contract written on cancelling keeps its line and leaves it out of the entitlements
        - an add-on beside it that is not cancelled runs on
        - reinstated before its date, it runs on past it
    - a contract that recorded the add-on in its own entitlements
        - keeps counting a cancelled add-on once
        - a contract frozen beside it leaves the add-on out, and names it
    - a remembered answer and a cancelled add-on
        - an answer computed before the date is not served on it

<!-- END proof -->

### SC-BUN-035 — An add-on is on sale by its dates, in the catalogue and at booking alike

🟢 💰 Which version of an add-on is on sale is decided by its dates, as for a plan (`SC-PLAN-027`):
published, begun, not past its last day, and — once superseded — only within a last day it carries.
A draft, a version whose start is still to come and one whose successor has taken over are not on
offer, and a predecessor stays on offer until the day its successor starts. The public catalogue,
the upsell, the add-on preview, checkout and a booking all read it the same way, so the add-on a
tenant is shown is the one they can book. The dates always apply: no setting leaves them out.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-price-belongs-to-a-plan-and-a-rhythm.test.js`
    - which bundles a tenant may ask the price of
        - a draft is not priced, because it was never on offer
        - a version whose successor has taken over is not priced either
        - a live version among dead ones still answers
- `packages/nest/tests/an-add-on-is-on-sale-by-its-dates.test.js`
    - a tenant booking an add-on
        - takes the predecessor until its successor starts, though it is superseded
        - is refused a version whose start is still to come, and told when it starts
        - takes the successor from its first day
        - is refused the predecessor once its successor has taken over
        - is refused a version superseded without a last day
        - is refused a draft
    - the preview of an add-on booking
        - says what the booking would say: the successor is not on sale before June
        - and has no word against the superseded predecessor while its window is open
    - the public catalogue
        - shows the add-on version on sale at the moment it is read
    - the bundle list of the public catalogue
        - lists the add-on version on sale now, not the newest published
    - the upsell
        - offers the add-on version on sale now, not the newest published
- `packages/nest/tests/bundles-service.test.js`
    - BundlesService — Editability annotation (Pack 2c)
        - publishBundleVersion: second version sets previous to supersededAt + auto-succession
          validUntil
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

### SC-BUN-036 — A deleted add-on cannot be booked, whatever its versions' dates say

🟢 Deleting an add-on takes it out of the catalogue with every version, and leaves their dates as
they were, so a version can still be inside its window. A booking and its preview refuse it all the
same, and so does a checkout offer, both when it is made and when it is concluded.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-deleted-add-on-cannot-be-booked.test.js`
    - a tenant booking a version of an add-on
        - books it while the add-on is in the catalogue
        - is refused once the add-on is deleted, though the version is inside its window
        - is refused where the add-on cannot be read at all
    - the preview of that booking
        - says what the booking would say
- `packages/nest/tests/an-offer-is-priced-from-the-catalogue.test.js`
    - what cannot be priced is refused, not priced at nothing
        - an add-on that has been deleted, though its version is on sale
- `packages/nest/tests/checkout-offer-service.test.js`
    - CheckoutOfferService
        - consume blocks an add-on deleted after the offer was made

<!-- END proof -->

### SC-BUN-037 — An add-on cannot be booked where it cannot run on a plan the subscription moves to

🟢 💰 A booking is refused, and its preview says so, where the add-on cannot run on a plan the
subscription is already set to move to: the target of a change it scheduled, from the day that
change lands, and the replacement plan of a retirement it has been told of, from that date for as
long as the subscription is still on the version retired, whatever else is scheduled before it.
Reinstating a cancelled booking books it again: it is refused the same way, and where the add-on
cannot run on the plan of today. A subscription that ends no later than the move never makes it,
and books the add-on.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-booking-fits-every-plan-ahead.test.js`
    - a booking on a subscription set to move to another plan
        - is refused where the plan it moves to does not book the add-on
        - is refused where that plan has no price for it in its rhythm
        - is refused for a yearly add-on where the move is to the monthly rhythm
        - books an add-on the plan it moves to can carry
        - books it where the subscription ends on the day of the move, which then never lands
        - but not where the subscription ends a day after the move
    - reinstating a cancelled booking, which books it again
        - is refused where the plan it moves to cannot carry the add-on
        - is refused where the plan of today cannot carry it
        - reinstates one both plans can carry
    - the preview of such a booking
        - says what the booking would say
    - the plans a subscription is set to move to
        - are none where nothing is scheduled and no retirement was told
        - are the target of a scheduled change, in its rhythm, from the day it lands
        - are monthly where the change names no rhythm, as the change lands
        - are the replacement of a retirement told, from its date
        - carry the retirement in the rhythm billed at its date, not the one it was told in
        - keep a told retirement where a scheduled change would leave the version first
        - do not ask about a retirement for a subscription that has no id
- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - the retirements a subscription was told of
        - stay past their date, for as long as the subscription is on the version
        - are none while the notice has reached nobody
- `packages/nest/tests/the-plan-preview-sees-the-bookings.test.js`
    - a booking, and the plans the subscription moves to, in a real container
        - is refused where the plan a scheduled change moves to cannot carry the add-on
        - reinstating a cancelled one is refused against that plan too, and nothing changes

<!-- END proof -->

### SC-BUN-038 — An add-on version is retired only off sale, onto a version of the same add-on on sale

🟢 💰 Retiring an add-on version announces to the bookings on it that they continue on a
replacement: the add-on's version on sale, so each stays the same booking with its term. The
version retired has to be off sale, so nobody books it after the announcement. It rests on the same
terms as a plan version's retirement (`SC-SUB-025`): without them the administration does not offer
it and the server refuses it. A retirement that would reach no booking is refused too.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retirement-is-offered-where-it-is-wired.test.js`
    - retiring an add-on version is offered
        - where add-on announcements are kept and the terms are confirmed: routes and capability
        - while the terms are not confirmed: the routes, but no capability
        - not without ${without}, while plan versions still are
- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - what an add-on version may be retired onto
        - one off sale, onto a version of the same add-on on sale, is not refused
        - a version still on sale, a replacement not on sale and one of another add-on are all named
          at once
        - a replacement whose add-on was deleted is not on sale
        - is refused outright where the operator has not confirmed the terms
        - a version is not its own replacement
        - nothing to tell where no booking runs on the version
- `packages/ui-vue/tests/an-operator-retires-an-add-on-version.test.js`
    - where retiring an add-on version is offered
        - on a version no longer on sale, where the platform serves it, and on no other
- `packages/ui-vue/tests/component/an-operator-retires-an-add-on-version.test.ts`
    - retiring an add-on version where the add-on is managed
        - is offered on the version no longer on sale
        - is not offered on the version on sale
        - is not offered where the platform does not serve it
        - says on a version that it was retired, onto which version, and how far that has come
        - says so where the announcements could not be read
        - shows the replacement, its list prices, the dates and whom it misses before anything is
          sent
        - an add-on with no version on sale says so, and asks for no preview
        - a blocker is said in words, and nothing can be announced
        - announcing asks for the code, names the bookings shown, and says what was sent

<!-- END proof -->

### SC-BUN-039 — An add-on retirement is announced for exactly the bookings the operator was shown

🟢 💰 Before announcing, the operator sees every running booking on the version with the date it would
continue on the replacement, and every booking it would not reach with the reason: its subscription
or the booking has ended, cancelled for a date by then, without a period to count from, or told
already by an earlier announcement of this version, which stands. The announcement names the
bookings shown. Where they are no longer the ones it reaches, it is refused with the preview as it
stands.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - an announcement and the bookings the operator was shown
        - is refused, with the preview as it stands, where they changed meanwhile
        - is refused with every blocker where the preview has any
- `packages/ui-vue/tests/an-operator-retires-an-add-on-version.test.js`
    - the add-on retirement flow
        - announces behind the second factor, naming the replacement and the bookings shown
        - a preview that changed meanwhile replaces the one shown, and says so
- `packages/ui-vue/tests/component/an-operator-retires-an-add-on-version.test.ts`
    - retiring an add-on version where the add-on is managed
        - shows the replacement, its list prices, the dates and whom it misses before anything is
          sent
        - announcing asks for the code, names the bookings shown, and says what was sent

<!-- END proof -->

### SC-BUN-040 — An add-on retirement's date is an end of the booking's own period, three months on

🟢 💰 For each booking, the first end of its own period — in the rhythm the booking is billed in —
that lies at least three calendar months after its notice reached an administrator of the tenant; a
booking without a rhythm or a period of its own counts the plan's. The last day it may be cancelled
without its minimum term is the last whole UTC day before that date.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - the date an add-on retirement reaches a booking on
        - is the first end of its own monthly period three calendar months after the notice
        - and of its own yearly period for a yearly booking
        - a booking billed with the plan ends with the plan’s terms
        - a booking cancelled to end by the date is not reached, one ending a day later is
        - a booking whose subscription ends by the date is not reached
        - names the plan the add-on runs beside at the date, a change landing by then included
        - the preview lists whom it reaches and whom not, and why

<!-- END proof -->

### SC-BUN-041 — Retirements of plan and add-on reach a subscription at most once in twelve months

🟢 💰 A retirement — of a plan version or of an add-on version — that would reach a subscription told
of either within the last twelve months is refused, saying how many of what it reaches that holds
for. A retirement counts from its notice reaching somebody. A notice still waiting holds no
announcement back; when it is finally sent, it waits itself while the subscription was told of
another within the last twelve months, until those are over. `SC-SUB-028` says the same for plan
versions alone. Where this stops: two announcements made at the same moment are not held against
each other, nor an announcement and a run sending a held notice at the same moment; and an
announcement made after a held notice's twelve months are over, before the next run sends it, is
told first, so the held notice waits another twelve months.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - a subscription is reached at most once in twelve months
        - an add-on retirement it was told of counts as well
        - a notice still waiting for somebody to tell holds nothing back
        - a waiting notice goes out only twelve months after the subscription was told of another
- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - twelve months between two retirements of one subscription
        - a plan retirement eleven months ago holds an add-on retirement back, counted
        - so does an add-on retirement, exactly twelve months ago too
        - but not one a moment longer ago, nor a notice of another kind
        - a retirement that reached somebody counts from then, though recorded long before
        - a notice still waiting for somebody to tell holds nothing back
        - a waiting notice goes out only twelve months after the subscription was told of another
        - and not once it reached somebody a moment over twelve months ago

<!-- END proof -->

### SC-BUN-042 — Every booking an add-on retirement reaches is told, and what it was told is kept

🟢 💰 The announcement and one notice per booking are written together, and then handed to the
application's own messages: the plan the add-on runs beside at the date, both versions side by side
with their prices for that plan in each rhythm, the rhythm the booking is billed in, the date it
continues on the replacement, and the last day it may be cancelled without its minimum term. A
notice the application could not send is sent by the next run. What is recorded is the notice as it
was told (`SC-SUB-023`).

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - the announcement of an add-on retirement
        - keeps the announcement and one notice per booking in one transaction, and tells each
        - tells each booking the prices beside its own plan, and what changes at them
        - and beside the plan a retirement it was told of moves it to by the date
        - is written to the audit log as an operator action
        - is refused, and keeps nothing, where another announcement of the version got there first

<!-- END proof -->

### SC-BUN-043 — An add-on retirement waits for its notice to reach the subscriber

🟢 💰 Until its notice has reached at least one administrator of the tenant, an add-on retirement
changes nothing for the booking: nothing is shown beside the add-on, its minimum term still holds,
and its date counts from the notice arriving. A notice the application could not send, or sent to
nobody, is tried again by every run until somebody is told — except while the subscription was told
of another retirement within the last twelve months (`SC-BUN-041`), or while the replacement could
not run beside a plan the booking would meet from its date (`SC-BUN-044`): then it waits. Beside
each retired version, the administration counts the bookings not told yet.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - a notice that has reached nobody yet
        - sets no date: the booking is not pending, and the next run tells it from then
        - is not told once the booking no longer runs to the date
    - a notice that waited, and the plan the add-on runs beside by then
        - is not sent while the replacement could not run beside it, and is once it can
        - is not sent either while a change set meanwhile moves it after the date
    - the quarter-hour run
        - sends the add-on retirement notices an announcement could not, after the plan’s
        - moves the add-on bookings whose date has come, after the plan’s subscriptions

<!-- END proof -->

### SC-BUN-044 — An add-on retirement's replacement has to fit every plan a booking meets from its date

🟢 💰 The announcement is refused while a booking it reaches runs, at its date or after it, beside a
plan the replacement cannot run beside: not allowed there, without a price there in the rhythm the
booking is billed in, or in a longer rhythm than the plan's — the question `SC-BUN-037` asks of a
booking. The plan at the date is the one a change scheduled by then moves the subscription to, or
else the one a retirement of its plan version it was told of moves it to by then; after the date,
every plan the subscription is already set to move to counts. The notice prices both versions for
the plan at the date. The preview counts those bookings. After the announcement, a plan change — the
tenant's own, a plan version's retirement onto another plan, or the early switch to its replacement
— is refused where the version a booking was told it continues on could not run beside the plan it
moves to; a booking that ends by its date is not asked about it. While that date is ahead and the
booking is not cancelled yet, the refusal names that version and its date rather than a day to wait
for, since cancelling it then ends it before the date; past the date, or for a booking cancelled
already, it names the day the booking can end. A notice that waited is sent only while the
replacement can run beside every plan the booking would meet.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-plan-change-cannot-strand-a-bundle.test.js`
    - a plan change, and an add-on told it continues on another version
        - is refused where the version it continues on cannot run beside the target plan, naming
          that version
        - goes through where that version can run beside it
        - asks nothing of a booking that ends before its version would change
        - tells a booking under a minimum term to cancel, which the retirement lets it do
        - names the end of its period as well where the version it is on cannot run beside the plan
        - names the day it can end instead once the date has passed and the move is still to come
        - names the day a booking cancelled already ends, which cancelling again cannot move
        - asks nothing of a retirement told for a version the booking is no longer on
- `packages/nest/tests/a-retirement-is-offered-where-it-is-wired.test.js`
    - where add-on versions are retired, every plan change asks about the replacements
        - the tenant’s own change, a plan version’s retirement and the early switch
        - and none of them where add-on retirements are not wired
- `packages/nest/tests/a-retirement-takes-effect.test.js`
    - the free switch before the date
        - is refused as well where an add-on was told it continues on a version the plan cannot
          carry, naming that version
        - names the day an add-on cancelled already ends, which cancelling again cannot move
- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - the preview of a retirement
        - a replacement on another plan, and the add-ons the subscriptions hold › asks too about the
          version an add-on was told it continues on
- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - a replacement and the plans its bookings run beside
        - is refused where it cannot run beside the plan a booking runs beside at the date, counted
        - asks about the plan a change moves the subscription to before the date
        - asks about the plan a retirement it was told of moves the subscription to by the date
        - and about a plan a change moves the subscription to after the date
        - and about the price there, in the booking’s rhythm
    - a notice that waited, and the plan the add-on runs beside by then
        - is not sent while the replacement could not run beside it, and is once it can
        - is not sent either while a change set meanwhile moves it after the date
    - the replacements a plan change asks about
        - are the bookings told of a retirement, each with the version it continues on
        - and none where nothing was told
- `packages/ui-vue/tests/component/an-operator-retires-an-add-on-version.test.ts`
    - retiring an add-on version where the add-on is managed
        - a blocker is said in words, and nothing can be announced

<!-- END proof -->

### SC-BUN-045 — A retirement lets a booking be cancelled without its minimum term until it takes effect

🟢 💰 From the moment its notice reaches the subscriber until its date, a booking on a version being
retired may be cancelled without its minimum term: the cancellation lands at the end of the period
running, and the preview of it says no minimum term holds.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - cancelling a booking a retirement was told of
        - lands at the end of the period running, without the minimum term
        - and with it where no retirement is pending
        - is pending until the date, and no longer from it
    - the tenant’s add-on route and a retirement told
        - cancels without the minimum term while one is pending, asked by the server’s clock
- `packages/nest/tests/subscription-bundle-preview.test.js`
    - SubscriptionBundlePreviewService — previewCancel
        - a retirement told for the booking lets it go at the period end, with no term to warn of

<!-- END proof -->

### SC-BUN-046 — A tenant sees the retirement of an add-on's version beside the add-on

🟢 Where the tenant's add-ons are listed, a booking on a version being retired says when it
continues on which version, what that version costs beside the one it is on at the prices for the
subscription's plan, what changes in its quotas and features, and until when it may be cancelled
without its minimum term. What it says is the notice the subscriber was told, and it says it while
the booking runs to the date: one cancelled to end by then never moves, and says nothing of it.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - the tenant’s add-on route and a retirement told
        - lists each booking with the retirement of the version it is on
        - lists no retirement on a booking cancelled to end by its date, and keeps it on one that
          runs past
        - and none where the subscription paying for it ends by the date
- `packages/ui-vue-tenant/tests/component/a-retired-add-on-version-is-announced-beside-the-add-on.test.ts`
    - a retired add-on version, in the add-on store
        - says when the booking moves on, to which version, at what price, and until when it may go
        - sits directly after the booking it is about
        - is not shown where the version booked is not being retired
    - a retired add-on version, on the page of the tenant’s add-ons
        - is said on the booking it is about, in the app’s money where the app gives it
        - guesses no currency where the app gives no formatter
        - is not shown on a booking whose version is not being retired

<!-- END proof -->

### SC-BUN-047 — The operator sees how far each add-on retirement has come

🔵 _(Superseded on 2026-10-04 by `SC-BUN-053`.)_ Beside each retired add-on version, the
administration counts the bookings the retirement reached: on another version since, waiting for
their date, ended by it, not told yet, and overdue — past their date and still on the version.

_Source:_ #357

### SC-BUN-048 — A booking a retirement did not reach is not reinstated on the retired version

🟢 💰 A cancelled booking on a version being retired that the announcement did not reach — set to end
before it would move — is refused when it is reinstated while it still runs, and told which version
to book from which day: the day it ends, or the next where it ends during a day, since an add-on is
booked once at a time. Where the subscription ends by that day as well, it is told so; where that
version cannot run beside the plan the subscription is on then, or beside one it is set to move to
after it, in any rhythm, it is told that — neither names a day. Reinstated, it would run on past the
date on a version nobody sells.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - reinstating a booking of a version being retired
        - is refused where the announcement did not reach it, naming the replacement
        - names the day after where the booking ends during one
        - says the replacement cannot run beside its plan where it cannot, and names no day
        - asks of the plan the subscription is on when the booking ends
        - names the day where the replacement can be booked in the plan’s rhythm only
        - answers nothing once the cancellation has landed: the booking route says so
        - says the subscription ends by then where it does, and names no day
        - asks the plans the subscription is set to move to after that day
        - is not refused where its notice still waits, and the next run tells it
        - is not refused where it was reached, nor on a version nobody retired
    - the tenant’s add-on route and a retirement told
        - refuses to reinstate what the retirement service refuses, and writes nothing
- `packages/ui-vue-tenant/tests/component/a-retired-add-on-version-is-announced-beside-the-add-on.test.ts`
    - a booking the platform will not reinstate
        - is told why in the reader’s language

<!-- END proof -->

### SC-BUN-049 — A booking continues on the replacement at the date it was told

🟢 💰 At its date, a booking still on the retired version continues on the replacement, keeping its
period and its term, and is charged from then at the replacement's price for its plan.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retirement-is-offered-where-it-is-wired.test.js`
    - where add-on versions are retired, they also take effect
        - the run that moves bookings at their date is there, and the catalogue asks before it
          deletes an add-on
- `packages/nest/tests/an-add-on-booking-moves-at-its-date.test.js`
    - the move at the date
        - moves each booking onto the replacement, keeping its period, terms and rhythm
        - writes the contract to end where the subscription does
        - moves nothing before the date, and a second run nothing more
        - moves a booking past its date, the run having missed it
        - moves nothing whose notice has reached nobody, however late it is
        - leaves a booking that ends by its date, and one whose subscription does
        - leaves a booking taken off the version between the read and the write to the next run
        - moves a booking in a trial, and writes it no contract and no charge
        - records the charges the move makes due
- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - the quarter-hour run
        - moves the add-on bookings whose date has come, after the plan’s subscriptions

<!-- END proof -->

### SC-BUN-050 — A booking's move and its contract are one, and its periods from the date wait for both

🟢 💰 The move writes a contract whose line for the booking names the replacement, marked with the
retirement; where that contract cannot be written, the booking goes back onto the version retired,
and the next run makes both. A period of the booking that starts on or after its date is charged
only once that contract exists, and then from that line, however late the move came — unless the
booking, or the subscription it belongs to, ended before any move came: nothing moves it then, and
those periods are charged at the version retired, which it ran on until it ended. A period that
starts before the date is charged at the version retired, whenever it is charged. A booking on a
subscription in its trial moves without a contract, which is frozen when the trial converts. A
booking whose notice reached nobody is charged as before.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retired-add-on-version-is-charged-to-its-date.test.js`
    - a booking’s period from the date it was told
        - waits while the booking is on the version retired, and is charged at the replacement from
          the move
        - is charged from a move written after it ended, and so is every period in between
        - is not charged from a contract written on the version retired in between
        - a period before the date is charged at the version retired, though charged after the move
        - is charged at the version retired where the booking ended before any move came
        - is charged from the move’s line where the booking ended after a late move
        - and so where the subscription it belongs to ended before any move came
        - waits for nothing in another booking on the version, which the notice did not reach
        - is charged as before where the notice reached nobody: nothing moves it
- `packages/nest/tests/an-add-on-booking-moves-at-its-date.test.js`
    - what changed since the run read the subscription
        - a cancellation declared since ends the contract the move writes on its date
        - a subscription that ended since takes the booking back, and writes nothing
        - a tenant on another subscription by now takes the booking back
        - a trial converted since gets the contract the move writes
    - a move that cannot be made
        - fails without a party to the contract, audited once though every run fails
        - puts the booking back where its contract cannot be written, and the next run makes both
        - goes on with the next booking where putting one back fails, and says so
        - says so where the booking cannot be put back either
    - a booking that ended before its move came
        - is not moved, and the journal is asked once for the periods it ran on
        - nor where the subscription it belongs to ended since
        - asks nothing where nothing waited: an end by the date, or a trial
        - claims nothing for a booking of a subscription the tenant is no longer on
        - asks the journal again where it could not record them
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a contract a retirement writes
        - an add-on retirement marks the line of the version it moves a booking onto, and only that
          one

<!-- END proof -->

### SC-BUN-051 — A retirement keeps its promise, and the add-on stays until its bookings have moved

🟢 💰 The move binds the replacement the notice named whatever its sale by then, since moving a
booking books nothing new. While a booking an add-on retirement reached is still to move onto one of
the add-on's versions — waiting for its notice, for its date, or past it — the add-on cannot be
deleted, and the refusal says how many. A booking that has ended holds nothing up.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retirement-is-offered-where-it-is-wired.test.js`
    - where add-on versions are retired, they also take effect
        - the run that moves bookings at their date is there, and the catalogue asks before it
          deletes an add-on
- `packages/nest/tests/an-add-on-booking-moves-at-its-date.test.js`
    - the replacement the notice promised
        - is bound at the date though its sale has ended since
        - keeps the add-on from being deleted while bookings still move onto it, counted
        - and so does a notice still waiting for somebody to tell, and a move past its date
        - but not once every booking has moved, or ended by its date
        - nor once a booking past its date has ended before anything moved it
        - nor for a notice that can no longer go out
        - and holds back no other add-on, nor reads its retirements
        - is what the catalogue asks before it deletes an add-on, deleting nothing it is refused

<!-- END proof -->

### SC-BUN-052 — The operator sees why an add-on retirement's notice still waits

🟢 Beside each retired add-on version, the administration says of the bookings not told yet why their
notice waits: the retirement no longer reaches the booking, what it announces would not fit at its
date, the subscription was told of another retirement within the last twelve months, or nothing
holds it back and nobody has been reached yet. Each is counted once, by the first of these that
holds it back, and the run that sends the notices asks the same questions in the same order.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - how far an add-on retirement has come
        - says why each notice not told yet waits, as the run that sends them would

<!-- END proof -->

### SC-BUN-053 — The operator sees how far an add-on retirement has come, and what is still to move

🟢 Beside each retired add-on version, the administration counts the bookings the retirement reached:
on another version since; ended — by their date, or since without having moved, told or not, since
nothing moves a booking that has ended; not told yet; waiting for their date; and overdue — past
their date and still running on the version, a move the platform has still to make.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - how far an add-on retirement has come
        - counts its bookings waiting, not told, ended by their date and overdue
        - counts a booking that ended past its date before anything moved it as ended
        - says why each notice not told yet waits, as the run that sends them would
- `packages/ui-vue/tests/component/an-operator-retires-an-add-on-version.test.ts`
    - retiring an add-on version where the add-on is managed
        - says on a version that it was retired, onto which version, and how far that has come

<!-- END proof -->

### SC-BUN-054 — A booking may switch to the replacement before its date, at no more than it paid

🟢 💰 Until its date, a booking on an add-on version being retired may move to the named replacement
at once, beside the add-on's notice in the plan section and on the tenant's add-on page, for the
tenant's administrators. The switch keeps the booking, its period, its terms and its rhythm, and its
contract marks the add-on's line as the move's does, so nothing is left to move at the date
(`SC-BUN-050`). Where the replacement costs more for the plan the add-on runs beside, in the
booking's rhythm, the subscription goes on paying what it paid for the add-on until the date
(`SC-BUN-055`); where it costs the same or less, its price applies from the booking's next period.
The switch opens after a trial, for a booking that runs past the date — one whose cancellation lands
after the date may switch, and its cancellation stands, while one that ends by the date, or whose
subscription does, has nothing to move to — and not while the plan the add-on runs beside, or the
rhythm it is billed in, changes before the date: a change scheduled to land before it, or a
retirement told to move the subscription to another plan before it. A retirement onto another
version of the same plan changes neither. The confirmation says what the switch costs until the date
and after it, and that cancelling without the minimum term is no longer available once switched:
that right rests on the booking being on the version retired (`SC-BUN-045`). A page that named
another version than the replacement is refused with the retirement as it stands, and a switch whose
contract cannot be written is put back and refused, so nothing has changed unless putting it back
fails as well, which the server log names.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-add-on-booking-switches-before-its-date.test.js`
    - the switch before the date
        - moves the booking onto the replacement at once and writes the contract that holds its
          price
        - writes the contract to end where the subscription does
        - holds nothing where the replacement costs no more
        - holds the difference for the plan it runs beside now, as the catalogue prices it
        - lets a booking whose cancellation lands after the date switch, its cancellation standing
        - says what it would cost on the page, and nothing where it is not open
    - what the switch refuses
        - a booking no retirement waits for: not told, past its date, or switched already
        - a booking whose cancellation has landed
        - a booking whose cancellation lands on the date, which it never runs past
        - a booking whose subscription ends before the date
        - a subscription in its trial
        - a version other than the replacement, answered with the retirement as it stands
        - a booking of another subscription, as a missing one
        - a subscriber without a party to the contract, before anything moves
        - a booking that left the version while the request was decided
        - a replacement that cannot run beside the plan the subscription is on
    - a plan that changes before the date
        - refuses a change of plan landing before the date, naming the add-on and its date
        - and a change of rhythm alone, but not a change landing on the date itself
        - refuses where a retirement moves it to another plan before the date
        - but not where it moves it to another version of the same plan
    - a switch whose contract cannot be written
        - is put back and refused as it came, and nothing has changed
        - is refused as it came where it cannot be put back either
    - the cancellation without the minimum term, once switched
        - is over: the retirement no longer waits for the booking
- `packages/nest/tests/an-operator-retires-an-add-on-version.test.js`
    - the tenant’s add-on route and a retirement told
        - lists beside the retirement what switching now would cost, where it may
        - switches for the tenant’s administrators, and has nothing to switch to where nothing
          retires add-ons
- `packages/ui-vue/tests/use-tenant-billing-url.test.js`
    - switchBundleToReplacement posts the version shown to the booking’s switch, then reloads
- `packages/ui-vue/tests/use-tenant-subscription-bundles.test.js`
    - useTenantSubscriptionBundles
        - switchToReplacement() posts the version shown to the booking’s switch, then reloads
- `packages/ui-vue-tenant/tests/component/a-retired-add-on-version-is-announced-beside-the-add-on.test.ts`
    - the switch beside a retired add-on version
        - says before it is taken what it holds until the day, and what it gives up
        - names the next period where nothing is held, and switches to the version shown
        - is not offered where the booking may not switch
        - is written from the plan section, which says it went through
        - is refused in the reader’s language where the plan changes before the date
        - is written from the page of the tenant’s add-ons too

<!-- END proof -->

### SC-BUN-055 — An early switch to a dearer replacement holds the add-on's price until the date

🟢 💰 The contract the switch writes names the replacement at its own price and holds the difference
as a discount line until the date the booking was told. The difference is the one between the two
versions' prices for the plan the add-on runs beside, in the booking's rhythm, as the catalogue
prices them at the switch, and it stays as agreed: a change of plan after the switch prices the
add-on anew, and the same difference comes off, up to what the period costs. The journal takes it
off every period of the booking on the replacement that starts before that date, also where a later
contract was written in between; a period that starts on the date or after it is charged in full,
and so is a period in another rhythm than the one it was agreed in, which only a booking billed in
the plan's rhythm can come to.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-add-on-price-is-held-until-the-date.test.js`
    - the price held after an early switch
        - comes off each period on the replacement that starts before the date, and none after
        - leaves February as it was charged before the switch
        - takes nothing off a period priced at the version left, though charged after the switch
        - holds where a contract written in between carries no hold
        - takes off the difference agreed at the switch where a change of plan prices the add-on
          anew
        - takes off no more than the period costs
        - takes nothing off a period in another rhythm than it was agreed in

<!-- END proof -->
