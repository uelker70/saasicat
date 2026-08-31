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

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-admin-controller.test.js`
    - standard promo Admin controller exposes list, create, edit and delete
- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.create — validation
        - accepts a valid code
        - rejects a code with an invalid pattern
        - PERCENT must be 0–100
        - ABSOLUTE must be positive
        - ONCE must not have a durationValue
        - MONTHS / BILLING_CYCLES need 1–24 as durationValue
        - rejects the nonRedeemablePlans whitelist (ENTERPRISE)
        - rejects validUntil ≤ validFrom
        - rejects ABSOLUTE ≥ lowest plan gross without allowZeroInvoice
        - accepts an ABSOLUTE discount ≥ plan gross when allowZeroInvoice=true
        - rejects a duplicate code

<!-- END proof -->

### SC-PROMO-002 — A code with a redemption limit cannot be over-redeemed

🟢 However many people try at the same moment. It closes itself once it is full.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-code-pattern.test.js`
    - the code pattern carries exactly the declared bounds
- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.create — validation
        - accepts a valid code
        - rejects a code with an invalid pattern
        - PERCENT must be 0–100
        - ABSOLUTE must be positive
        - ONCE must not have a durationValue
        - MONTHS / BILLING_CYCLES need 1–24 as durationValue
        - rejects the nonRedeemablePlans whitelist (ENTERPRISE)
        - rejects validUntil ≤ validFrom
        - rejects ABSOLUTE ≥ lowest plan gross without allowZeroInvoice
        - accepts an ABSOLUTE discount ≥ plan gross when allowZeroInvoice=true
        - rejects a duplicate code

<!-- END proof -->

### SC-PROMO-003 — A redemption limit can be raised, never lowered

🟢 Lowering it would retroactively invalidate redemptions that already happened.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.create — validation
        - accepts a valid code
        - rejects a code with an invalid pattern
        - PERCENT must be 0–100
        - ABSOLUTE must be positive
        - ONCE must not have a durationValue
        - MONTHS / BILLING_CYCLES need 1–24 as durationValue
        - rejects the nonRedeemablePlans whitelist (ENTERPRISE)
        - rejects validUntil ≤ validFrom
        - rejects ABSOLUTE ≥ lowest plan gross without allowZeroInvoice
        - accepts an ABSOLUTE discount ≥ plan gross when allowZeroInvoice=true
        - rejects a duplicate code

<!-- END proof -->

### SC-PROMO-004 — A code that has been redeemed is never deleted; it is paused

🟢 The redemptions reference it, and a customer's discount has to remain explicable.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/reorder-priorities.test.js`
    - a move within equal priorities produces the order it promises
    - it keeps the gaps an operator chose
    - rows that keep their value are reported as unchanged
    - no move, no writes
    - a value at the top of the range stays inside it
    - a list already at the ceiling still separates
    - pulling ties apart never goes below zero
    - a move to the end lands at the end

<!-- END proof -->

### SC-PROMO-005 — A percentage discount is between 0 and 100

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-admin-controller.test.js`
    - standard promo Admin controller exposes list, create, edit and delete
- `packages/ui-vue/tests/component/promo-code-dialogs.test.ts`
    - passes the entered values through to submit
    - reopening starts from an empty form
    - does not submit while the code is malformed
    - keeps a handler error inside the dialog
    - adopts the row values into the form
    - sends nothing while nothing has changed
    - sends only the changed fields, with the row id
    - keeps a handler error inside the dialog
    - create: typing into the code field lands upper-cased in the form
    - create: the random button fills a valid code
    - edit: the code field shows the code and is disabled
    - the status switch appears on edit only
    - the plan picker writes into the dialog form

<!-- END proof -->

### SC-PROMO-006 — A discount runs for at most 24 months or billing periods

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-public-controller.test.js`
    - preview passes code/plan/billingCycle 1:1 through to the service
    - preview passes email + ipHash + sessionId through to the service
    - preview forwards invalid response 1:1
    - preview works without an authenticated user (sessionId undefined)
    - rate limit 429 carries retryAfterSeconds of the IP window
    - rate limit 429 carries retryAfterSeconds of the session window
- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.preview — eligibility
        - NOT_FOUND when no code exists
        - PLAN_MISMATCH when the whitelist excludes the plan
        - PLAN_MISMATCH on nonRedeemable (ENTERPRISE)
        - NOT_FIRST_TIME_CUSTOMER with firstTimeCustomersOnly + an existing customer
        - valid=true with price preview for PROFESSIONAL/YEARLY/25%

