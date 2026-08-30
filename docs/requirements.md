# SaaSiCat Stakeholder Requirements

This document collects what SaaSiCat promises the people who meet it. Each entry says what holds,
not how it is built. Where a requirement has a reason that is not obvious from the requirement
itself, that reason is written beside it — it is usually the part that would otherwise stay in a
closed issue.

Three documents divide the work between them. [`CONTRIBUTING.md`](../CONTRIBUTING.md) is the
working agreement: how to build, test, version and release. The architecture decision records
under `docs/explanation/adr/` record structural decisions with their alternatives and
consequences. This document is the product one: what SaaSiCat does, what it refuses to do, and
which properties it holds itself to while doing it. Where it and `CONTRIBUTING.md` overlap,
`CONTRIBUTING.md` governs how the work is done and this document governs what the result has to
be.

## Who this is written for

Three roles run through every chapter, and a requirement is written from the side of whichever one
it happens to. Naming them here is not decoration: the same behaviour looks like a promise to one
of them and like an obligation to another, and an entry that does not say which it means has not
said anything.

- **The tenant** — a customer of the application SaaSiCat is built into. They choose a plan, book
  and cancel add-ons, are charged, and live with what they agreed to. They never see SaaSiCat by
  name. Where a chapter is written from the selling side, the same party is called the **customer**;
  it is one role seen from two directions, not two roles.
- **The operator** — whoever runs the installation. They maintain plans, set prices, publish
  versions, issue promotional codes and answer for all of it afterwards, sometimes long afterwards.
  In the administration surface they hold the platform administrator's account.
- **The integrating developer** — whoever builds SaaSiCat into their own application. They keep
  their own database, their own authentication and their own HTTP stack, and they rely on this
  behaving a particular way. Requirements addressed to them are the ones whose breach shows up in
  somebody else's product.

## How an entry is built

Every requirement carries an identifier of the form `SC-<CHAPTER>-<NNN>`, numbered from `001`
within its chapter. Under the heading stands the promise, and under that the `_Source:_` line
naming where the decision came from — an issue number, an architecture decision record, a document
in this repository, or the release the behaviour arrived in. Where the promise is complete in its
heading, there is nothing between the two, and where its reason is not obvious that reason is the
most valuable part of the entry.

## What state an entry is in

An entry says one of four things, and which one it says decides what a reader may do with it. The
question behind the table is always the same: **may somebody rely on this?**

| State         | Written as                                     | May somebody rely on it?                |
| ------------- | ---------------------------------------------- | --------------------------------------- |
| 🟢 Current    | nothing — this is the ordinary entry           | Yes                                     |
| ⚪ Draft      | `⚪ _(Draft since YYYY-MM-DD.)_`               | No — not decided, and it may not happen |
| 🔵 Superseded | ``🔵 _(Superseded on YYYY-MM-DD by `SC-…`.)_`` | No — follow the successor it names      |
| 🔴 Withdrawn  | `🔴 _(Withdrawn on YYYY-MM-DD.)_`              | No, and nothing replaces it             |

The colour is not the state — the words are. It is there so that scrolling this page shows where
the ordinary entries stop, which reading the words one at a time does not. Green has a colour and
no entry wears it: marking the ordinary case would put a dot on three hundred and eighty-nine
entries and hide the ten that are not ordinary among them. It appears once, in the line under the
chapter table, where somebody looks the vocabulary up.

Superseded and withdrawn look alike to whoever writes them and not at all alike to whoever reads
them: one hands a reader arriving from an old reference somewhere to go, the other tells them there
is nowhere. That is why they are two states and not one.

A state carries a date because the risk each one runs is time. A draft opened a year ago and never
decided reads exactly like one opened last week, and only one of the two is still somebody's
intention.

Beside its state, an entry that stands may say it is not true yet:

- `🟡 _(Decided, not yet delivered.)_` — the decision is settled and recorded, the implementation is
  not there yet. Only a current entry may say this: a draft is not decided, and a retired one has
  nothing left to deliver. Such entries are listed under the chapter table, because a decision
  nobody can find is a decision that gets taken twice — and because what a product has promised and
  not yet built is a question asked before somebody buys, not while they scroll.

**Identifiers are permanent and a number is never reused.** Somebody outside this repository may
have written one down, and it must never come to mean something other than it did. So a promise is
not edited into a different promise: the entry stays where it is, opens with what became of it, and
the new wording becomes a new entry with the next free number in its chapter.

A correction that leaves the promise intact — a typo, a clearer sentence, a reference following
somebody else's supersession — is made in the entry itself. What decides between the two is whether
what somebody can rely on changes.

Chapters 1 to 16 are functional: what the product does. Chapters 17 to 24 are non-functional: the
properties it has while doing it.

## Chapters and identifiers

| #   | Chapter                                      | Identifiers  | Entries |
| --- | -------------------------------------------- | ------------ | ------- |
| 1   | The product and its boundary                 | `SC-SCOPE-…` | 10      |
| 2   | Capabilities, features and quotas            | `SC-CAT-…`   | 16      |
| 3   | Plans and their versions                     | `SC-PLAN-…`  | 25      |
| 4   | Add-on bundles                               | `SC-BUN-…`   | 33      |
| 5   | Subscriptions, terms and billing periods     | `SC-SUB-…`   | 15      |
| 6   | Changing a plan                              | `SC-CHG-…`   | 18      |
| 7   | Cancelling                                   | `SC-CANC-…`  | 19      |
| 8   | Trials, pilots and negotiated arrangements   | `SC-SPEC-…`  | 9       |
| 9   | Prices, proration, tax and money             | `SC-PRIC-…`  | 21      |
| 10  | What a tenant may do at runtime              | `SC-ENTL-…`  | 20      |
| 11  | Promotional codes                            | `SC-PROMO-…` | 22      |
| 12  | Self-registration                            | `SC-REG-…`   | 20      |
| 13  | The public catalogue, checkout and contracts | `SC-MKT-…`   | 21      |
| 14  | Administration and access to it              | `SC-ADM-…`   | 18      |
| 15  | Working in the interface                     | `SC-UI-…`    | 21      |
| 16  | Configuring and running an installation      | `SC-CFG-…`   | 19      |
| 17  | Accessibility                                | `SC-A11Y-…`  | 12      |
| 18  | Language and wording                         | `SC-LANG-…`  | 13      |
| 19  | Security and keeping tenants apart           | `SC-SEC-…`   | 12      |
| 20  | What is kept, and what is never written down | `SC-PRIV-…`  | 10      |
| 21  | Answering the question afterwards            | `SC-AUD-…`   | 11      |
| 22  | Repeating an operation safely                | `SC-OPS-…`   | 11      |
| 23  | Compatibility and upgrading                  | `SC-COMP-…`  | 15      |
| 24  | Being understandable to a stranger           | `SC-READ-…`  | 8       |

Of 399 entries: 🟢 389 stand today, 🟡 10 decided but not yet delivered, ⚪ 0 drafts,
🔵 0 superseded, 🔴 0 withdrawn.

