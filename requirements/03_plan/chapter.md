---
title: Plans and their versions
---

A plan is the thing a customer chooses; a version of it is the offer they actually bought. Almost
every requirement here exists to protect one promise: what a customer was sold does not change
underneath them. That is why a published version freezes once it applies, why a version somebody is
bound to cannot be edited, and why nothing published is ever deleted.

### SC-PLAN-001 — A plan is an identity; a version carries what it costs and includes

🟢 The name a customer recognises stays the same across price changes. What they pay and what they
get belongs to the version they bought.

_Source:_ `docs/explanation/concepts.md`

### SC-PLAN-002 — A plan has at most one unpublished draft at a time

🟢 An operator finishes what they started — publishing or discarding the open draft — before opening
another. Two half-written offers for one plan are a state nobody can explain to a colleague.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-003 — A plan has at most one live version at a time

🟢 Publishing a successor retires its predecessor in the same act, so there is never a moment in
which two versions of one plan are both current and a purchase could land on either.

_Source:_ `docs/explanation/data-model.md`

### SC-PLAN-004 — A published version is never deleted

🟢 A customer bound to a retired version keeps being served and billed by it. That is the whole
reason versions exist, and it is why removing one is not an option even when it is old. Discarding
is refused the moment a version is published — unlike rewriting it, which SC-PLAN-005 leaves open
in one narrow case.

_Source:_ `docs/explanation/data-model.md`

### SC-PLAN-005 — A version somebody has already bought cannot be edited

🟢 Only a draft can be changed, or a published version that is the newest of its line, has nobody on
it, and does not start until some day in the future.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-006 — Where it cannot be established that nobody is on a version, it stays frozen

🟢 The uncertain case is treated as the dangerous one, so a version is never opened for editing on
the assumption that it is unsold.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-007 — Publishing says what changed

🟡 _(Decided, not yet delivered.)_ A version is published with a note describing the change, and an
empty note is refused, because the note is what an operator reads a year later when a customer asks
why their price moved. Today the note is optional in the publish interface and a version carrying
none publishes.

_Source:_ current practice

### SC-PLAN-008 — A price of exactly zero has to be meant

🟢 Publishing a plan version priced at zero is refused unless the operator says explicitly that it is
deliberate. An accidental batch publish at 0.00 once set every tariff to free.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-009 — Publishing something that takes away has to be confirmed

🟢 A version that removes a feature, raises a price or lowers one of the three quotas SC-PLAN-025
names is a change existing customers feel. It publishes only on an explicit confirmation, so it is
never the outcome of a mis-click.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-010 — One regressive change makes the whole version regressive

🟢 A version that improves nine things and lowers one is treated as a change customers feel, because
one of them will.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-025 — Every quota a version carries counts as a limit that can be lowered

🟡 _(Decided, not yet delivered.)_ A plan version is compared on `users`, `vehicles` and `storageGb`
alone, so a quota an installation defines for itself — NotesApp's `notesMax`, for instance — can be
lowered and published without the confirmation SC-PLAN-009 asks for. Add-on versions are already
compared on every quota they carry.

_Source:_ current practice

### SC-PLAN-011 — A published version says which day it applies from

🟢 Each successor starts strictly after the one before it, so for any given day there is exactly one
answer to "what was on offer".

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-012 — There is no gap and no overlap between two versions of a plan

🟢 Where a version states the last day it is valid, its successor starts the next day. A day on which
a plan exists but has no offer is refused rather than discovered by the first customer to land on
it.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-013 — A version is still valid on its own last day

🟢 Validity dates are inclusive, so an offer does not go dark on the day it is advertised until.

_Source:_ `docs/explanation/data-model.md`

### SC-PLAN-014 — A plan that has ever been published is kept

🟢 It may be withdrawn from sale; it is not removed. Subscriptions reference the versions under it,
and the record has to survive them.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-015 — A plan with an open draft is not removed

🟢 The draft is published or discarded first, so no half-written offer disappears without anyone
deciding what it was for.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-016 — A version can be given an end date, and it lies in the future

🟢 Ending a version stops new bookings on it. It does not move anybody who is already on it.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-017 — Publishing happens in the administration, never in a seed

🟢 Data loaded at set-up may create drafts. Turning a draft into an offer is an act an operator
performs and is recorded as having performed.

_Source:_ `docs/explanation/concepts.md`

### SC-PLAN-018 — The version that applies is the one valid on the day of the purchase

🟢 Not the newest one, and not the one the pricing page happened to be showing.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-019 — Two operators cannot publish the same draft

🟢 The second one is told the draft has already been published rather than publishing it again.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-020 — A draft built on a version that has since been retired has to be rebased

🟢 Publishing it as it stands would put an offer live that was written against something no longer
current.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-021 — A plan that is not sold self-service says so and says who to ask

🟢 A tenant meeting a negotiated plan is pointed at the contract manager rather than at a button that
will not work. A plan may also be one that cannot be left by self-service, which is the same idea
in the other direction.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-022 — Everything wrong with an uploaded catalogue is reported at once

🟢 An operator fixing a plan file sees every error in one pass rather than discovering them one round
trip at a time.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-023 — A catalogue that cannot be read is the caller's mistake, not a server failure

🟢 It is answered as a rejected upload rather than as an internal error. A caller cannot otherwise
tell a bad file from a broken server, and the one they can fix is the one that looked unfixable.

_Source:_ `docs/reference/error-codes.md`

### SC-PLAN-024 — The order plans appear in is set by moving them, not by typing numbers

🟢 An operator drags a row, or moves it with the keyboard, and the platform works out the priorities.
Gaps an operator deliberately left are preserved, and a plan with no live version has no handle to
grab, because there is nothing to order.

_Source:_ release 1.0.0-rc.4