<!-- END proof -->

### SC-PROMO-007 — A one-off discount carries no duration and applies to the first invoice only

🟢 The regular price applies from the second period. The two forms are alternatives, and a code
claiming both describes nothing.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.preview — eligibility
        - NOT_FOUND when no code exists
        - PLAN_MISMATCH when the whitelist excludes the plan
        - PLAN_MISMATCH on nonRedeemable (ENTERPRISE)
        - NOT_FIRST_TIME_CUSTOMER with firstTimeCustomersOnly + an existing customer
        - valid=true with price preview for PROFESSIONAL/YEARLY/25%

<!-- END proof -->

### SC-PROMO-008 — An absolute discount stays below the lowest price it can apply to

🟢 Both when the code is created and when it is redeemed, unless the operator deliberately allows an
invoice of zero. Otherwise a code quietly makes a plan free.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.preview — eligibility
        - NOT_FOUND when no code exists
        - PLAN_MISMATCH when the whitelist excludes the plan
        - PLAN_MISMATCH on nonRedeemable (ENTERPRISE)
        - NOT_FIRST_TIME_CUSTOMER with firstTimeCustomersOnly + an existing customer
        - valid=true with price preview for PROFESSIONAL/YEARLY/25%

<!-- END proof -->

### SC-PROMO-009 — A plan may be marked as not discountable

🟢 A code cannot be created for it and never validates against it.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding with promoCode + PromoCodesService redeems atomically
- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.redeem — eligibility
        - enforces firstTimeCustomersOnly also at the final redeem with email
        - blocks firstTimeCustomersOnly at the final redeem without email, fail-closed
        - lets firstTimeCustomersOnly be redeemed for a first-time customer

<!-- END proof -->

### SC-PROMO-010 — A code is for first-time customers unless the operator says otherwise

🟢 💰 That is the default, because it is the common case and the expensive mistake is the other way
round.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.redeem — eligibility
        - enforces firstTimeCustomersOnly also at the final redeem with email
        - blocks firstTimeCustomersOnly at the final redeem without email, fail-closed
        - lets firstTimeCustomersOnly be redeemed for a first-time customer

<!-- END proof -->

### SC-PROMO-011 — Redeeming a code applies the discount and records the redemption, or does neither

🟢 💰 Half-applying it leaves a customer with a discount nobody recorded, or a record of one they
never received.

_Source:_ `docs/reference/options.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - PromoCodesService.redeem — eligibility
        - enforces firstTimeCustomersOnly also at the final redeem with email
        - blocks firstTimeCustomersOnly at the final redeem without email, fail-closed
        - lets firstTimeCustomersOnly be redeemed for a first-time customer

<!-- END proof -->

### SC-PROMO-012 — A code only applies to a subscription belonging to the person redeeming it

🟢 💰

_Source:_ `docs/reference/error-codes.md`

### SC-PROMO-013 — A code works whatever case the customer typed it in

🟢

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/promotion-helpers.test.js`
    - active within the window
    - scheduled before validFrom
    - expired after validTo
    - highest priority wins on overlap
    - onlyLocales filters
    - billingCycle filters
    - requiresCoupon promotions are not selected automatically
    - non-matching plan → null
    - targetType filters bundle promotions separately from plan promotions
    - percent
    - amount
    - amount clamps at 0
    - intro
    - freeMonths
    - null when promotion is missing
- `packages/nest/tests/promo-calculator.test.js`
    - round2 rounds to two decimal places
    - grossFromNet adds VAT
    - computeIncludedVat extracts VAT from gross
    - computeDiscountGross PERCENT 25%
    - computeDiscountGross ABSOLUTE 30 EUR
    - computeDiscountGross accepts a Prisma decimal string
    - computeDiscountedGross subtracts
    - addCycles MONTHLY +3
    - addCycles YEARLY +2
    - computeRegularStartsAt ONCE → one period
    - computeRegularStartsAt MONTHS 6
    - computeRegularStartsAt BILLING_CYCLES 2 (YEARLY)
    - buildLabel ONCE PERCENT
    - buildLabel MONTHS 6 ABSOLUTE
    - buildLabel BILLING_CYCLES 1 YEARLY → "for the first year"
    - buildLabel MONTHS 1 → singular
    - buildLabel without options keeps the de-DE/EUR output it always had
    - buildLabel formats the amount in the given locale
    - buildLabel formats the percentage in the given locale
    - buildLabel uses the given currency, symbol and decimals
    - buildLabel ignores the currency for percentage codes
    - buildLabel keeps non-breaking spaces out of the label
    - buildLabel rejects an unusable locale instead of guessing one
    - but an unknown region on a known language is not unusable
    - buildLabel does not police the currency, and says why
    - and a percentage ignores the currency, as its option says

