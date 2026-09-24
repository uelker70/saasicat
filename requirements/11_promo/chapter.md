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

- `packages/nest/tests/promo-service.test.js`
    - a code that has been redeemed is kept
        - a soft delete is refused while a redemption points at it
        - and pausing it instead is allowed

<!-- END proof -->

### SC-PROMO-005 — A percentage discount is between 0 and 100

🟢

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-code-takes-off-no-more-than-the-price.test.js`
    - a changed percentage stays between 0 and 100
        - ${value} % is refused
        - 100 % and 0.01 % are accepted
        - an amount of 150 turned into a percentage without a new value is refused
- `packages/nest/tests/promo-admin-controller.test.js`
    - standard promo Admin controller exposes list, create, edit and delete
- `packages/ui-vue/tests/component/promo-code-dialogs.test.ts`
    - PromoCodeCreateDialog
        - passes the entered values through to submit
        - reopening starts from an empty form
        - does not submit while the code is malformed
        - keeps a handler error inside the dialog
    - PromoCodeEditDialog
        - adopts the row values into the form
        - sends nothing while nothing has changed
        - sends only the changed fields, with the row id
        - keeps a handler error inside the dialog
    - Shared form body
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

- `packages/nest/tests/a-code-takes-off-no-more-than-the-price.test.js`
    - a changed amount stays below the lowest price it can apply to
        - an amount of nothing, or less, is refused
        - the lowest price itself is refused, and a cent below it accepted
        - more than the price is accepted where the operator allows an invoice of zero
        - taking back the allowance of an invoice of zero is refused while the amount needs it
        - limiting it to a plan it would make free is refused
    - redeeming takes off no more than the price
        - ${what}, ${allowance}: ${outcome}
        - a percentage of 100 is refused where an invoice of zero is not allowed
        - a percentage stored above 100 is recorded at 100
        - a plan made cheaper than the code after it was created refuses the redemption
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
    - a redemption and its discount stand or fall together
        - the slot and the record are claimed in one transaction
        - a record that cannot be written takes the slot back with it

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
    - promoStatus
        - active within the window
        - scheduled before validFrom
        - expired after validTo
    - pickActivePromo
        - highest priority wins on overlap
        - onlyLocales filters
        - billingCycle filters
        - requiresCoupon promotions are not selected automatically
        - non-matching plan → null
        - targetType filters bundle promotions separately from plan promotions
    - applyPromo
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
    - promoStatus
        - active within the window
        - scheduled before validFrom
        - expired after validTo
    - pickActivePromo
        - highest priority wins on overlap
        - onlyLocales filters
        - billingCycle filters
        - requiresCoupon promotions are not selected automatically
        - non-matching plan → null
        - targetType filters bundle promotions separately from plan promotions
    - applyPromo
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

### SC-PROMO-023 — A customer at the payment form keeps the promo code the checkout started with

🟢 💰 A checkout that names its offer holds a slot of the offer's code from its start until it
concludes or its hold runs out — for a sign-up, when `SC-PROMO-024` says — and the conclusion
redeems the code on that slot — also when every other slot went to somebody else in between, or the
code was paused or ran past its validity. A held slot counts against the limit like a redemption
(`SC-PROMO-002`), so a code whose remaining slots are held refuses new checkouts; the slot goes back
when its hold runs out or its offer's code changes. Where this stops: a checkout concluded after its
hold ran out redeems a free slot if one is left, and is refused otherwise.

_Source:_ #290

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/a-held-slot-is-counted-in-the-statements.test.js`
    - taking a slot for a checkout
        - locks the code, finds no hold for the offer, counts the slot, then writes the hold
        - an offer that holds a slot already takes no second one
        - a code without a free slot writes no hold
        - a code that does not exist is asked nothing further
    - ending a hold
        - a release deletes the offer’s hold and gives its slot back
        - a release that finds no hold changes no count
        - a release of a hold as it was written deletes it only while it still expires then
        - a hold moved since stays, and its slot with it
        - a sweep gives the slots back per code, in one fixed order of codes
        - a sweep of one code names it
    - handing a hold to the redemption on the same transaction
        - marks it with the transaction, only while it has not expired
        - the redemption on that transaction takes it as its slot
        - a redemption on another transaction finds nothing and changes nothing
    - starting the same checkout again
        - moves the expiry of the hold it has on that code, never earlier than it stands
        - answers false when the hold ended meanwhile
        - reads the hold an offer has
