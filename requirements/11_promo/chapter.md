---
title: Promotional codes
---

A promotional code is a discount an operator can hand out without a developer. The requirements
here are mostly limits: what a code may promise, how often it may be used, and what happens when
two people redeem the last one at the same moment. The last group exists because a discount that
half-applies is worse than none.

### SC-PROMO-001 — A code is redeemed at most once per subscription

🟢 Reversing a redemption releases the slot back to the code.

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-002 — A code with a redemption limit cannot be over-redeemed

🟢 However many people try at the same moment. It closes itself once it is full.

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-003 — A redemption limit can be raised, never lowered

🟢 Lowering it would retroactively invalidate redemptions that already happened.

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-004 — A code that has been redeemed is never deleted; it is paused

🟢 The redemptions reference it, and a customer's discount has to remain explicable.

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-005 — A percentage discount is between 0 and 100

🟢

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-006 — A discount runs for at most 24 months or billing periods

🟢

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-007 — A one-off discount carries no duration and applies to the first invoice only

🟢 The regular price applies from the second period. The two forms are alternatives, and a code
claiming both describes nothing.

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-008 — An absolute discount stays below the lowest price it can apply to

🟢 Both when the code is created and when it is redeemed, unless the operator deliberately allows an
invoice of zero. Otherwise a code quietly makes a plan free.

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-009 — A plan may be marked as not discountable

🟢 A code cannot be created for it and never validates against it.

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-010 — A code is for first-time customers unless the operator says otherwise

🟢 💰 That is the default, because it is the common case and the expensive mistake is the other way
round.

_Source:_ release 1.0.0-rc.7

### SC-PROMO-011 — Redeeming a code applies the discount and records the redemption, or does neither

🟢 💰 Half-applying it leaves a customer with a discount nobody recorded, or a record of one they
never received.

_Source:_ `docs/reference/options.md`

### SC-PROMO-012 — A code only applies to a subscription belonging to the person redeeming it

🟢 💰

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-013 — A code works whatever case the customer typed it in

🟢

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-014 — A code is 4 to 32 characters of upper-case letters, digits, hyphen and underscore

🟢

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-015 — What a code promised when it was redeemed stays with the redemption

🟢 Later edits to the code do not change what a customer already got.

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-016 — A code past its validity stops working without anybody having to run anything

🟢 It is retired both on a schedule and on the next time somebody asks about it.

_Source:_ release 1.0.0-rc.7

### SC-PROMO-017 — Failed attempts are recorded as well as successful ones

🟢 Guessing at codes leaves a trail.

_Source:_ `docs/explanation/data-model.md`

### SC-PROMO-018 — Guessing at codes is rate-limited, per address and per session

🟢 Checking a code needs no account, so the limit is what stands between a public endpoint and
somebody enumerating the campaign.

_Source:_ release 1.0.0-rc.7

### SC-PROMO-019 — A first-time-only code needs a way to answer who is a first-time customer

🟢 An installation offering one publicly without that answer would show every such code as
unavailable, which is worse than not offering it.

_Source:_ `docs/reference/options.md`

### SC-PROMO-020 — The amount in a discount summary is formatted in the audience's language

🟢 Not in one the platform picked. A German product's customers read "25 % once" in checkout because
the number formatting and the words had been decided separately.

_Source:_ #105

### SC-PROMO-021 — A language the runtime cannot serve is refused rather than quietly replaced

🟢 A well-formed typo would otherwise fall back to the runtime's own default, and an amount would
reach the customer formatted in a language nobody chose.

_Source:_ #105

### SC-PROMO-022 — Creating, changing and removing a code is recorded

🟢

_Source:_ release 1.0.0-rc.7