🟡 **Decided, not yet delivered** — [SC-PLAN-007](#sc-plan-007--publishing-says-what-changed),
[SC-PLAN-025](#sc-plan-025--every-quota-a-version-carries-counts-as-a-limit-that-can-be-lowered),
[SC-PRIC-015](#sc-pric-015--an-amount-records-the-currency-it-was-booked-in),
[SC-PRIC-017](#sc-pric-017--the-tax-rate-and-the-tax-amount-are-recorded-not-re-derived),
[SC-PRIC-018](#sc-pric-018--rounding-happens-once-when-a-charge-is-written),
[SC-PRIC-020](#sc-pric-020--a-charge-once-written-is-never-edited),
[SC-CFG-008](#sc-cfg-008--an-operator-can-see-when-the-running-configuration-was-applied-and-from-where),
[SC-CFG-009](#sc-cfg-009--a-configuration-change-is-noticed-and-reported),
[SC-AUD-010](#sc-aud-010--a-charge-names-where-it-came-from-and-which-agreement-line-it-belongs-to),
[SC-AUD-011](#sc-aud-011--a-charge-carries-the-period-it-belongs-to)

Generated from `requirements/` — 399 requirements. Do not edit by hand:
`node scripts/requirements/index.mjs --write`.

## 1. The product and its boundary

SaaSiCat is a layer inside somebody else's application, not a service they call. This chapter
draws the line: what arrives with the packages, what stays the integrating developer's, and what
SaaSiCat deliberately does not do. A developer evaluating SaaSiCat should be able to answer "will
this fit my application" from this chapter alone.

### SC-SCOPE-001 — SaaSiCat runs inside the integrator's application

The integrating developer keeps their own database, their own authentication and their own HTTP
stack. SaaSiCat is embedded; it is not hosted, and it does not become the owner of the
application it sits in.

_Source:_ ADR 0007 · `README.md`

### SC-SCOPE-002 — One installation serves one application

A plan key, a bundle key, a feature key and a quota key are unique for the whole installation.
There is no namespace above them, and retiring a plan does not free its key. Two applications
therefore mean two installations, each with its own database — which is what one subscription per
tenant, installation-wide, has always required anyway.

_Source:_ #236 · `docs/explanation/data-model.md`

### SC-SCOPE-003 — An installation that does not name its application does not start

The application's name is what a tenant reads on the sign-in page and what an operator sees in the
administration. An absent name is not a default to fill in: the installation would run identified
by an empty string, and nobody would notice until a customer did.

_Source:_ #236 · `docs/reference/options.md`

### SC-SCOPE-004 — SaaSiCat does not take payments

It records what was agreed and what became due. What talks to a bank, a card processor or an
invoice run belongs to the integrating developer, behind an agreed interface. Shipping the
interface and no implementation is what keeps SaaSiCat from becoming a payments product.

_Source:_ #214 · `docs/explanation/capability-to-contract.md`

### SC-SCOPE-005 — Counting usage stays with the application

For every limit an installation sells, the application answers how much of it a tenant is
currently using. SaaSiCat cannot know that, and does not guess it.

_Source:_ `docs/explanation/capability-to-contract.md`

### SC-SCOPE-006 — Self-registration is a deliberate addition, not part of the standard install

An installation whose tenants are created by an operator — through the administration, a command,
or the integrator's own form — needs nothing extra. An installation where a stranger with a card
becomes a paying tenant unattended wires that flow itself, and is told so before it starts rather
than three days in.

_Source:_ `docs/guides/self-registration.md`

### SC-SCOPE-007 — The platform is a NestJS application, and a foreign backend mounts it

The modules SaaSiCat ships are NestJS modules, so an installation runs one whether or not its own
backend is built that way. A developer on another Node framework does not have to move frameworks:
they run the platform standalone and mount it behind what they already have, which is what the
guide on doing so describes and recommends.

What is not offered is a version of the platform without NestJS underneath. Whether that should
exist is an open question, not an oversight.

_Source:_ #175 · [Mounting behind Express](guides/mount-behind-express.md)

### SC-SCOPE-008 — Anything may be built on SaaSiCat except a competitor to it

Reading it, running it, changing it, redistributing it, and building and selling a SaaS product on
it are all permitted. Providing a product that competes with SaaSiCat, or with a product its
author provides using SaaSiCat, is not. There is no time limit and no reversion.

_Source:_ ADR 0001 · `LICENSE`

### SC-SCOPE-009 — SaaSiCat is source-available and must not be called open source

The licence is not approved by the Open Source Initiative. Describing the project as open source
is a factual error about its licence, and it is the kind of error that gets repeated.

_Source:_ ADR 0001

### SC-SCOPE-010 — A published version keeps the licence it was published under

Rights already granted with a release cannot be withdrawn by a later one. Everything published up
to and including 0.26.1 stays under the earlier permissive licence.

_Source:_ ADR 0001 · release 0.27.0

## 2. Capabilities, features and quotas

Before anything can be sold, somebody has to say what the application can do. This chapter covers
the path from a declaration in code to an entry an operator may put in a plan. The point of it is
that there is only ever one list: the code is the source, and the catalogue is a reviewed
projection of it rather than a second thing to keep in step.

### SC-CAT-001 — What the application can do is declared next to the code that does it

There is no separate spreadsheet or hard-coded feature list to keep in step with the
implementation.

_Source:_ `docs/explanation/capability-to-contract.md`

### SC-CAT-002 — Nothing a developer declares is sold automatically

New and changed declarations are presented for review. A product owner accepts them into the
catalogue; until then they are visible and not sellable. Discovery is a controlled way to let code
reality into the product, not an automatic one.

_Source:_ `docs/explanation/capability-to-contract.md`

### SC-CAT-003 — Only approved features and quotas may be put in a plan or a bundle

A key that code declares but nobody has reviewed cannot be sold, and publishing a version that
names one is refused.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-004 — A plan may not reference something no code implements

A feature no code declares and a limit nothing counts cannot be sold. Code is the source of truth
for what exists.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-005 — A marketed non-code feature is the one narrow exception, and is configured explicitly

Something like a support commitment can be sold without any code implementing it. A feature that
is merely not built yet does not belong there.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-006 — Approval needs a scan to compare against

An installation that has not yet read its own declarations cannot accept entries into the
catalogue, and says so rather than accepting them blind.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-007 — A catalogue entry moves along a fixed path

Discovered, accepted, active, deprecated, retired — or set aside as ignored. A step outside that
order is refused, so the state of an entry always says the same thing to everyone reading it.

_Source:_ `docs/explanation/concepts.md`

### SC-CAT-008 — An approved entry whose code definition changes goes back for review

It flips to outdated by itself rather than continuing to claim an approval that was given for
something else.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-009 — Bringing a retired entry back is always a person's decision

The automatic scan at start-up never reactivates one.

_Source:_ `docs/explanation/concepts.md`

### SC-CAT-010 — Labels an operator has written are never overwritten by the scan

The automatic sync fills empty fields and leaves curated ones alone.

_Source:_ `docs/explanation/concepts.md`

### SC-CAT-011 — Four words with four meanings, kept apart

A capability is implemented, a feature is marketable, a quota is countable, and a plan or bundle
is sellable. The distinction is what lets an operator repackage the product without a developer,
and a developer refactor the code without repricing anything.

_Source:_ `docs/explanation/concepts.md`

### SC-CAT-012 — A new declaration appears for review after the application restarts

The scan happens when the application starts. An operator who cannot see a colleague's new
capability is waiting for a deployment, not looking in the wrong place.

_Source:_ `docs/guides/wire-the-backend.md`

### SC-CAT-013 — A quota key is named in exactly one place

The declaration in code. It cannot be introduced in a configuration file, and it cannot contain a
separator that would make it ambiguous where a plan lists it.

_Source:_ release 0.2.0

### SC-CAT-014 — An unsatisfied dependency between features is advice, not a refusal

A feature that requires another one may have that other one covered by the plan, by a different
bundle, or by something the operator sells separately, and none of that is visible while a draft
is being checked. A bundle naming a plan that does not exist is refused outright, because that one
is decidable.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-015 — A missing scan degrades the check, it does not stop the application

Where the strictest setting is configured but nothing can be compared against, the installation
warns loudly and keeps running. Crashing there once caused a production outage.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-016 — The check that runs before a deployment always blocks

There is no advisory mode in the pre-deployment gate: a violation stops the deployment. The same
check runs before the first write of seeded data.

_Source:_ `docs/reference/error-codes.md`

## 3. Plans and their versions

A plan is the thing a customer chooses; a version of it is the offer they actually bought. Almost
every requirement here exists to protect one promise: what a customer was sold does not change
underneath them. That is why a published version freezes once it applies, why a version somebody is
bound to cannot be edited, and why nothing published is ever deleted.

### SC-PLAN-001 — A plan is an identity; a version carries what it costs and includes

The name a customer recognises stays the same across price changes. What they pay and what they
get belongs to the version they bought.

_Source:_ `docs/explanation/concepts.md`

### SC-PLAN-002 — A plan has at most one unpublished draft at a time

An operator finishes what they started — publishing or discarding the open draft — before opening
another. Two half-written offers for one plan are a state nobody can explain to a colleague.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-003 — A plan has at most one live version at a time

Publishing a successor retires its predecessor in the same act, so there is never a moment in
which two versions of one plan are both current and a purchase could land on either.

_Source:_ `docs/explanation/data-model.md`

### SC-PLAN-004 — A published version is never deleted

A customer bound to a retired version keeps being served and billed by it. That is the whole
reason versions exist, and it is why removing one is not an option even when it is old. Discarding
is refused the moment a version is published — unlike rewriting it, which SC-PLAN-005 leaves open
in one narrow case.

_Source:_ `docs/explanation/data-model.md`

### SC-PLAN-005 — A version somebody has already bought cannot be edited

Only a draft can be changed, or a published version that is the newest of its line, has nobody on
it, and does not start until some day in the future.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-006 — Where it cannot be established that nobody is on a version, it stays frozen

The uncertain case is treated as the dangerous one, so a version is never opened for editing on
the assumption that it is unsold.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-007 — Publishing says what changed

A version is published with a note describing the change, and an empty note is refused, because the
note is what an operator reads a year later when a customer asks why their price moved. Today the
note is optional in the publish interface and a version carrying none publishes.
🟡 _(Decided, not yet delivered.)_

_Source:_ current practice

### SC-PLAN-008 — A price of exactly zero has to be meant

Publishing a plan version priced at zero is refused unless the operator says explicitly that it is
deliberate. An accidental batch publish at 0.00 once set every tariff to free.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-009 — Publishing something that takes away has to be confirmed

A version that removes a feature, raises a price or lowers one of the three quotas SC-PLAN-025
names is a change existing customers feel. It publishes only on an explicit confirmation, so it is
never the outcome of a mis-click.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-010 — One regressive change makes the whole version regressive

A version that improves nine things and lowers one is treated as a change customers feel, because
one of them will.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-025 — Every quota a version carries counts as a limit that can be lowered

A plan version is compared on `users`, `vehicles` and `storageGb` alone, so a quota an installation
defines for itself — NotesApp's `notesMax`, for instance — can be lowered and published without the
confirmation SC-PLAN-009 asks for. Add-on versions are already compared on every quota they carry.
🟡 _(Decided, not yet delivered.)_

_Source:_ current practice

### SC-PLAN-011 — A published version says which day it applies from

Each successor starts strictly after the one before it, so for any given day there is exactly one
answer to "what was on offer".

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-012 — There is no gap and no overlap between two versions of a plan

Where a version states the last day it is valid, its successor starts the next day. A day on which
a plan exists but has no offer is refused rather than discovered by the first customer to land on
it.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-013 — A version is still valid on its own last day

Validity dates are inclusive, so an offer does not go dark on the day it is advertised until.

_Source:_ `docs/explanation/data-model.md`

### SC-PLAN-014 — A plan that has ever been published is kept

It may be withdrawn from sale; it is not removed. Subscriptions reference the versions under it,
and the record has to survive them.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-015 — A plan with an open draft is not removed

The draft is published or discarded first, so no half-written offer disappears without anyone
deciding what it was for.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-016 — A version can be given an end date, and it lies in the future

Ending a version stops new bookings on it. It does not move anybody who is already on it.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-017 — Publishing happens in the administration, never in a seed

Data loaded at set-up may create drafts. Turning a draft into an offer is an act an operator
performs and is recorded as having performed.

_Source:_ `docs/explanation/concepts.md`

### SC-PLAN-018 — The version that applies is the one valid on the day of the purchase

Not the newest one, and not the one the pricing page happened to be showing.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-019 — Two operators cannot publish the same draft

The second one is told the draft has already been published rather than publishing it again.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-020 — A draft built on a version that has since been retired has to be rebased

Publishing it as it stands would put an offer live that was written against something no longer
current.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-021 — A plan that is not sold self-service says so and says who to ask

A tenant meeting a negotiated plan is pointed at the contract manager rather than at a button that
will not work. A plan may also be one that cannot be left by self-service, which is the same idea
in the other direction.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-022 — Everything wrong with an uploaded catalogue is reported at once

An operator fixing a plan file sees every error in one pass rather than discovering them one round
trip at a time.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-023 — A catalogue that cannot be read is the caller's mistake, not a server failure

It is answered as a rejected upload rather than as an internal error. A caller cannot otherwise
tell a bad file from a broken server, and the one they can fix is the one that looked unfixable.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-024 — The order plans appear in is set by moving them, not by typing numbers

An operator drags a row, or moves it with the keyboard, and the platform works out the priorities.
Gaps an operator deliberately left are preserved, and a plan with no live version has no handle to
grab, because there is nothing to order.

_Source:_ release 1.0.0-rc.4

## 4. Add-on bundles

An add-on is bought on top of a plan and lives and dies with it. Nearly everything here follows
from that one sentence: the rhythm it may be billed in, when its periods end, what happens when
the plan ends, and why no money ever comes back. The chapter also says what a tenant has to be
told before they buy, because several of these rules are only fair if they are read first.

### SC-BUN-001 — An add-on is bought on top of a plan, never instead of one

A tenant cannot use an add-on without a plan, so the plan is what an add-on hangs off.

_Source:_ #222

### SC-BUN-002 — An add-on's periods end on the day the plan's do

The alignment is made when the add-on is booked rather than repaired when the plan ends, because a
period that has to be trimmed is one somebody was committed to more of than they received — and
then owed the difference.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-003 — The first period of a booking is short, and charged for exactly that stretch

It runs from the booking to the next occurrence of the plan's billing day and is charged pro rata.
The fraction is taken against a whole cycle of the add-on's own rhythm, so a monthly add-on on a
yearly plan is not charged a fraction of a year at a monthly price.

_Source:_ #222

### SC-BUN-004 — A tenant on a monthly plan cannot book a yearly add-on

The plan would end twelve times before the add-on's first period did, and each of those is a
moment the tenant could be left committed to something that grants nothing.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-005 — A tenant on a yearly plan chooses the rhythm each add-on is billed in

Preselected to the plan's own rhythm, so a tenant who does nothing gets what they would have got
before. On a monthly plan no control appears: a question with one answer is not a question.

_Source:_ #234

### SC-BUN-006 — The price an add-on is advertised at is the price it is booked at

Including its unit. A card saying "per month" beside a yearly plan is the figure a tenant compares
add-ons by, and comparing by the wrong one is a decision made on wrong information even when the
confirmation later shows the right amount.

_Source:_ #234

### SC-BUN-007 — An add-on with no price in the chosen rhythm is shown as unavailable

Rather than as a button the server will refuse.

_Source:_ #234

### SC-BUN-008 — An add-on carries no commitment unless an operator configures one

The default is none. A twelve-month commitment nobody asked for is a different product, and it
made "cancellable to the next period end" impossible for eleven of those months.

_Source:_ #239

### SC-BUN-009 — An add-on can be cancelled at any time and ends with the period it is in

Up to the moment its next period begins. The premise behind it is that no money is ever paid back:
the tenant pays for the period they are in, it ends normally, and no refund arises.

_Source:_ #239 · #212

### SC-BUN-010 — The period an add-on ends at is its own, not the plan's

For a monthly add-on beside a yearly plan those are up to eleven months apart, and reading the
plan's boundary kept a cancelled booking committed and billed until the annual renewal.

_Source:_ #222 · release 1.0.0-rc.7

### SC-BUN-011 — An add-on has no notice period

Cancelling one takes effect at the end of its own period, or at the end of its commitment where
that runs longer, or at the plan's end where that comes first — whenever it is declared, including
on the last day. An add-on hangs off the plan that pays for it, its commitment is the minimum
term, and a second waiting period on top is one nobody could explain to a customer.

_Source:_ #230 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-012 — An add-on can never be committed past the subscription that pays for it

Its commitment is capped at the plan's end, read afresh when the cancellation is worked out — a
cap applied at booking cannot see a cancellation that had not happened yet.

_Source:_ #221 · #222

### SC-BUN-013 — A commitment of none stays none

Capping an uncommitted booking at the plan's end would invent a commitment: the booking could then
not be cancelled until the plan ended, which is the opposite of what "no commitment" is for.

_Source:_ #222

### SC-BUN-014 — A tenant who has already cancelled may still book an add-on for the time left

The commitment is shortened rather than the purchase refused. An add-on is priced per period
rather than per commitment, so a shorter one cannot overcharge them.

_Source:_ #221 · release 1.0.0-rc.6

### SC-BUN-015 — Ending with the plan is not a cancellation

No notice is given and none is needed, and the period the add-on is in when the plan ends is not
refunded. The alignment exists so that day is a period boundary in the first place.

_Source:_ #222

### SC-BUN-016 — A tenant reads what a booking commits to before confirming it

When the first period ends, when the plan it hangs on ends, and plainly that a shortened booking
is not refunded. The no-refund rule is fair only if it is read before the decision rather than
discovered after it, and it is stated as a plain sentence rather than a warning, because it holds
for every booking and a warning that always fires teaches people to skip warnings.

_Source:_ #222

### SC-BUN-017 — An add-on without a price cannot be published

For every plan the add-on is offered to, a price has to resolve in that plan's rhythm — from the
add-on's own price or from an override set for that plan. A published add-on with no price was
bookable and handed over its features for nothing, and nobody downstream could tell that from a
deliberately free one. Catching it at publication puts the mistake at the operator's desk rather
than at a tenant's checkout.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-018 — A yearly price is never derived from a monthly one

Multiplying by twelve invents a price nobody set. If a yearly price were always twelve monthly
ones, there would be no reason to have two figures.

_Source:_ #222

### SC-BUN-019 — What an add-on costs depends on the plan beside it and the rhythm it is billed in

Not on the add-on alone. An operator may price the same add-on differently for one plan, or give
it its only price there.

_Source:_ #234

### SC-BUN-020 — An add-on whose contents a tenant already has raises a warning, not a refusal

Whether the overlap comes from the plan or from another booking, the tenant is told they would pay
twice. Where a selection is fully covered by what is already chosen, it is dropped from the price
and from the booking rather than sold.

_Source:_ #212

### SC-BUN-021 — An add-on whose own dependencies nothing covers cannot be booked

If it needs a feature that neither the plan nor another active booking supplies, it would not
work.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-022 — An add-on cannot be booked on a subscription that has already ended

It would be charged, listed and inert. Reading and cancelling stay open, so somebody whose
subscription has ended can still see what they booked and explain their invoices; what closes is
the till.

_Source:_ #218 · release 1.0.0-rc.6

### SC-BUN-023 — Only a published, current version of an add-on can be booked

A draft, a superseded version and one whose validity has not started are not on offer.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-024 — An add-on version somebody has already booked cannot be edited

Same reason as for a plan version: what was sold does not change underneath the customer.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-025 — An add-on may be restricted to particular plans

Where no restriction is stated, every plan may book it.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-026 — An add-on that is not sold self-service says so and says who to ask

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-027 — The same add-on cannot be booked twice on one subscription

Not while the first booking is still running.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-028 — A cancelled booking can be reinstated only before its cancellation takes effect

Afterwards it is booked again rather than revived.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-029 — A move to a shorter plan rhythm is refused while a longer add-on is running

The tenant cancels the add-on first, and the change then goes through. It is refused rather than
converted or ended: ending it early owes the customer the difference, and converting it invents a
price nobody agreed to. The refusal is judged as of the day the change would land, so following
the advice actually works.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-030 — An add-on price of exactly zero has to be meant

A deliberately free add-on leaves its price unset. An explicit zero is refused unless the operator
says it is intended, for the same reason it is on a plan.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-031 — An add-on booked against a plan that has no period yet gets no invented one

During a trial, or while an enterprise deal is still with sales, there is nothing to align to. The
booking is left without a period and without a commitment rather than being given a made-up one,
and it joins the plan's rhythm once the plan has a paid period. Both ends of a period are written
together or neither: a half-stated period is a state no reader can interpret.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-032 — An add-on's key never changes

Renaming one means creating a new add-on and retiring the old one, because customers are bound to
the old key.

_Source:_ `docs/explanation/data-model.md`

### SC-BUN-033 — An add-on bought after a contract was agreed takes effect immediately

It used to grant nothing until something re-froze the contract, and where the optional hook was
not configured that never happened — silently.

_Source:_ release 0.14.0

## 5. Subscriptions, terms and billing periods

This chapter is about time: when a term starts, how long it runs, which day of the month a tenant
is billed on, and what renews without anybody doing anything. Most of it is invisible while it
works. It is here because the one case where it did not work — a billing day quietly moving to the
28th and staying there — moved every other date with it.

### SC-SUB-001 — A tenant has one subscription

_Source:_ `docs/explanation/data-model.md`

### SC-SUB-002 — The minimum term is the billing period that was chosen, and it starts at activation

Monthly or yearly. There is no third rhythm, and no commitment separate from the period unless an
operator configures one for an add-on.

_Source:_ #212

### SC-SUB-003 — A term renews by itself unless it was cancelled first

The commitment renews with the period, because the commitment is the period.

_Source:_ #212

### SC-SUB-004 — A short month does not move the billing day

A subscription billed on the 31st is billed on 28 February and then on 31 March. One billed on the
30th is billed on the 30th of October, not the 31st: the day is "the 30th", not "the end of the
month". Reading the next date off the previous one let a single February move a tenant's billing
day permanently three days earlier, and every date derived from it moved too — the renewal, the
notice deadline, and the end date the customer was told about.

_Source:_ #220 · `docs/guides/upgrade-to-1.0.md`

### SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal

Reading its own previous result is precisely the drift it exists to stop.

_Source:_ #220

### SC-SUB-006 — Billing dates do not move when the clock does

Period boundaries are computed so that a daylight-saving change cannot shift a billing date by a
day.

_Source:_ release 1.0.0-rc.7

### SC-SUB-007 — A subscription with no period does not renew

A trial, or a subscription still waiting on a negotiated contract, has nothing to roll forward.

_Source:_ release 1.0.0-rc.6

### SC-SUB-008 — A declared cancellation does not stop the renewal until it lands

Where a notice period pushed the ending into the following period, that period has to exist before
it can end.

_Source:_ release 1.0.0-rc.6

### SC-SUB-009 — A tenant in arrears can still cancel

A tenant whose payment failed wanting out is the single most important cancellation there is, and
a status check placed one line too early would refuse it.

_Source:_ #218

### SC-SUB-010 — A subscription that has ended can no longer change plan

Nor complete onboarding, accept a pending version, or book an add-on.

_Source:_ `docs/reference/error-codes.md`

### SC-SUB-011 — A subscription with nothing left to run is recorded as ended

Rather than left looking active for good, because nothing downstream would ever have moved it.

_Source:_ release 1.0.0-rc.6

### SC-SUB-012 — A new version of a plan does not move a customer who already bought one

It is offered as a pending change instead. A change that only improves things takes effect at the
next renewal; one that takes something away only takes effect if the tenant accepted it, and is
otherwise dropped when its date arrives.

_Source:_ release 1.0.0-rc.6 · `docs/explanation/data-model.md`

### SC-SUB-013 — Nothing rolls forward onto a subscription whose cancellation has landed

A version becomes due because a date arrived, not because anybody still wants it.

_Source:_ release 1.0.0-rc.6

### SC-SUB-014 — Accepting the same pending version twice changes nothing

And accepting one when none is pending is refused rather than silently accepted.

_Source:_ `docs/reference/error-codes.md`

### SC-SUB-015 — A scheduled change that comes due after the customer has left is declined and recorded

A change that never happened is something an operator may be asked about later.

_Source:_ release 1.0.0-rc.6

## 6. Changing a plan

A plan change is where a tenant's money and a tenant's expectations meet, and both can be lost
quietly. The rules here decide two things: whether a change is allowed at all, and when it takes
effect. The second is the one that carries money, which is why the platform decides it rather than
the caller, and why the date a tenant saw is the date they get.

### SC-CHG-001 — The tenant says what to change to; the platform says when

Handing the timing to whoever is calling let a direct request end a yearly commitment the customer
was still inside. A wizard is not a guard.

_Source:_ #212 · release 1.0.0-rc.6

### SC-CHG-002 — An immediate change may improve the service; it may not shorten the commitment

Everything else waits for the term to end, which is where a shorter period may legitimately begin.

_Source:_ #212

### SC-CHG-003 — An immediate upgrade extends the running term, it does not restart it

The customer keeps the period they already paid for, the higher plan runs inside it, and only the
difference is charged for what is left of it. So an immediate upgrade never lengthens the
commitment.

_Source:_ #212

### SC-CHG-004 — A yearly customer moving to a monthly higher plan gets it at the term end

They may have the monthly plan; they may not have it today, because starting it today would end
the yearly term they are inside. It is offered later rather than refused.

_Source:_ #212 · `docs/reference/error-codes.md`

### SC-CHG-005 — A downgrade takes effect at the end of the term

Never immediately.

_Source:_ #212

### SC-CHG-006 — A deferred change lands at the later of the period end and the commitment

A commitment that outlasts the period is what a notice period produces, and a change landing at
the period end would take effect inside it.

_Source:_ #212 · release 1.0.0-rc.6

### SC-CHG-007 — A change scheduled for the term end may take any billing rhythm

The term ends on that date either way, so the rhythm of the plan that starts there is free.

_Source:_ #212

### SC-CHG-008 — A change that arrives later is the headline, and has to be acknowledged

Somebody who presses "upgrade" and then sees nothing change for eleven months has been told
something they did not read, and a line among the warnings is exactly where a reader does not
look. An acknowledgement of one date is not an acknowledgement of the next one.

_Source:_ #212

### SC-CHG-009 — The date the tenant was shown is the date the change is made on

A confirmation quoting a date that has moved since it was shown is refused rather than silently
applied. A wrong date here is a year of somebody's money, and the page can ask again in a second.

_Source:_ #212

### SC-CHG-010 — Every refusal the preview shows is also enforced where the change is made

A caller that skips the preview meets the same answer. A refusal only the client honours is not
enforcement.

_Source:_ #212

### SC-CHG-011 — A decision taken against one state is not written into another

If the subscription changed in between — a cancellation arriving, for instance — the request is
refused and nothing is written, and the caller is told to look again.

_Source:_ release 1.0.0-rc.6

### SC-CHG-012 — A tenant cannot move to a plan whose limits their usage already exceeds

They are told which limit and by how much, and reduce usage first.

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-013 — A change that removes features warns, it does not refuse

The tenant is told how many they lose, and that existing data is kept and comes back on upgrading.
Somebody deciding whether to downgrade is deciding whether they lose their work, and the answer is
no.

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-014 — Nothing starts after the end, and nothing sells a period the end cuts short

A change scheduled before a cancellation must not come due after it and restart a term that is
over, and an immediate change on a subscription that is ending opens no fresh period. A
cancellation that has not yet landed refuses nothing, though: a customer who bought a further
period by cancelling late may still choose the plan they spend it on.

_Source:_ #219 · release 1.0.0-rc.6

### SC-CHG-015 — A cancelled subscription cannot change its billing rhythm

The plan may still move on the rhythm it was sold in. What may not move is the rhythm the ending
was calculated in.

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-016 — A plan cannot be changed while onboarding is still running

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-017 — Choosing the plan and rhythm already in force is refused as no change

Rather than being applied as one and producing a charge.

_Source:_ `docs/reference/error-codes.md`

### SC-CHG-018 — Every blocker and warning carries values a client can rebuild the sentence from

The number used, the limit, the quota, the plan name — beside the code rather than inside a
finished English sentence. Without them a client holding the code would have to parse prose for
the numbers.

_Source:_ #243

## 7. Cancelling

Cancelling is the part of a subscription a customer is most likely to dispute, so the rules are
written to be defensible rather than convenient. Two of them read backwards at first: a
cancellation may always be declared even when it cannot take effect soon, and a cancelled
subscription keeps everything until its date arrives.

### SC-CANC-001 — A cancellation may always be declared

The rules govern when it takes effect, not whether it may be made. A tenant is never told they may
not leave.

_Source:_ #212

### SC-CANC-002 — A cancellation takes effect at the later of the period end and the commitment

They coincide unless a notice period has pushed one past the other.

_Source:_ #212

### SC-CANC-003 — A tenant cannot end a subscription on the spot

The tenant-facing route offers no immediate termination. Ending a contract on the spot is an
operator's act, through the operator's own path.

_Source:_ #212

### SC-CANC-004 — Where nothing is left to run, the cancellation lands now, never in the past

Deferring to a period end that has already gone would report a date the reader has to reason about
backwards.

_Source:_ release 1.0.0-rc.6

### SC-CANC-005 — There is no notice period until an installation names one

Every installation states both numbers in `config/saas.yaml`, and one that states neither does not
start. Zero is what most should write: a cancellation declared on the last day of a period then
still takes effect at the end of that period, which is the reading a customer expects and the one
that generates no disputes. It is written down rather than defaulted, because a notice period is a
commercial decision and an unwritten one is a decision nobody made.

_Source:_ #212 · #217

### SC-CANC-006 — A notice period belongs to a rhythm, not to an installation

One number could not be right for both. A fortnight of notice on a yearly contract is unusual;
three months on a monthly one is void against a consumer in Germany. Each rhythm is configured
separately, and neither inherits the other — inferring one from the other would be inventing a
term. A configuration naming only one of them is therefore refused rather than read as zero for
the other; see
[SC-CFG-017](#sc-cfg-017--a-required-setting-is-required-member-by-member-not-as-a-block).

_Source:_ #230 · #217 · `docs/guides/upgrade-to-1.0.md`

### SC-CANC-007 — The rhythm that decides the notice is the subscription's, not the plan's

A customer on a yearly subscription is owed the yearly notice, even where the same plan is also
sold monthly.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-CANC-008 — No upper limit is placed on a notice period

The platform does not know whether an installation serves consumers or businesses, so the number
is the operator's to choose and the legal risk is theirs. What it costs is documented rather than
enforced.

_Source:_ #230 · `docs/guides/upgrade-to-1.0.md`

### SC-CANC-009 — A missed notice deadline moves the cancellation to the end of the next period

A hard cut, not a grace period. It costs a customer real money, which is why the period a
cancellation lands in has to be stated before they confirm it.

_Source:_ #212

### SC-CANC-010 — A cancellation lands on the first period end that actually serves the notice

However long the notice is. Advancing by exactly one period gave a customer between 31 and 60 days
of a 60-day notice depending on which day they happened to declare — the operator promised sixty
and the customer received thirty-one. A misconfiguration should cost the customer a longer wait,
not cost the operator a promise the software cannot keep.

_Source:_ #230

### SC-CANC-011 — A late cancellation extends the recorded commitment to the period it bought

Every other reader of the term end looks at the commitment, so a downgrade scheduled meanwhile
would otherwise land inside the period the customer had just paid for.

_Source:_ release 1.0.0-rc.6

### SC-CANC-012 — Declaring the same cancellation twice does not move it

The second press reports the existing cancellation and writes nothing. Where a notice period is
configured, re-deciding after the deadline pushed an on-time declaration a whole period further
out: the customer pressed the same button twice and bought a year.

_Source:_ #212 · release 1.0.0-rc.6

### SC-CANC-013 — Two cancellations arriving at once produce one

The second one reads back what the first wrote rather than replacing an on-time date with one a
period later.

_Source:_ release 1.0.0-rc.6

### SC-CANC-014 — A repeated cancellation does not explain itself with figures it cannot know

The deadline and whether the declaration was late come back as unanswered rather than recomputed,
because recomputing them would report a declaration that landed a period late as an on-time one.

_Source:_ release 1.0.0-rc.6

### SC-CANC-015 — A tenant who has cancelled is told from which date

And the act they have already performed is no longer offered to them. A tenant who cancels in
month three of a year and sees only the word "cancelled" has lost nothing yet and believes they
have.

_Source:_ #219

### SC-CANC-016 — A subscription is in one of three states, not two

Running; running with a cancellation still to come; over. The middle one is the one that gets
lost, and it keeps every entitlement it had until the date arrives. A page showing it follows the
effective moment on a timer rather than on the last render.

_Source:_ #219 · release 1.0.0-rc.6

### SC-CANC-017 — The period a cancellation lands in is stated before the tenant confirms it

Not afterwards, and not on a receipt.

_Source:_ #212

### SC-CANC-018 — The agreed contract ends when the subscription does, not when the customer declares

Both mistakes are available and both are wrong. Leaving it in force forever outlives the
agreement; ending it on declaration removes it from every lookup while the customer is still under
contract and still paying, so the invoicing side stops finding it.

_Source:_ #218 · release 1.0.0-rc.6

### SC-CANC-019 — Recording a cancellation is never blocked by something that follows it

If the contract could not be closed or the record of the act could not be written, the cancellation
still stands. A tenant is not left uncancelled because a secondary step failed.

_Source:_ release 1.0.0-rc.6

## 8. Trials, pilots and negotiated arrangements

Not every subscription is an ordinary paid one. A trial commits to nothing, a pilot is a granted
arrangement, and an enterprise deal may sit with sales for weeks. Each of them answers the
questions in the previous chapters differently, and this chapter says how — because the failure
mode is a rule written for the ordinary case being applied to one of these.

### SC-SPEC-001 — A trial commits to nothing, so a plan change during one takes effect at once

Deferring an upgrade to the end of a trial withholds the very thing the customer asked to try.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-002 — Cancelling during a trial ends the trial, and no sooner

It lands when the trial does. Ending it on the spot would take the trial away as the price of
saying they do not want to convert; treating it as a term meant a customer cancelling a
yearly-cycle trial bought a year.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-003 — A notice period never applies to a trial

The window exists so a term cannot be left at the last moment, and a trial has no term to leave.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-004 — Switching plans during a trial carries the remaining trial time over

The time already used is deducted rather than restarted, and repeated switches do not accumulate
or lose days. Where the plan being moved to has no trial, the trial end stays where it was.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-005 — A trial grants the trial's entitlements, not the booked plan's

And it opens no billing period; the agreement is frozen when the subscription becomes a paid one.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-006 — A pilot arrangement outranks every other way of resolving what a tenant may do

Ahead of trial, ahead of a pending negotiation, ahead of a scheduled change.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-007 — Granting, withdrawing or extending a pilot is a deliberate operator act

It needs a second factor and an explicit confirmation, and it is recorded.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-008 — A negotiated arrangement is expressed as limits set for that tenant

Limits set for the tenant replace the plan's; features set for the tenant are added to the plan's.
The two behave differently on purpose: a negotiated limit is a substitution, a negotiated feature
is an addition.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-009 — A subscription waiting on a negotiated contract falls back to a named interim plan

It has no billing period, and cancelling it takes effect immediately, because there is nothing
running to see out.

_Source:_ release 1.0.0-rc.6

## 9. Prices, proration, tax and money

Money is the one area where an error is both invisible and unforgivable. This chapter fixes how
part-periods are calculated, what happens when arithmetic goes the wrong way, and which facts
about an amount are recorded rather than re-derived later. Some of it is decided and not yet
built; those entries say so.

### SC-PRIC-001 — SaaSiCat computes prices; the integrator bills them

Nothing is stored as an amount that was paid, which is also why no credit can be owed when a
period is shortened.

_Source:_ #222

### SC-PRIC-002 — A part-period is charged by days

Not by whole months. Plan changes and add-on bookings then answer with the same arithmetic, so two
screens describing one situation cannot quote different figures.

_Source:_ #222

### SC-PRIC-003 — This platform never pays money back

A prorated fee is floored at zero. Where a change lowers the price, the upgrade is free rather
than producing a credit, and a cancellation is never refunded pro rata — the booking stays active
and paid to the end of its period.

_Source:_ #212 · release 1.0.0-rc.6

### SC-PRIC-004 — "Free upgrade" and "costs nothing" are two different sentences

A change that is free because the arithmetic went negative is not the same as one that costs
nothing because the two plans are priced alike, and somebody deciding is owed the difference.

_Source:_ release 1.0.0-rc.6

### SC-PRIC-005 — There is no proration during a trial

There is no paid period to take a fraction of.

_Source:_ release 1.0.0-rc.6

### SC-PRIC-006 — The preview and the booking describe the same contract

A tenant who was quoted a price and a term gets that price and that term.

_Source:_ #222

### SC-PRIC-007 — An amount a tenant sees is the amount that is charged

Money is held to two decimal places and never as a floating-point number, and the same arithmetic
produces the same figure in the backend, the tenant's page and the administration. Discounts, part
periods and tax do not accumulate a difference between what a page shows and what is billed.

_Source:_ `docs/explanation/data-model.md` · internal engineering guidelines

### SC-PRIC-008 — Gross, net and tax are one calculation, stated once

Gross follows from net and the configured rate, and the tax contained in a gross amount follows
from the same rate. Both are rounded once and mean the same thing everywhere they appear.

_Source:_ release 1.0.0-rc.7

### SC-PRIC-009 — An installation sells in one currency and applies one tax rate, both named once

The tax rate is required even when it is zero, so nobody is left wondering whether it was
forgotten. Changing the currency after contracts exist is a migration rather than an edit, because
a currency change must not silently relabel history.

_Source:_ #217 · #214

### SC-PRIC-010 — A yearly price is a price per year, not a monthly price with a discount attached

Whatever a pricing page chooses to display.

_Source:_ `docs/reference/options.md`

### SC-PRIC-011 — A plan that is not marketed has no list price

It is sold by negotiation, and no page invents a figure for it.

_Source:_ release 1.0.0-rc.6

### SC-PRIC-012 — A contract mixing rhythms totals one period of its own rhythm

A monthly add-on beside a yearly plan counts as often as it falls due within that year, not once.

_Source:_ release 1.0.0-rc.7

### SC-PRIC-013 — Amounts of money cross the wire exactly, not as approximations

So that nothing is lost between the system that computed a figure and the one that shows it.

_Source:_ release 1.0.0-rc.7

### SC-PRIC-014 — The number of decimal places follows the currency

Two for euros, none for yen. That is a property of the currency, not a formatting preference.

_Source:_ #105

### SC-PRIC-015 — An amount records the currency it was booked in

Even though only one is configured at a time. The record is not for selling in two currencies; it
is so that a row written in 2026 still means what it meant. 🟡 _(Decided, not yet delivered.)_

_Source:_ #214

### SC-PRIC-016 — A tax rate has a validity window

A contract concluded at 19 % is charged 19 % for its term, whatever the rate later becomes.

_Source:_ #217 · #214

### SC-PRIC-017 — The tax rate and the tax amount are recorded, not re-derived

Storing net and gross leaves the rate living in the ratio between them, and a ratio cannot be
reproduced for a rounded gross, cannot express an exempt or reverse-charge line, and does not
survive a rate change. 🟡 _(Decided, not yet delivered.)_

_Source:_ #214

### SC-PRIC-018 — Rounding happens once, when a charge is written

The written figure is the truth from then on. 🟡 _(Decided, not yet delivered.)_

_Source:_ #214

### SC-PRIC-019 — A tenant can see their own account

Balance, what is open, and the history. An open balance a customer cannot see is a surprise at the
moment it becomes a problem; one they can see is something they can act on. _(Decided, not yet
delivered.)_

_Source:_ #214

### SC-PRIC-020 — A charge, once written, is never edited

A correction is a counter-entry. A record that can be rewritten answers what somebody thinks
today, not what happened. 🟡 _(Decided, not yet delivered.)_

_Source:_ #214

### SC-PRIC-021 — An internal account reference is never shown to a customer as an invoice number

Invoice numbering is sequential, gapless and legally constrained per country, and an identifier a
customer has already seen on a screen cannot become one later without confusion. _(Decided, not
yet delivered.)_

_Source:_ #214

## 10. What a tenant may do at runtime

Everything above decides what was sold. This chapter is about the moment it is applied: a request
arrives, and the answer has to be the one the contract gives. These are the requirements an
integrating developer relies on most directly, because a mistake in them is either a customer
paying for something they cannot use or using something they did not pay for.

### SC-ENTL-001 — What a tenant may do is their plan plus the add-ons they booked

Features are the union; limits add up.

_Source:_ `docs/explanation/concepts.md`

### SC-ENTL-002 — An unlimited allowance beats any number, and an absent one counts as none

So a single unlimited grant cannot be diluted by adding numbers to it, and a limit nobody set is
not silently generous.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-003 — A feature declared as not yet rolled out is never granted

Wherever it comes from — a plan, an add-on, or a negotiated arrangement. It can be advertised in
the catalogue and still not be handed over.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-004 — Once a contract is agreed, it is the truth about what the tenant may do

Catalogue edits do not reach a running contract.

_Source:_ `docs/explanation/capability-to-contract.md` · `README.md`

### SC-ENTL-005 — A request for something the contract does not include is refused

And the refusal may carry what would unlock it, so the tenant is told how to proceed rather than
only that they may not. Where several features would each admit the request, having any one of
them is enough.

_Source:_ `README.md` · `docs/reference/error-codes.md`

### SC-ENTL-006 — A missing feature and an exhausted limit are told apart

They are two different answers, and a client can act differently on each. An exhausted limit says
which limit and where the tenant stands against it.

_Source:_ `docs/reference/error-codes.md`

### SC-ENTL-007 — Two simultaneous requests cannot both take the last remaining unit of a limit

Counting and then writing happens as one indivisible step per tenant; otherwise two requests that
each fit both go through and the limit an operator sold is not the limit that applies.

_Source:_ `docs/explanation/data-model.md` · `docs/reference/options.md`

### SC-ENTL-008 — A single large action can be refused by a limit it would cross in one go

The check is against what the action would consume, not against a single unit, so one ten-gigabyte
file does not fit under a one-gigabyte allowance.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-009 — The declarative check is a guard, not a guarantee

Applied to a route it is deliberately a soft check and can be raced. Where a limit must hold
exactly, the transactional path is the one to use, and the difference is stated rather than
implied.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-010 — A limit nothing can count does not block anybody

The request goes through and the gap is reported for review, rather than a tenant being refused
because an installation has not finished wiring a counter.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-011 — Enforcing a limit nobody declared is the installation's fault, not the tenant's

It is answered as a misconfiguration rather than as a refusal the tenant could do something about.

_Source:_ `docs/reference/error-codes.md`

### SC-ENTL-012 — A cancellation that has taken effect grants nothing

No features, no limits. Until this rule existed, a subscription cancelled eight months earlier was
granted exactly what it was granted while active.

_Source:_ #219 · `docs/guides/upgrade-to-1.0.md`

### SC-ENTL-013 — A cancellation that is merely declared changes nothing

A subscription cancelled in month three of a year runs, is billed and keeps everything until the
term ends.

_Source:_ #219

### SC-ENTL-014 — An installation may name a floor a cancelled subscription falls back to

A read-only tier a former customer can export from, or a free plan, instead of nothing. Add-on
bookings and negotiated limits are not carried into it, because those belonged to the subscription
that ended.

_Source:_ #219 · `docs/guides/upgrade-to-1.0.md`

### SC-ENTL-015 — The end of a subscription is seen on every enforcement path

A rule written into one of two paths is enforced in half the applications, and two paths that
disagree about what a cancelled subscription keeps would be worse than either answer alone.

_Source:_ #219

### SC-ENTL-016 — An answer computed before an end date arrives is not served after it

A date arriving is not a change anybody makes, so nothing would invalidate a remembered answer by
itself.

_Source:_ #219

### SC-ENTL-017 — A feature that was renamed keeps working for customers who bought the old name

An existing contract holding a superseded key grants its successors, and keeps the old one too, so
a rename in the catalogue is never a silent downgrade for somebody already paying.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-018 — An offer shown alongside a refusal is one the tenant could actually buy

Only currently marketed, live add-ons are offered, ranked by how much of what is missing they
cover and then by price. A failure to work out an offer never turns a correct refusal into a
server error.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-019 — A platform administrator is not blocked by a tenant's entitlements

Support can act on a tenant's behalf without the tenant having bought the feature being used.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-020 — Hiding a control is not protection

The interface hides what the backend would refuse; the refusal is what protects it. A tenant who
constructs the request by hand gets the same answer.

_Source:_ `docs/guides/build-the-admin-frontend.md`

## 11. Promotional codes

A promotional code is a discount an operator can hand out without a developer. The requirements
here are mostly limits: what a code may promise, how often it may be used, and what happens when
two people redeem the last one at the same moment. The last group exists because a discount that
half-applies is worse than none.

### SC-PROMO-001 — A code is redeemed at most once per subscription

Reversing a redemption releases the slot back to the code.

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-002 — A code with a redemption limit cannot be over-redeemed

However many people try at the same moment. It closes itself once it is full.

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-003 — A redemption limit can be raised, never lowered

Lowering it would retroactively invalidate redemptions that already happened.

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-004 — A code that has been redeemed is never deleted; it is paused

The redemptions reference it, and a customer's discount has to remain explicable.

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-005 — A percentage discount is between 0 and 100

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-006 — A discount runs for at most 24 months or billing periods

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-007 — A one-off discount carries no duration and applies to the first invoice only

The regular price applies from the second period. The two forms are alternatives, and a code
claiming both describes nothing.

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-008 — An absolute discount stays below the lowest price it can apply to

Both when the code is created and when it is redeemed, unless the operator deliberately allows an
invoice of zero. Otherwise a code quietly makes a plan free.

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-009 — A plan may be marked as not discountable

A code cannot be created for it and never validates against it.

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-010 — A code is for first-time customers unless the operator says otherwise

That is the default, because it is the common case and the expensive mistake is the other way
round.

_Source:_ release 1.0.0-rc.7

### SC-PROMO-011 — Redeeming a code applies the discount and records the redemption, or does neither

Half-applying it leaves a customer with a discount nobody recorded, or a record of one they never
received.

_Source:_ `docs/reference/options.md`

### SC-PROMO-012 — A code only applies to a subscription belonging to the person redeeming it

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-013 — A code works whatever case the customer typed it in

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-014 — A code is 4 to 32 characters of upper-case letters, digits, hyphen and underscore

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-015 — What a code promised when it was redeemed stays with the redemption

Later edits to the code do not change what a customer already got.

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-016 — A code past its validity stops working without anybody having to run anything

It is retired both on a schedule and on the next time somebody asks about it.

_Source:_ release 1.0.0-rc.7

### SC-PROMO-017 — Failed attempts are recorded as well as successful ones

Guessing at codes leaves a trail.

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-018 — Guessing at codes is rate-limited, per address and per session

Checking a code needs no account, so the limit is what stands between a public endpoint and
somebody enumerating the campaign.

_Source:_ release 1.0.0-rc.7

### SC-PROMO-019 — A first-time-only code needs a way to answer who is a first-time customer

An installation offering one publicly without that answer would show every such code as
unavailable, which is worse than not offering it.

_Source:_ `docs/reference/options.md`

### SC-PROMO-020 — The amount in a discount summary is formatted in the audience's language

Not in one the platform picked. A German product's customers read "25 % once" in checkout because
the number formatting and the words had been decided separately.

_Source:_ #105

### SC-PROMO-021 — A language the runtime cannot serve is refused rather than quietly replaced

A well-formed typo would otherwise fall back to the runtime's own default, and an amount would
reach the customer formatted in a language nobody chose.

_Source:_ #105

### SC-PROMO-022 — Creating, changing and removing a code is recorded

_Source:_ release 1.0.0-rc.7

## 12. Self-registration

Where an installation lets strangers sign themselves up, the flow has to be safe against people
who are not customers yet. This chapter covers the ordering of the steps, what expires, and the
limits on guessing. It applies only to installations that wire the flow deliberately — see
SC-SCOPE-006.

### SC-REG-001 — Starting a registration reveals nothing about who already has an account

The answer is the same whether or not the address is known, and a failure to send the message is
not surfaced either. Otherwise the flow becomes a way to enumerate customers.

_Source:_ release 1.0.0-rc.7

### SC-REG-002 — A half-finished registration is never counted as a customer

Not in numbers an operator reads, and not in a check for whether an address is already taken.

_Source:_ `docs/explanation/data-model.md`

### SC-REG-003 — Accepting the terms, the privacy notice and the data agreement is part of step one

_Source:_ release 1.0.0-rc.7

### SC-REG-004 — Somebody who has already verified their address is not asked to verify it again

They are sent a link back into where they left off instead of a new code.

_Source:_ release 1.0.0-rc.7

### SC-REG-005 — Restarting an unverified registration issues a new code and keeps the stored data

The old code stops working, and nothing somebody else typed overwrites what is there.

_Source:_ release 1.0.0-rc.7

### SC-REG-006 — A verification code expires, and says so

An expired code is refused with an invitation to request a new one, not with a failure that reads
like a wrong code.

_Source:_ `docs/reference/error-codes.md`

### SC-REG-007 — After five wrong verification codes the attempt is locked

A subsequently correct code no longer works, and the only way on is a new code. The attempt is
counted before the code is compared, so parallel attempts cannot race past the limit.

_Source:_ `SECURITY.md`

### SC-REG-008 — A locked verification tells the person to request a new code

Not to try again, which is the one thing that will not work.

_Source:_ `SECURITY.md`

### SC-REG-009 — Repeated attempts are rate-limited, and the answer says how long to wait

Where refusing loudly would itself reveal that a registration exists, the request is quietly
dropped instead.

_Source:_ `docs/reference/error-codes.md`

### SC-REG-010 — A registration expires, and so does the link that resumes it

An abandoned one is removed outright rather than kept in a reduced form, so the address becomes
usable again.

_Source:_ `docs/reference/error-codes.md` · release 1.0.0-rc.7

### SC-REG-011 — The steps come in order

A step reached out of order is refused with a message saying so, rather than half-completing a
registration.

_Source:_ `docs/reference/error-codes.md`

### SC-REG-012 — The plan can be changed freely up to the moment of payment

And it is checked again at that moment, because it may have left the catalogue in between.

_Source:_ release 1.0.0-rc.7

### SC-REG-013 — A plan that does not exist and one that is not on offer answer the same

Otherwise the difference between the two would tell a stranger which plans an installation has.

_Source:_ release 1.0.0-rc.7

### SC-REG-014 — Prices in the sign-up flow are worked out by the server

The page displays a breakdown; it does not compute one. A discount can never exceed the amount it
applies to, and no total goes below zero.

_Source:_ release 1.0.0-rc.7

### SC-REG-015 — A promotional code is re-checked every time the price is shown

The stored code is only there to be displayed back to the person entering it.

_Source:_ release 1.0.0-rc.7

### SC-REG-016 — The account, the tenant and the subscription are created together or not at all

Only after payment succeeded, and a partial creation is undone.

_Source:_ release 1.0.0-rc.7

### SC-REG-017 — Add-ons chosen during sign-up never cost somebody their plan

If one of them cannot be booked, it becomes a warning and the plan still activates.

_Source:_ release 1.0.0-rc.6

### SC-REG-018 — Whether a payment confirmation is genuine is the integrator's to verify

SaaSiCat cannot know the provider or the secret. An unverified callback lets anyone forge a
payment confirmation, so verification sits in front of the route.

_Source:_ `SECURITY.md`

### SC-REG-019 — The same payment event applied twice changes nothing

Providers retry, and a retry must not create a second account or a second charge.

_Source:_ `docs/explanation/data-model.md`

### SC-REG-020 — A resumed registration never carries a password or a verification code with it

What is handed back to a returning person is what they need to continue, and nothing that could be
used against them.

_Source:_ release 1.0.0-rc.7

## 13. The public catalogue, checkout and contracts

What a prospective customer sees before they buy, and what happens between choosing and owning.
The single idea running through it: the offer is frozen before money is involved, so what somebody
saw is what they get, and a catalogue edit in between cannot change it.

### SC-MKT-001 — A pricing page reads the published catalogue rather than computing prices

There is one place prices are decided, and the page is not it.

_Source:_ `docs/explanation/architecture.md`

### SC-MKT-002 — Only plans an operator marked as marketed appear in self-service

A negotiated plan is not something a stranger can select for themselves.

_Source:_ release 1.0.0-rc.6

### SC-MKT-003 — A plan or add-on with no marketing entry, or one marked hidden, is not shown

Publishing a version and advertising it are two acts.

_Source:_ release 1.0.0-rc.6

### SC-MKT-004 — Marketing text belongs to one version and one language

So a price change and a wording change are separate acts, and a translation cannot silently
describe an offer that is no longer current. There is exactly one entry per version and language.

_Source:_ `docs/explanation/data-model.md`

### SC-MKT-005 — Marketing text falls back to the default language rather than appearing empty

_Source:_ release 1.0.0-rc.6

### SC-MKT-006 — Marketing edits take effect at once and are not versioned

They govern what the public catalogue displays, never what a running subscription is owed, so
there is nothing for them to rewrite.

_Source:_ release 1.0.0-rc.6

### SC-MKT-007 — Which languages the catalogue is published in is an operator's choice

Made on the marketing screen, from the pool the installation declared, not in a deployment.

_Source:_ #217 · `docs/reference/options.md`

### SC-MKT-008 — An installation has exactly one set of marketing settings

A convention resting on a default does not hold against a caller that supplies the value, so it is
a constraint rather than a habit.

_Source:_ `docs/explanation/data-model.md` · `docs/guides/upgrade-to-1.0.md`

### SC-MKT-009 — At most one plan is marked as the recommended one

_Source:_ `docs/reference/options.md`

### SC-MKT-010 — Exactly one promotion applies to a given plan, language and rhythm

Where several overlap, the operator's priority decides, and a promotion tied to a code is not
shown as a public one. A promotion runs to the end of its last day, and never pushes a price below
zero.

_Source:_ release 1.0.0-rc.6

### SC-MKT-011 — The public catalogue shows base prices only

A visitor has no plan, so a price that exists only as an override for one plan cannot be shown
there, and an add-on priced that way reads as having no public price rather than as free.

_Source:_ #234

### SC-MKT-012 — The public catalogue answers even when something behind it is unavailable

It falls back to what it can still say rather than failing, because it is the page a prospective
customer meets first and it requires no account.

_Source:_ release 1.0.0-rc.6

### SC-MKT-013 — What a customer selected is frozen into an offer before it becomes a contract

With an expiry date that runs to the end of its last day. What they saw is what they buy.

_Source:_ `docs/explanation/concepts.md`

### SC-MKT-014 — An offer that has expired or been used cannot become a contract

Nor can it be changed once it has been used.

_Source:_ `docs/reference/error-codes.md`

### SC-MKT-015 — An offer whose selection does not cover its own dependencies is refused

If a chosen feature needs another one, the plan and the selected add-ons together have to supply
it. A customer is not sold a combination that cannot work.

_Source:_ `docs/reference/error-codes.md`

### SC-MKT-016 — An offer cannot be turned into a contract if part of it is no longer on sale

Every add-on in it has to still be bookable at the moment of purchase.

_Source:_ `docs/reference/error-codes.md`

### SC-MKT-017 — One offer yields at most one contract, and only once its prices are frozen

Every selected item carries its own frozen line, so what was agreed is legible item by item.

_Source:_ `docs/reference/error-codes.md`

### SC-MKT-018 — A contract has exactly one plan line and at least one line in total

And it cannot end before it starts.

_Source:_ `docs/reference/error-codes.md`

### SC-MKT-019 — A contract that is already closed is not closed again

_Source:_ `docs/reference/error-codes.md`

### SC-MKT-020 — A contract agreed after a cancellation ends when that cancellation does

Otherwise the ending would last exactly until the next plan change.

_Source:_ release 1.0.0-rc.6

### SC-MKT-021 — A tenant can read back the package they were sold

The frozen selection is visible to them, unchanged, in their own self-service.

_Source:_ release 1.0.0-rc.6

## 14. Administration and access to it

Who may act on the platform, and what has to be true before they can. Most of this chapter is
about the beginning and the end of a session — bootstrapping the first administrator, requiring a
second factor, and the roles that separate a tenant's administrator from a platform one.

### SC-ADM-001 — Only a platform administrator reaches the administration surface

_Source:_ `docs/reference/error-codes.md`

### SC-ADM-002 — A tenant-facing endpoint with no access rules configured refuses, it does not open

Failing loudly is the only safe reading; waving requests through would be silent.

_Source:_ release 1.0.0-rc.7

### SC-ADM-003 — The administration requires a second factor

A one-time code alongside the sign-in. A code that cannot be checked — malformed, or a stored
secret that is unreadable — is treated as wrong, and the underlying cause is recorded so it can be
diagnosed rather than leaving somebody staring at "code invalid".

_Source:_ `docs/reference/error-codes.md` · `SECURITY.md`

### SC-ADM-004 — A one-time code is accepted across a small clock difference

Half a minute either way, so an administrator with a slightly wrong clock is not locked out.

_Source:_ `SECURITY.md`

### SC-ADM-005 — Actions with lasting consequences need the second factor and an explicit confirmation

Suspending or reactivating a tenant, acting as a tenant, exporting their data, cancelling their
subscription, and granting or withdrawing a pilot. The most serious of them ask the operator to
type the tenant's name.

_Source:_ release 1.0.0-rc.6

### SC-ADM-006 — Two actions require a written reason before they run

Resetting somebody's password and deactivating a user. The reason is part of the record, which is
why a confirmation can carry a value rather than only a yes.

_Source:_ release 0.26.0

### SC-ADM-007 — There is no default confirmation that answers yes

An implementation that approved everything would silently approve every deletion, revocation and
deactivation, so an installation supplies its own or gets none.

_Source:_ release 0.26.0

### SC-ADM-008 — A password that cannot be retrieved again is shown without a way to dismiss it

Giving that dialog a cancel button would let an operator throw away something they cannot get
back.

_Source:_ release 0.26.0

### SC-ADM-009 — First-run setup stops working the moment an administrator exists

Whatever token is presented. An installation cannot be taken over after it has been bootstrapped,
and the token is compared in a way that does not leak how close a guess was.

_Source:_ `SECURITY.md`

### SC-ADM-010 — Without a setup token configured, there is no setup route

That is the correct steady state once an installation is bootstrapped, rather than a route sitting
there refusing people.

_Source:_ `SECURITY.md`

### SC-ADM-011 — The first administrator is set up with a second factor immediately

Not as a later step somebody might skip.

_Source:_ release 1.0.0-rc.4

### SC-ADM-012 — Test-only bypasses are ignored in production

The switches that skip the second factor and the rate limits exist for continuous integration and
are honoured only outside production. An integrator cannot add their own.

_Source:_ `SECURITY.md`

### SC-ADM-013 — A tenant-facing action that costs money requires the tenant's own administrator

Changing a plan, booking an add-on and cancelling are not things any signed-in user of a tenant
may do. Reading stays open to everyone who is signed in.

_Source:_ #212

### SC-ADM-014 — An administrator identity may live in the platform's tables or the application's

The second factor works either way, so an installation that already has an admin user table does
not have to keep a second one.

_Source:_ `docs/explanation/data-model.md`

### SC-ADM-015 — The administration only offers what the application actually has

A screen or an action for something the application never declared is not shown at all.

_Source:_ release 1.0.0-rc.6

### SC-ADM-016 — Signing out ends the session

It used to leave the operator looking at a sign-in form while still signed in.

_Source:_ release 0.22.0

### SC-ADM-017 — An expired session offers a fresh sign-in once, not in a loop

Repeating it forever is how a rejected session becomes an unbreakable login loop.

_Source:_ release 0.22.0

### SC-ADM-018 — A one-time code that was just accepted can currently be accepted again

Within its validity window. This is a known limitation, named rather than left to be discovered,
and the ordering of the checks plus transport encryption are the current mitigations.

_Source:_ `SECURITY.md`

## 15. Working in the interface

The administration is an application SaaSiCat hands over; the tenant-facing pieces are guests in
somebody else's. This chapter says what a person can expect from either: that screens behave
alike, that failures appear where they were caused, and that nothing irreversible happens without
saying what it will do.

### SC-UI-001 — Every standard screen is built the same way

The same blocks in the same order, so a screen an integrator adds stands next to the shipped ones
without looking like a guest, and a person who has learned one screen has learned the rest.

_Source:_ ADR 0008 · `docs/explanation/design-guide.md`

### SC-UI-002 — Mounting a shipped screen costs no wiring

An application that needs one operation to behave differently replaces that one operation and
keeps the other nine. Before this, mounting one screen cost between 8 and 145 lines of glue with
no rule saying which.

_Source:_ ADR 0008

### SC-UI-003 — Replacing one operation that does not exist is refused at start-up

With the list of the ones that do. A typo in an override is otherwise a call that quietly keeps
the old behaviour until somebody notices an approval was never recorded.

_Source:_ release 0.26.0

### SC-UI-004 — Nothing is written until the person saves or publishes

Editors keep unsaved work across the steps of a wizard, and a step only moves on when the save
actually succeeded — a rejected save used to look exactly like a successful one.

_Source:_ release 1.0.0-rc.0

### SC-UI-005 — A failure appears where the person was looking

A page that could not load says so under its title; an action that failed inside an open dialog
says so in the dialog; only a failure with nothing on screen to attach to becomes a notification.
Never a notification for a failed load, and never one for something already visible.

_Source:_ `docs/explanation/design-guide.md`

### SC-UI-006 — What a person is shown after a failure is what the failing side said

Not the diagnostic that helps a developer find it. The two are kept apart deliberately, so a
stack-shaped message never reaches a screen.

_Source:_ release 0.26.0

### SC-UI-007 — Loading, empty and error are handled deliberately on every screen

Through the same shared elements rather than a variant per page.

_Source:_ `docs/explanation/design-guide.md` · internal engineering guidelines

### SC-UI-008 — Equivalent actions behave the same everywhere

Delete, save, cancel, edit, back, filter, search, pagination, confirmation and validation errors
work the same way on every screen unless there is a stated reason not to.

_Source:_ internal engineering guidelines

### SC-UI-009 — A destructive action says what it will destroy, by name

Not "Are you sure?" but "Delete API key 'Production Integration'? This action cannot be undone."

_Source:_ internal engineering guidelines

### SC-UI-010 — An action sits with the object it acts on

"Publish this version" does not share a footer with "delete this bundle and every version of it".
One releases a draft; the other destroys the thing.

_Source:_ release 1.0.0-rc.6

### SC-UI-011 — A list says how many rows there are, or says it is showing what it received

It does not present the number of rows in hand as a total it cannot know.

_Source:_ release 0.26.0

### SC-UI-012 — The interface works on desktop, tablet and phone

Every header control stays inside the viewport from the narrowest supported width. Where space
runs out, labels are dropped before controls are — nothing a person can press is removed. No
screen pushes the page sideways, except where horizontal scrolling is a deliberate part of a
component such as a wide table.

_Source:_ internal engineering guidelines · release 0.26.0

### SC-UI-013 — A tenant-facing section can be embedded without adopting a UI framework

The plan section, the upgrade wizard and the add-on store render inside the integrator's own
application. For a developer evaluating SaaSiCat, "you also need this UI framework" is not a line
item on the decision — it is the end of it. A component that is a guest in somebody else's product
does not bring a framework with it.

_Source:_ ADR 0010 · #206

### SC-UI-014 — The administration brings its own UI framework

It is the application SaaSiCat hands over and it owns its own page, so the integrator installs one
package and nothing else — no framework, no build plugin, no stylesheet compiler. The framework's
own global stylesheet stays an import the integrator writes, because bundling it would mean they
could no longer decline it.

_Source:_ ADR 0011 · #207

### SC-UI-015 — One colour makes the administration look like the integrator's product

The brand colour is a single value passed at start-up and it moves everything that follows from
it. Asking an integrator to restate the status colours as well is how those drifted: a scaffolded
warning colour once sat at 2.15:1 beside a platform role painting 4.8:1.

_Source:_ ADR 0011 · `docs/guides/upgrade-to-1.0.md`

### SC-UI-016 — Light and dark are both shipped, and a person can pick

Or follow whatever their system says. Two installations sharing one address do not inherit each
other's pick.

_Source:_ #137 · ADR 0009

### SC-UI-017 — A confirmation shows the answer to the question actually being asked

While a new answer is on its way, the previous one is not left on screen to be confirmed. A reader
could otherwise tick "I understand this happens on 1 January" and get something else, and the
screen and the invoice would describe different events.

_Source:_ #212

### SC-UI-018 — Where two answers are outstanding, the current question's answer wins

Not the one that happens to arrive last. A slower response is not necessarily the older one, and
prices resolved against a plan the tenant has since left are not stale — they are about a
different question.

_Source:_ #212

### SC-UI-019 — A row that opens is a control

Operable from the keyboard, announced as expandable, and controls inside its header do not toggle
it on the way past. The page decides which row is open, so opening one can close another and load
what it needs.

_Source:_ #133 · `docs/explanation/design-guide.md`

### SC-UI-020 — A page never takes the whole screen down because data arrived in a shape it did not expect

A malformed payload leaves a page that says so, not a blank content area beside a working shell.

_Source:_ release 0.24.1

### SC-UI-021 — A campaign that worked looks like a success, not a fault

A fully redeemed promotional code is shown as spent, not in the colour reserved for errors.

_Source:_ release 1.0.0-rc.0

## 16. Configuring and running an installation

Where a setting lives, what happens when it is missing, and what an operator can see about the
configuration that is actually running. The organising idea is that a setting has exactly one
home: a value that can come from two places is a value nobody can be sure of.

### SC-CFG-001 — A setting lives in exactly one place

Not in a file with a fallback in code, and not in a database with a file that seeds it. Both of
those are a single source of truth with a footnote.

_Source:_ #217

### SC-CFG-002 — Settings with a money or a legal consequence live in the configuration file

Where a change goes through review and a deployment. For a value changed twice a year the
deployment is not friction — it is the review, and version control answers "who changed the notice
period, when, and why" better than an audit table does. Delivered for the notice period and the
self-service plan blocks; the settings still passed in code move in later steps.

_Source:_ #217

### SC-CFG-016 — A setting that moved out of code is removed, not deprecated

An installation that still passes it in code does not start, and is told which file it belongs in.
Accepting it as a fallback would leave two homes, and ignoring it silently is worse still: the
value an operator set is the one they believe is running, so the application would not fail — it
would work, differently, until a customer's cancellation landed a period late.

_Source:_ #217

### SC-CFG-017 — A required setting is required member by member, not as a block

A block naming only one of two rhythms is refused rather than read as zero for the other. The rule
that a silent default is an invisible decision does not stop at the outermost level of the
document.

_Source:_ #217

### SC-CFG-018 — An empty list and a zero are values an operator wrote, not omissions

"No plan is blocked from self-service" and "there is no notice period" are commercial statements,
and the file says them out loud rather than by leaving a line out.

_Source:_ #217

### SC-CFG-019 — A migration tool reports a setting that moved; it does not delete it

The value is a term somebody agreed. Removing it from the code without writing it into the file
would leave the installation running on whatever the file happens to say — the failure the move
exists to prevent, committed by the tool meant to perform it. What makes reporting safe rather
than lax is [SC-CFG-016](#sc-cfg-016--a-setting-that-moved-out-of-code-is-removed-not-deprecated):
the boot refusal means the report cannot be acted on halfway.

_Source:_ #217

### SC-CFG-003 — A setting that must change without a deployment is kept out of the file entirely

And lives in one audited place instead of two. Adding a second home is what this rule exists to
prevent.

_Source:_ #217

### SC-CFG-004 — Payment credentials are never in a committed file and never in a table

They come from the environment.

_Source:_ #217

### SC-CFG-005 — A missing required setting stops the installation, naming the file and the field

A silent default is also a decision, just an invisible one.

_Source:_ #217 · `docs/reference/options.md`

### SC-CFG-006 — A misconfigured installation is told everything that is wrong at once

Each problem named and linked to what it means. Fixing them is one restart, not one per line.

_Source:_ `docs/reference/options.md`

### SC-CFG-007 — A capability that is turned off says so, once, at start-up

A capability that vanishes without a word is indistinguishable from a bug in the integrator's own
code.

_Source:_ ADR 0007

### SC-CFG-008 — An operator can see when the running configuration was applied, and from where

Somebody who edited the file an hour ago otherwise has no way to tell whether it has landed. The
timestamp is the requirement, not decoration. 🟡 _(Decided, not yet delivered.)_

_Source:_ #217

### SC-CFG-009 — A configuration change is noticed and reported

The record inside the application is unconditional; notifying people by mail is an addition, never
a substitute. An address list that silently swallowed the notification because nobody wired mail
would be worse than having neither. 🟡 _(Decided, not yet delivered.)_

_Source:_ #217

### SC-CFG-010 — An installation that declares a protection and enforces nothing does not start

Where routes are annotated as requiring a feature and nothing is checking it, the installation
refuses to boot and names the routes. Otherwise the routes answer, the limits read as unlimited,
and the first signal is a customer using something they never bought. A protection the integrator
wrote themselves counts, once they say it is one — recognition is by declaration, not by the class
being named the same as ours.

_Source:_ `docs/guides/upgrade-to-1.0.md` · release 0.27.0

### SC-CFG-011 — An application that declares nothing to enforce still starts

A catalogue with no runtime enforcement is a real shape, not a mistake.

_Source:_ release 0.27.0

### SC-CFG-012 — Conflicting routes stop the boot

Rather than one quietly shadowing the other and an operator discovering it from a support ticket.

_Source:_ `docs/guides/integrate-into-an-existing-app.md`

### SC-CFG-013 — A generated application does not compile until the integrator names their access rules

An empty list is this platform's word for "deliberately open", so scaffolding one would have left
the discovery and manifest endpoints answering to anybody.

_Source:_ release 0.27.0

### SC-CFG-014 — An installation whose own tables are named differently keeps its administration

The mapping is configuration, not a reason to turn the administration off wholesale.

_Source:_ release 0.27.0

### SC-CFG-015 — Set-up commands print what they wrote, with the values and the path

So the first thing a new integrator learns is where their settings live, rather than discovering
it when one is wrong.

_Source:_ #217

## 17. Accessibility

Accessibility is part of what SaaSiCat delivers, not a pass over it afterwards. The requirements
below are the ones a person actually notices: whether they can read the text, whether they can
reach the control, and whether the information survives being seen without colour. They apply in
both the light and the dark theme, because a screen that only works in one of them works for half
the people using it.

### SC-A11Y-001 — Text is legible in both themes

Contrast is measured on every shipped screen, in light and in dark. The floor is not a target: it
is the line below which text is not hard to read but gone.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-002 — Meaningful visuals stand out from what is next to them

Icons, control edges, status marks and chart elements are distinguishable from their surroundings
at no less than 3:1, and body text at no less than 4.5:1.

_Source:_ `docs/explanation/design-guide.md` · internal engineering guidelines

### SC-A11Y-003 — A colour used as a fill is not the same colour used as text

A status colour tuned to be read against the page goes lighter in the dark theme; the same value
used as a background with white text on it drops to 1.67:1. Each tone therefore has both roles,
and text on a filled surface stays legible in both themes.

_Source:_ release 1.0.0-rc.6

### SC-A11Y-004 — Every control can be reached and operated from the keyboard

A row that opens is a button, not an area that happens to respond to a click. Four of the eight
expandable surfaces this replaced could not be reached or announced at all, and a search for the
attribute that announces them returned nothing.

_Source:_ #133 · `docs/explanation/design-guide.md`

### SC-A11Y-005 — Focus stays visible

An outline is never removed without something equivalent put in its place.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-006 — Information is never carried by colour alone

A state signalled by colour is also signalled by an icon, a label or a description.

_Source:_ internal engineering guidelines

### SC-A11Y-007 — An icon that carries meaning has a name that can be announced

An icon is not text, and a control that is only an icon needs a label beside it or attached to it.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-008 — Each screen has one heading that names it, and every section is labelled

A section without a title is left unlabelled rather than given an empty name, because an unnamed
landmark is worse than none.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-009 — Motion respects a person who has asked for less of it

Including the animations SaaSiCat draws itself rather than borrows.

_Source:_ #206

### SC-A11Y-010 — Wide content scrolls rather than being cut off

A table that does not fit is reachable sideways; it is not clipped at the edge of the screen.

_Source:_ release 0.24.2

### SC-A11Y-011 — A dialog does not stack on top of itself

One overlay per screen, not one per row, so focus is never trapped behind something a person
cannot see.

_Source:_ release 1.0.0-rc.0

### SC-A11Y-012 — Where a screen cannot meet the floor, the exception is named with its reason

And it stops being accepted once it no longer describes anything real.

_Source:_ `docs/explanation/design-guide.md`

## 18. Language and wording

Two audiences read SaaSiCat's text, and they are owed different things. A tenant reads it in the
language they chose. An integrating developer reads diagnostics, and those stay in one language on
purpose. This chapter also fixes what a refusal is: a code that does not change, and a wording
that may.

### SC-LANG-001 — A person reads the interface in the language they chose

They can change it from the shell, on the sign-in card and during first-run set-up, and the choice
is remembered and outranks whatever the installation configured.

_Source:_ #45 · #47 · release 0.16.0

### SC-LANG-002 — The admin interface falls back to English, the backend to German

Two answers to one question, and knowing which applies where matters: the shipped interface uses
English when nothing else is named, while several backend routes — registration and the public
price list among them — default to German. An installation that names its language everywhere
never meets the difference; one that relies on the default meets it as a screen in two languages.

_(Documented as it stands. One default for both belongs in a breaking change, because moving
either of them changes what an existing installation renders.)_

_Source:_ `docs/guides/upgrade-to-1.0.md` · current practice

### SC-LANG-003 — Which languages an application offers is the application's decision

SaaSiCat ships two complete ones and lets an installation narrow that set or add its own. A
language added by an installation is usable from its first translated key onwards, falling back
for the rest.

_Source:_ release 0.17.0

### SC-LANG-004 — A missing translation is never an empty line

Text a reader's own catalogue does not know falls back to the shipped English rather than
disappearing, and never to a bare internal code.

_Source:_ #243 · release 0.19.0

### SC-LANG-005 — Every string on a screen follows the language that was chosen

Including the ones assembled from parts. An installation that added a third language got a shell
in that language with thirty-four sentences stranded in another.

_Source:_ release 0.18.0

### SC-LANG-006 — Text a customer reads carries its values beside its code, not inside a sentence

A sentence with the numbers baked into it cannot be rebuilt in another language by anyone
downstream. A tenant read "Current usage 11 exceeds the target limit 5" in English whatever
language they had chosen, and no integrator could reach it.

_Source:_ #243

### SC-LANG-007 — A refusal code never encodes its own subject

The subject travels as a value beside the code. Building a code out of the quota or the plan it is
about made the set of codes grow with every quota an installation defines, so no catalogue of
translations could ever be complete.

_Source:_ #243

### SC-LANG-008 — A refusal is identified by a stable code; only its wording may change

The code is the contract. Renaming or removing one is a breaking change; rewording its text is
not, and which group a code is listed under is presentation only.

_Source:_ `docs/reference/error-codes.md`

### SC-LANG-009 — An integrator resolves their own refusals and SaaSiCat's through one mechanism

An integrator's catalogue is mostly their own text, not a re-translation of the platform's, and
resolving both through one path is the reason the mechanism exists.

_Source:_ #244

### SC-LANG-010 — Diagnostics an integrator reads are English and are not translated

Boot failures, log lines and console messages are read by the person integrating SaaSiCat, and one
language is what makes them searchable. Translating them once put the platform's internal wording
on a tenant's screen instead of the catalogue's.

_Source:_ #150 · release 0.19.0

### SC-LANG-011 — Everything that ships is written in English

Code, comments, documentation, developer-facing errors, release notes and the command-line tools.

_Source:_ #150 · release 0.22.0

### SC-LANG-012 — SaaSiCat carries no vocabulary from anybody's business

Shipped example text is neutral; an installation supplies its own wording for its own domain.

_Source:_ release 0.17.0

### SC-LANG-013 — A message says what to do next, not only what went wrong

A locked verification says to request a new code; a missing setting names the file and the field;
a refused booking names the plan and the rhythm it could not price.

_Source:_ `docs/reference/error-codes.md` · `docs/reference/options.md`

## 19. Security and keeping tenants apart

The requirements here are stated from the tenant's side, because that is who bears the cost. Some
of them are things SaaSiCat does; several are things the installation has to do around it, and
those are stated as plainly as the rest, because a property that depends on a deployment is not a
property until the deployment provides it.

### SC-SEC-001 — A tenant never sees another tenant's data

Under no circumstances, and not because a screen filtered it out.

_Source:_ `docs/explanation/data-model.md`

### SC-SEC-002 — Which tenant a request belongs to is derived from the authenticated session

Never from a value the caller supplied.

_Source:_ `docs/explanation/data-model.md` · internal engineering guidelines

### SC-SEC-003 — Reads that legitimately cross tenants are named as the exceptions they are

Platform-wide counts an operator needs are the documented exception; everything else is scoped.
Administration acts on behalf of the platform rather than of a tenant, which is why they are the
only reads that step outside a tenant's boundary.

_Source:_ `docs/explanation/data-model.md`

### SC-SEC-004 — Every decision that matters is made where the request is served

The interface hides what would be refused. It is not what does the refusing.

_Source:_ `docs/guides/build-the-admin-frontend.md`

### SC-SEC-005 — Data arriving from outside is validated at the boundary

Requests, external systems and files are checked where they enter; code inside the boundary is
trusted.

_Source:_ internal engineering guidelines

### SC-SEC-006 — An installation must terminate traffic at a proxy it controls

Rate limits identify a caller from a header a client can set. Without a proxy that overwrites it,
an attacker rotates identities and defeats every limit on sign-in, registration, code resends and
promotional codes.

_Source:_ `SECURITY.md`

### SC-SEC-007 — Rate limits are per process and reset on restart

An installation running several instances multiplies every limit it configured. They are a
throttle, not a lockout, and an installation that needs the stronger property provides it itself.

_Source:_ `SECURITY.md`

### SC-SEC-008 — The setup token is a bootstrap secret and is removed once bootstrapping is done

Anyone holding it before the first administrator exists can take the installation over.

_Source:_ `SECURITY.md`

### SC-SEC-009 — Checks run in a fixed order and fail closed

A check that expects an authenticated caller refuses rather than passing when the step before it
did not run.

_Source:_ `SECURITY.md`

### SC-SEC-010 — A vulnerability is reported privately and never described in public

Not in an issue, a pull request, a commit message or a release note. A fix may still be published;
its description must not double as instructions.

_Source:_ `SECURITY.md`

### SC-SEC-011 — Security fixes go to the newest release line, and all packages move together

_Source:_ `SECURITY.md`

### SC-SEC-012 — A new dependency's licence is part of the decision to add it

A copyleft dependency would conflict with the terms SaaSiCat is distributed under, and the
conflict is only discoverable by reading. Where it is unclear, it is raised rather than added.

_Source:_ ADR 0001

## 20. What is kept, and what is never written down

Two questions a tenant and an operator both eventually ask: what does this system record about me,
and what does it throw away. The requirements below answer them, and one of them constrains
SaaSiCat itself — a record that survives has to be one that is safe to keep.

### SC-PRIV-001 — Nothing that could cause harm is written to a log

No passwords, tokens, keys, session secrets or complete sensitive payloads, and no personal data
beyond what a diagnosis needs. A production failure needs context, not secrets.

_Source:_ internal engineering guidelines

### SC-PRIV-002 — A network address is recorded as a fingerprint, never in the clear

In the anti-abuse trail and in the record of registration steps alike.

_Source:_ release 1.0.0-rc.7

### SC-PRIV-003 — Passwords and verification codes cannot be read back out of storage

_Source:_ release 1.0.0-rc.7

### SC-PRIV-004 — The record of a registration carries no address, password or code in the clear

Recording the address would make the trail itself a way to find out who has an account.

_Source:_ release 1.0.0-rc.7

### SC-PRIV-005 — Payment details are kept masked

SaaSiCat records how a tenant would pay, not enough to pay as them.

_Source:_ `docs/explanation/data-model.md`

### SC-PRIV-006 — A record that history depends on is retired, not deleted

Plans, add-ons, promotional codes and catalogue entries are withdrawn from use and kept. Only an
unpublished draft is removed outright.

_Source:_ `docs/explanation/data-model.md`

### SC-PRIV-007 — An abandoned registration is removed rather than kept in a reduced form

The address it holds is exactly the thing that has to become usable again.

_Source:_ release 1.0.0-rc.7

### SC-PRIV-008 — Failed attempts are part of the record, not only successful ones

_Source:_ `docs/explanation/data-model.md`

### SC-PRIV-009 — A migration that would destroy data stops and says what it found

Rather than merging rows nobody meant to merge, or discarding them. Which of two colliding records
survives is not a decision a migration takes on its own.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-PRIV-010 — History is not rewritten

A period a tenant was already billed for is left as it stands, even by a correction that would
otherwise be tidier. Rewriting it changes what the record says happened.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

## 21. Answering the question afterwards

Prices change, plans are republished, entitlements move. This chapter is about being able to
answer, months later, what was true at a particular moment and who made it so. It is what turns a
dispute into a lookup.

### SC-AUD-001 — Every administrative action records who did it, from where, and when

Including actions taken from a command line rather than a browser, in a form that says which of
the two it was.

_Source:_ `docs/explanation/data-model.md`

### SC-AUD-002 — An action that belongs to no single tenant says so

Platform-wide acts are distinguishable from acts on one tenant, rather than looking like an entry
whose tenant went missing. An action nobody triggered — a scheduled job — is likewise
distinguishable from one a person took.

_Source:_ `docs/explanation/data-model.md`

### SC-AUD-003 — Every change to a subscription is recorded with what it was before and after

Plan changes, scheduled changes, activations, accepted versions and cancellations.

_Source:_ release 1.0.0-rc.6

### SC-AUD-004 — A failure to record something never blocks the act itself

A gap in the record is better than an outage for the tenant. Where no recording is configured at
all, the platform skips it rather than failing — a deliberate degradation for the smallest
installations.

_Source:_ release 1.0.0-rc.6

### SC-AUD-005 — Serious actions are marked as serious

Suspending a tenant, acting as one, publishing or ending a plan version, cancelling a
subscription, deactivating a user and handing over administrative rights are all findable as the
weighty acts they are.

_Source:_ release 1.0.0-rc.6

### SC-AUD-006 — The record can be searched by who, what, which object and since when

And it hands back a bounded page rather than everything at once.

_Source:_ release 1.0.0-rc.0

### SC-AUD-007 — What a customer bought is frozen at purchase

A plan change creates a new agreement and keeps the old one. Nothing rewrites what was agreed.

_Source:_ `docs/explanation/concepts.md` · `docs/explanation/capability-to-contract.md`

### SC-AUD-008 — A published version stays readable for as long as anything references it

So the question "what did this customer actually buy" always has an answer.

_Source:_ `docs/explanation/data-model.md`

### SC-AUD-009 — What a promotional code promised at redemption stays with the redemption

_Source:_ `docs/explanation/data-model.md`

### SC-AUD-010 — A charge names where it came from and which agreement line it belongs to

Activation, renewal, a prorated plan change, an add-on booking, a credit — so an account can be
walked back to what was agreed. 🟡 _(Decided, not yet delivered.)_

_Source:_ #214

### SC-AUD-011 — A charge carries the period it belongs to

Which charges belong on one invoice has to be derivable, and a set of individually booked amounts
with no grouping leaves that to guesswork. 🟡 _(Decided, not yet delivered.)_

_Source:_ #214

## 22. Repeating an operation safely

Deployments fail and get retried; containers restart; a pipeline step is run again. This chapter
is written from the operator's side and says what they can repeat without holding their breath.
The requirement behind all of it: SaaSiCat keeps no ledger of which migrations have run, so every
one of them has to be safe to run twice.

### SC-OPS-001 — An operator can retry a failed deployment

Every shipped migration applied a second time either does nothing, or refuses with a sentence
saying why. Never an unexplained database error, and never a second application of the same
effect. This exists because it happened: a migration dropped a column, the next container start
asked that column for its values, and the message named the column rather than the retry.

_Source:_ `CONTRIBUTING.md`

### SC-OPS-002 — A migration is safe on a partially adopted schema

An installation that never took a particular table migrates the ones it does have, instead of
rolling the whole thing back.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-003 — An operator can list what a migration will touch before running it

Every migration that changes rows ships with the query that shows which ones.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-004 — A destructive step is preceded by a check, not by turning the safety off

Adding a flag that lets a tool discard data would arm every future change to do the same without
being asked.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-005 — A tool that cannot finish stops before it changes anything

Where the advice it prints is only followable while the change is unapplied, it does not apply
half of it first.

_Source:_ release 0.27.0

### SC-OPS-006 — Applying the same external event twice changes nothing

Payment providers retry, and a retry must not produce a second account or a second charge.

_Source:_ `docs/explanation/data-model.md`

### SC-OPS-007 — Repeating an action a person took changes nothing either

Cancelling twice, accepting the same pending version twice, ending an already-ended contract —
each reports the state that already holds instead of creating a second effect.

_Source:_ release 1.0.0-rc.6

### SC-OPS-008 — A scheduled job that has not run for months catches up in one step

Not one step per missed period, and not by walking forward one period at a time until it arrives
at today.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-009 — Periods advance when the operator's own job runs them, never behind their back

SaaSiCat decides what the next period should be; writing it is the integrator's scheduled job. An
installation that never runs it loses nothing it had — the next period is simply never opened.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-010 — An installation starts, or refuses; it does not start half-configured

_Source:_ `docs/reference/options.md`

### SC-OPS-011 — Dates are handled with their time zone stated, not inferred

Server time, browser time and the tenant's own time are three different things, and a billing date
is one of the places where confusing them costs money.

_Source:_ internal engineering guidelines

## 23. Compatibility and upgrading

What an integrating developer may expect when they raise a version. The whole chapter is one
promise with several consequences: a break is deliberate, announced, and accompanied by whatever
can be automated — and where it cannot be automated, it is named rather than guessed at.

### SC-COMP-001 — All packages carry one version number and move together

There is no compatibility matrix to reason about; a mixed set is a misconfiguration.

_Source:_ `CONTRIBUTING.md` · `README.md`

### SC-COMP-002 — A break is deliberate, documented, and belongs to a release that says it is breaking

It is never something a consumer discovers from a failing build after a patch release.

_Source:_ `CONTRIBUTING.md`

### SC-COMP-003 — There is one deliberate break on the way to 1.0, and one guide for it

A single coordinated cut with a migration guide and a command that performs most of it, rather
than a long tail of deprecations.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-COMP-004 — The upgrade command reports what it cannot decide rather than guessing

A tool that guessed would occasionally delete a declaration of the integrator's own, and they
would find out later. It errs towards leaving work rather than removing theirs.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-COMP-005 — A step no command can take is named as a step the operator takes

The change to the integrator's own database is shipped as a file they run once, and the guide says
so rather than implying the command covered it.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-COMP-006 — An identifier a consumer may have written down is not renamed again

The names an application injects into SaaSiCat are part of the runtime contract. They were renamed
once, at 1.0, and that rename is part of what the major version paid for.

_Source:_ ADR 0002 · `CONTRIBUTING.md`

### SC-COMP-007 — A change that would otherwise be silent breaks the integrator's build instead

Where an integrator supplies their own data access, a new fact the platform depends on is required
rather than optional. An implementation that omitted the two cancellation dates could not tell a
subscription that ends next January from one that ended last January, and the quiet answer is that
it keeps everything.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-COMP-008 — An implementation offers only what it can actually answer

Declaring an operation and then failing inside it turned a recoverable fallback into a server
error on three tenant-facing routes. Where the underlying store cannot answer, the operation is
absent and the platform falls back.

_Source:_ release 1.0.0-rc.7

### SC-COMP-009 — Shipped source stays within a language level an integrator's toolchain can read

Their compiler reads it, not SaaSiCat's. Raising that floor breaks consumers below it and is a
deliberate, announced change — never a way to make a build pass.

_Source:_ `CONTRIBUTING.md`

### SC-COMP-010 — An integrator's own data access translates; it does not decide

Domain rules live above the storage layer, which is what keeps two implementations
interchangeable. An implementation that decides something — filtering on its own, defaulting a
status — moves a rule to where the other one does not have it.

_Source:_ ADR 0007

### SC-COMP-011 — Every data-access implementation is held to the same executable contract

Against a real database, covering the behaviours that only appear under concurrency. "Atomic"
means four different things to four implementations, and prose could not settle it.

_Source:_ ADR 0007

### SC-COMP-012 — Where one implementation cannot do what another can, the gap is recorded

Deliberately, rather than widened quietly and discovered by whoever chose the lagging one.

_Source:_ ADR 0007

### SC-COMP-013 — An installation whose store cannot hold a limit exactly does not start the enforcement

Enforcing a limit needs a store that can serialise a count and a write. An installation whose
store says it cannot is told at start-up rather than at the moment two customers slip past a
limit.

_Source:_ `docs/reference/options.md`

### SC-COMP-014 — The example application is kept in step with the platform

It is what an integrator copies from, and an outdated example teaches the wrong integration to
everyone who reads it.

_Source:_ `docs/explanation/test-coverage.md`

### SC-COMP-015 — A public interface is changed only after its consumers have been checked

Reusable components, exported types, configuration formats and extension points reach real
applications. Additive is preferred; a break is intentional and reflected in the release notes.

_Source:_ internal engineering guidelines

## 24. Being understandable to a stranger

SaaSiCat is read by people who did not build it and cannot ask anyone. That makes
comprehensibility a property of the product rather than a courtesy: what is not in the code or the
documentation does not exist for the reader. The requirements here are what that costs.

### SC-READ-001 — Someone deciding whether to depend on SaaSiCat can judge what is tested

By name and by what a failure would cost, not by a percentage. A number is not a risk assessment.

_Source:_ `docs/explanation/test-coverage.md`

### SC-READ-002 — A gap is named rather than papered over

Where a property cannot be checked automatically, that is said plainly instead of prose being
presented as enforcement.

_Source:_ `docs/explanation/test-coverage.md` · internal engineering guidelines

### SC-READ-003 — A statement about the software is part of it

A comment, a release note or a documentation sentence that is wrong is worse than none: it sends
the next reader off with a false premise. A release note is worse still, because after publication
it cannot be corrected.

_Source:_ internal engineering guidelines

### SC-READ-004 — An architectural decision records what breaks if it is ignored

Not only what was decided and why, but what a reader will experience if they do something else.

_Source:_ ADR 0001 to ADR 0011

### SC-READ-005 — The product has one spelling of its own name

A reader who meets a second spelling has no way to tell a different product from an unfinished
rename.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-READ-006 — A reference a reader cannot follow is not made

Every link into this repository resolves, and link text says what it leads to. Pointing at a
document only the original team can open implies a rule exists somewhere and hides where — two
such citations had reached error messages an operator could read.

_Source:_ internal engineering guidelines

### SC-READ-007 — Reference documentation is generated from the implementation

The list of refusal codes and the list of configuration rules are derived from the code that
implements them, so they cannot drift into describing something that is no longer true.

_Source:_ `docs/reference/error-codes.md` · `docs/reference/options.md`

### SC-READ-008 — There is one way to do each thing, not two right answers

One way to mount a screen, one spelling of a name, one place a setting lives. Where a reader can
see two correct-looking options and no rule saying which is meant, that is a defect in the
product, not a matter of taste.

_Source:_ ADR 0008 · #217