- `packages/nest/tests/a-promo-slot-is-held-through-checkout.test.js`
    - the last slot of a code, held for a checkout
        - is refused to a second checkout and to a redemption, and the paid checkout redeems it
        - without a hold, it can go to somebody else between checkout and payment
        - is redeemed for its checkout even when the code was paused since
        - is redeemed for its checkout even when the code ran past its validity since
    - a checkout keeps one slot, for as long as it runs
        - starting it again moves the expiry of its slot and takes no second one
        - starting it again for less keeps the later expiry: a form opened before can still be paid
          on
        - starting it again on the last slot, which it holds itself, is not refused
        - changing its offer keeps the slot while the code stays on it
        - removing the code from its offer gives the slot back
        - holding another code for it gives the slot of the first one back
        - a code changed on the offer while its slot is being taken moves the slot to the new code
        - an offer whose code keeps changing under the hold is refused as changed, and holds nothing
        - opening its form again after the code was paused moves its live slot rather than refusing
          it
        - a slot that expired is no longer its own: a paused code refuses it a new one
        - an offer without a code holds nothing
        - a slot whose checkout expired is free again for somebody else
        - a redemption outside any checkout takes the slot of a checkout that expired
        - a checkout concluded after its slot expired redeems a free one, if one is left
        - and is refused when the slot went to somebody else after it expired
    - the conclusion and the held slot
        - a conclusion that does not redeem the code gives its slot back
        - a conclusion that fails keeps the slot for the retry, which redeems it
        - a slot held for one offer is not taken by the redemption of another
    - a code a checkout cannot hold
        - refuses the start with the reason, and holds nothing
        - a code paused while its slot is being taken is refused as paused, not as run out
        - an offer no longer open holds nothing
        - an installation whose persistence keeps no holds says what is missing
    - the operator and a held slot
        - a code a checkout holds a slot of is not deleted, and says so
        - once the checkout expired, the code can be deleted
        - the list shows what is held right now, expired checkouts given back
        - the nightly sweep gives back the slots of checkouts that expired
- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - step 4 holds the promo code of the offer the sign-up concludes
        - from step 4 until a confirmation of the form can no longer arrive, and the confirmation
          redeems it though the code ran out meanwhile
        - a gateway whose form sets no end holds the slot for as long as the checkout runs
        - a form that fails to open gives its slot back at once, and the failure is the answer
        - a start whose slot cannot be moved to the end of its form gives it back, and the failure
          is the answer
        - a second step 4 that fails leaves the slot with the form the first one opened, which
          redeems it
        - of two step 4s at once, the one that fails leaves the slot with the form the other opened
        - a step 4 refused before the gateway is asked gives its slot back as well
        - a code that cannot be held refuses step 4 before the gateway form opens
        - a sign-up that names no offer holds nothing
        - naming an offer where no checkout offers are registered says what to wire
- `packages/ui-vue/tests/component/a-code-shows-the-slots-checkouts-hold.test.ts`
    - the redemptions of a code in the list
        - name the slots checkouts hold beside the redeemed ones
        - read as before while no checkout holds one
        - read as before for a row that does not report held slots

<!-- END proof -->

### SC-PROMO-024 — A sign-up's promo code slot is held while a confirmation of its form can arrive

🟢 💰 The slot a sign-up holds (`SC-PROMO-023`) lasts until a confirmation of the payment form it
opened can no longer arrive, as the gateway reports it: the end of the form plus the time the
gateway goes on retrying a confirmation it could not deliver — at Stripe 24 hours plus three days —
and not for the sign-up's whole lifetime. A form paid shortly before its end therefore still finds
its slot when the confirmation comes late, and a form abandoned at the gateway gives its slot back
once nobody can pay on it and nothing is left to arrive, so abandoned checkouts do not keep a
limited code blocked; a customer who returns later starts a new form, which holds a slot again if
one is free. Starting step 4 again never takes the slot from a form opened before, which can still
be paid on. Where this stops: a gateway that reports no end holds the slot for as long as the
sign-up's checkout runs; a start that fails gives back at once the slot it took itself; and a
confirmation resent by hand after that moment — Stripe's dashboard allows it for fifteen days —
finds no slot, and is refused if the code ran out meanwhile.

_Source:_ #290

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - step 4 holds the promo code of the offer the sign-up concludes
        - from step 4 until a confirmation of the form can no longer arrive, and the confirmation
          redeems it though the code ran out meanwhile
        - a gateway whose form sets no end holds the slot for as long as the checkout runs
        - a form that fails to open gives its slot back at once, and the failure is the answer
        - a start whose slot cannot be moved to the end of its form gives it back, and the failure
          is the answer
        - a second step 4 that fails leaves the slot with the form the first one opened, which
          redeems it
        - of two step 4s at once, the one that fails leaves the slot with the form the other opened
        - a step 4 refused before the gateway is asked gives its slot back as well
- `packages/payment-stripe/tests/a-payment-method-is-set-up-in-stripes-own-form.test.js`
    - the form is opened at Stripe
        - the session can be confirmed until its end plus the three days Stripe retries a webhook

<!-- END proof -->
