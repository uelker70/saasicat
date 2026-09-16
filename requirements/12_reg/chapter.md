---
title: Self-registration
---

Where an installation lets strangers sign themselves up, the flow has to be safe against people
who are not customers yet. This chapter covers the ordering of the steps, what expires, and the
limits on guessing. It applies only to installations that wire the flow deliberately — see
SC-SCOPE-006.

### SC-REG-001 — Starting a registration reveals nothing about who already has an account

🟢 The answer is the same whether or not the address is known, and a failure to send the message is
not surfaced either. Otherwise the flow becomes a way to enumerate customers.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() with active user → no PendingRegistration created
    - start() email normalization: trim + lowercase
    - resendOtp() unknown email → neutral response, no throw

<!-- END proof -->

### SC-REG-002 — A half-finished registration is never counted as a customer

🟢 Not in numbers an operator reads, and not in a check for whether an address is already taken.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() creates PendingRegistration and sends OTP

<!-- END proof -->

### SC-REG-003 — Accepting the terms, the privacy notice and the data agreement is part of step one

🟢

_Source:_ release 1.0.0-rc.7

### SC-REG-004 — Somebody who has already verified their address is not asked to verify it again

🟢 They are sent a link back into where they left off instead of a new code.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() with active user → no PendingRegistration created

<!-- END proof -->

### SC-REG-005 — Restarting an unverified registration issues a new code and keeps the stored data

🟢 The old code stops working, and nothing somebody else typed overwrites what is there.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() with expired PendingRegistration → deletes + creates new
    - start() with existing PENDING_EMAIL_VERIFICATION → OTP is regenerated

<!-- END proof -->

### SC-REG-006 — A verification code expires, and says so

🟢 An expired code is refused with an invitation to request a new one, not with a failure that reads
like a wrong code.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - verifyOtp() expired OTP → OTP_EXPIRED

<!-- END proof -->

### SC-REG-007 — After five wrong verification codes the attempt is locked

🟢 A subsequently correct code no longer works, and the only way on is a new code. The attempt is
counted before the code is compared, so parallel attempts cannot race past the limit.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - verifyOtp() after 5 failed attempts → OTP_LOCKED
    - verifyOtp() correct code after lockout → still OTP_LOCKED
    - verifyOtp() parallel failed attempts with stale counter → atomic increment locks

<!-- END proof -->

### SC-REG-008 — A locked verification tells the person to request a new code

🟢 Not to try again, which is the one thing that will not work.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - verifyOtp() correct code after lockout → still OTP_LOCKED
    - resendOtp() after lockout → new code unlocks (counter reset)

<!-- END proof -->

### SC-REG-009 — Repeated attempts are rate-limited, and the answer says how long to wait

🟢 Where refusing loudly would itself reveal that a registration exists, the request is quietly
dropped instead.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - resendOtp() rate limit kicks in → silently dropped after 3 sends

<!-- END proof -->

### SC-REG-010 — A registration expires, and so does the link that resumes it

🟢 An abandoned one is removed outright rather than kept in a reduced form, so the address becomes
usable again.

_Source:_ `docs/reference/error-codes.md` · release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() with expired PendingRegistration → deletes + creates new
    - runCleanup() deletes expired, leaves active alone
    - resume: resumeWithToken() invalid token → RESUME_TOKEN_INVALID
    - resume: resumeWithToken() token points to deleted Pending → RESUME_TOKEN_INVALID

<!-- END proof -->

### SC-REG-011 — The steps come in order

🟢 A step reached out of order is refused with a message saying so, rather than half-completing a
registration.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() creates PendingRegistration and sends OTP
    - selectPlan() without email verification (PENDING_EMAIL_VERIFICATION) →
      INVALID_REGISTRATION_STATE
    - startCheckout() without plan selection → PLAN_NOT_SELECTED

<!-- END proof -->

### SC-REG-012 — The plan can be changed freely up to the moment of payment

🟢 And it is checked again at that moment, because it may have left the catalogue in between.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - selectPlan() plan change in status PLAN_SELECTED is allowed

<!-- END proof -->

### SC-REG-013 — A plan that does not exist and one that is not on offer answer the same

🟢 Otherwise the difference between the two would tell a stranger which plans an installation has.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding throws ForbiddenException for blocked self-service plans
- `packages/nest/tests/registration-service.test.js`
    - selectPlan() non-catalogued plan → PLAN_NOT_AVAILABLE
    - listPublicPlans() passes the plan list through

<!-- END proof -->

### SC-REG-014 — Prices in the sign-up flow are worked out by the server