<!-- END proof -->

### SC-PROMO-014 — A code is 4 to 32 characters of upper-case letters, digits, hyphen and underscore

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/promotion-helpers.test.js`
    - active within the window
    - scheduled before validFrom
    - expired after validTo
    - highest priority wins on overlap
    - onlyLocales filters
    - billingCycle filters
    - requiresCoupon promotions are not selected automatically
    - non-matching plan → null
    - targetType filters bundle promotions separately from plan promotions
    - percent
    - amount
    - amount clamps at 0
    - intro
    - freeMonths
    - null when promotion is missing
- `packages/nest/tests/promo-calculator.test.js`
    - round2 rounds to two decimal places
    - grossFromNet adds VAT
    - computeIncludedVat extracts VAT from gross
    - computeDiscountGross PERCENT 25%
    - computeDiscountGross ABSOLUTE 30 EUR
    - computeDiscountGross accepts a Prisma decimal string
    - computeDiscountedGross subtracts
    - addCycles MONTHLY +3
    - addCycles YEARLY +2
    - computeRegularStartsAt ONCE → one period
    - computeRegularStartsAt MONTHS 6
    - computeRegularStartsAt BILLING_CYCLES 2 (YEARLY)
    - buildLabel ONCE PERCENT
    - buildLabel MONTHS 6 ABSOLUTE
    - buildLabel BILLING_CYCLES 1 YEARLY → "for the first year"
    - buildLabel MONTHS 1 → singular
    - buildLabel without options keeps the de-DE/EUR output it always had
    - buildLabel formats the amount in the given locale
    - buildLabel formats the percentage in the given locale
    - buildLabel uses the given currency, symbol and decimals
    - buildLabel ignores the currency for percentage codes
    - buildLabel keeps non-breaking spaces out of the label
    - buildLabel rejects an unusable locale instead of guessing one
    - but an unknown region on a known language is not unusable
    - buildLabel does not police the currency, and says why
    - and a percentage ignores the currency, as its option says

<!-- END proof -->

### SC-PROMO-015 — What a code promised when it was redeemed stays with the redemption

🟢 Later edits to the code do not change what a customer already got.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-calculator.test.js`
    - round2 rounds to two decimal places
    - grossFromNet adds VAT
    - computeIncludedVat extracts VAT from gross
    - computeDiscountGross PERCENT 25%
    - computeDiscountGross ABSOLUTE 30 EUR
    - computeDiscountGross accepts a Prisma decimal string
    - computeDiscountedGross subtracts
    - addCycles MONTHLY +3
    - addCycles YEARLY +2
    - computeRegularStartsAt ONCE → one period
    - computeRegularStartsAt MONTHS 6
    - computeRegularStartsAt BILLING_CYCLES 2 (YEARLY)
    - buildLabel ONCE PERCENT
    - buildLabel MONTHS 6 ABSOLUTE
    - buildLabel BILLING_CYCLES 1 YEARLY → "for the first year"
    - buildLabel MONTHS 1 → singular
    - buildLabel without options keeps the de-DE/EUR output it always had
    - buildLabel formats the amount in the given locale
    - buildLabel formats the percentage in the given locale
    - buildLabel uses the given currency, symbol and decimals
    - buildLabel ignores the currency for percentage codes
    - buildLabel keeps non-breaking spaces out of the label
    - buildLabel rejects an unusable locale instead of guessing one
    - but an unknown region on a known language is not unusable
    - buildLabel does not police the currency, and says why
    - and a percentage ignores the currency, as its option says

<!-- END proof -->

### SC-PROMO-016 — A code past its validity stops working without anybody having to run anything

🟢 It is retired both on a schedule and on the next time somebody asks about it.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-public-controller.test.js`
    - preview passes code/plan/billingCycle 1:1 through to the service
    - preview passes email + ipHash + sessionId through to the service
    - preview forwards invalid response 1:1
    - preview works without an authenticated user (sessionId undefined)
    - rate limit 429 carries retryAfterSeconds of the IP window
    - rate limit 429 carries retryAfterSeconds of the session window

<!-- END proof -->

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
