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

### SC-REG-002 — A half-finished registration is never counted as a customer

🟢 Not in numbers an operator reads, and not in a check for whether an address is already taken.

_Source:_ `docs/explanation/data-model.md`

### SC-REG-003 — Accepting the terms, the privacy notice and the data agreement is part of step one

🟢

_Source:_ release 1.0.0-rc.7

### SC-REG-004 — Somebody who has already verified their address is not asked to verify it again

🟢 They are sent a link back into where they left off instead of a new code.

_Source:_ release 1.0.0-rc.7

### SC-REG-005 — Restarting an unverified registration issues a new code and keeps the stored data

🟢 The old code stops working, and nothing somebody else typed overwrites what is there.

_Source:_ release 1.0.0-rc.7

### SC-REG-006 — A verification code expires, and says so

🟢 An expired code is refused with an invitation to request a new one, not with a failure that reads
like a wrong code.

_Source:_ `docs/reference/error-codes.md`

### SC-REG-007 — After five wrong verification codes the attempt is locked

🟢 A subsequently correct code no longer works, and the only way on is a new code. The attempt is
counted before the code is compared, so parallel attempts cannot race past the limit.

_Source:_ `SECURITY.md`

### SC-REG-008 — A locked verification tells the person to request a new code

🟢 Not to try again, which is the one thing that will not work.

_Source:_ `SECURITY.md`

### SC-REG-009 — Repeated attempts are rate-limited, and the answer says how long to wait

🟢 Where refusing loudly would itself reveal that a registration exists, the request is quietly
dropped instead.

_Source:_ `docs/reference/error-codes.md`

### SC-REG-010 — A registration expires, and so does the link that resumes it

🟢 An abandoned one is removed outright rather than kept in a reduced form, so the address becomes
usable again.

_Source:_ `docs/reference/error-codes.md` · release 1.0.0-rc.7

### SC-REG-011 — The steps come in order

🟢 A step reached out of order is refused with a message saying so, rather than half-completing a
registration.

_Source:_ `docs/reference/error-codes.md`

### SC-REG-012 — The plan can be changed freely up to the moment of payment

🟢 And it is checked again at that moment, because it may have left the catalogue in between.

_Source:_ release 1.0.0-rc.7

### SC-REG-013 — A plan that does not exist and one that is not on offer answer the same

🟢 Otherwise the difference between the two would tell a stranger which plans an installation has.

_Source:_ release 1.0.0-rc.7

### SC-REG-014 — Prices in the sign-up flow are worked out by the server

🟢 The page displays a breakdown; it does not compute one. A discount can never exceed the amount it
applies to, and no total goes below zero.

_Source:_ release 1.0.0-rc.7

### SC-REG-015 — A promotional code is re-checked every time the price is shown

🟢 The stored code is only there to be displayed back to the person entering it.

_Source:_ release 1.0.0-rc.7

### SC-REG-016 — The account, the tenant and the subscription are created together or not at all

🟢 Only after payment succeeded, and a partial creation is undone.

_Source:_ release 1.0.0-rc.7

### SC-REG-017 — Add-ons chosen during sign-up never cost somebody their plan

🟢 If one of them cannot be booked, it becomes a warning and the plan still activates.

_Source:_ release 1.0.0-rc.6

### SC-REG-018 — Whether a payment confirmation is genuine is the integrator's to verify

🟢 SaaSiCat cannot know the provider or the secret. An unverified callback lets anyone forge a
payment confirmation, so verification sits in front of the route.

_Source:_ `SECURITY.md`

### SC-REG-019 — The same payment event applied twice changes nothing

🟢 Providers retry, and a retry must not create a second account or a second charge.

_Source:_ `docs/explanation/data-model.md`

### SC-REG-020 — A resumed registration never carries a password or a verification code with it

🟢 What is handed back to a returning person is what they need to continue, and nothing that could be
used against them.

_Source:_ release 1.0.0-rc.7