🟢 The page displays a breakdown; it does not compute one. A discount can never exceed the amount it
applies to, and no total goes below zero.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/the-configurator-shows-the-price-that-is-charged.test.js`
    - the configurator breakdown
        - a monthly plan costs its monthly price and saves nothing
        - a yearly plan costs the yearly price its plan version carries
        - a yearly price above twelve monthly ones saves nothing rather than a negative amount
        - a promo code is previewed on the yearly price that is charged
        - a promo discount is taken off in net, not the gross amount the preview answers
        - a discount above the price takes it to nothing, not below
        - resuming the step shows the same yearly figure

<!-- END proof -->

### SC-REG-015 — A promotional code is re-checked every time the price is shown

🟢 The stored code is only there to be displayed back to the person entering it.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding with promoCode + PromoCodesService redeems atomically

<!-- END proof -->

### SC-REG-016 — The account, the tenant and the subscription are created together or not at all

🔴 _(Withdrawn on 2026-09-15.)_ `SC-REG-022` covers this ground, with the subscriber and the
payment method created in the same step. Only after payment succeeded, and a partial creation is
undone.

_Source:_ release 1.0.0-rc.7

### SC-REG-017 — Add-ons chosen during sign-up never cost somebody their plan

🟢 If one of them cannot be booked, it becomes a warning and the plan still activates.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding throws BadRequestException when plan-change blockers are active

<!-- END proof -->

### SC-REG-018 — Whether a payment confirmation is genuine is the integrator's to verify

🟢 SaaSiCat cannot know the provider or the secret. An unverified callback lets anyone forge a
payment confirmation, so the gateway adapter the integrator binds verifies it before the route reads
anything from it.

_Source:_ `SECURITY.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - the confirmation of the payment method activates the sign-up
        - a confirmation the gateway did not sign is refused before anything is claimed or created

<!-- END proof -->

### SC-REG-019 — The same payment event applied twice changes nothing

🟢 Providers retry, and a retry must not create a second account or a second charge.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - the confirmation of the payment method activates the sign-up
        - the same confirmation delivered twice activates once
        - a session confirmed once is not confirmed again under another event identifier
        - once activated the sign-up is gone: a later confirmation with another payment method
          activates nothing, and step 4 is refused

<!-- END proof -->

### SC-REG-020 — A resumed registration never carries a password or a verification code with it

🟢 What is handed back to a returning person is what they need to continue, and nothing that could be
used against them.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - resume: resumeWithToken() success → returns pending ID + nextStep + snapshot
    - resume: resumeWithToken() invalid token → RESUME_TOKEN_INVALID

<!-- END proof -->

### SC-REG-021 — A payment confirmation is verified before anything is created from it

🟡 _(Decided, not yet delivered.)_ 🔒 A gateway adapter SaaSiCat ships verifies the confirmation
with the gateway's secret. An integrator who binds a provider of their own verifies it in the
adapter they bind, as before. This entry supersedes `SC-REG-018` in the change that delivers it.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - the confirmation of the payment method activates the sign-up
        - a confirmation the gateway did not sign is refused before anything is claimed or created
- `packages/nest/tests/a-tenant-changes-its-payment-method-through-the-gateway.test.js`
    - the webhook route
        - is public, one route per account, and hands the gateway the body as it arrived
        - an account the configuration does not name is refused
        - a JSON or form callback without its raw body is a setup error, and says how to keep the
          body
        - a body no gateway sends is refused as unverifiable, not reported as a setup error

<!-- END proof -->

### SC-REG-022 — The account, subscriber, tenant, subscription and payment method are created together

🟢 Or not at all: only after the gateway confirmed the payment
method, which sign-up asks for in the gateway's own form, together with the master data an invoice
needs (`SC-PRIC-032`), and a partial creation is undone. A first collection that then fails leaves
an invoice unpaid like any other, with the grace period of `SC-PRIC-035`.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - step 4 takes the billing address and opens the gateway form
        - the address is kept as the subscriber will have it, and the form opens at the account for
          new payment methods
        - a sign-up without ${field} is refused before the gateway is asked
        - a ${field} of ${url} is refused before anything is stored or asked
        - a country that is not a two-letter code is refused
        - step 4 repeated at the same account reuses the customer the gateway created
        - step 4 repeated after new payment methods moved to another account asks for a new customer
          there
        - without an account for new payment methods, step 4 is refused and nothing is kept
    - the confirmation of the payment method activates the sign-up
        - everything is written on the transaction the confirmation is claimed on, the payment
          method included
        - an activation that fails leaves nothing behind, and the gateway retry activates
        - the same confirmation delivered twice activates once
        - a session confirmed once is not confirmed again under another event identifier
        - once activated the sign-up is gone: a later confirmation with another payment method
          activates nothing, and step 4 is refused
        - a sign-up whose deletion fails is not activated either, and the gateway retry activates it
          once
        - a confirmation for a session no sign-up waits for activates nothing
        - a confirmation that activated nothing leaves its session free for the one that belongs to
          it
        - a confirmation naming another sign-up than its session belongs to activates neither
        - a session is looked up with the account that sent the confirmation, not by its identifier
          alone
        - a setup the gateway reports as failed is recorded, and the sign-up can try again
        - a confirmation the gateway did not sign is refused before anything is claimed or created
        - the development gateway confirms on the spot, through the same claim and transaction

<!-- END proof -->
