---
title: Answering the question afterwards
---

Prices change, plans are republished, entitlements move. This chapter is about being able to
answer, months later, what was true at a particular moment and who made it so. It is what turns a
dispute into a lookup.

### SC-AUD-001 — Every administrative action records who did it, from where, and when

🟢 Including actions taken from a command line rather than a browser, in a form that says which of
the two it was.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-guards.test.js`
    - AdminAuditService
        - actorTag formats source:email:context
        - log() writes through and appends the actor tag to changes
        - fromWebRequest builds AdminActor with source=web
        - fromWebRequest falls back to "unknown" when there is no session
        - fromCli builds AdminActor with source=cli + hostname
- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding writes an audit log with COMPLETE_ONBOARDING_SUBSCRIPTION
- `packages/nest/tests/registration-service.test.js`
    - audit: start() logs REGISTRATION_STARTED + pendingId
    - audit: verifyOtp success → OTP_VERIFIED, wrong → OTP_VERIFY_FAILED
    - audit: handlePaymentEvent → PAYMENT_RECEIVED + ACTIVATION_COMPLETED, duplicate →
      PAYMENT_DUPLICATE_IGNORED

<!-- END proof -->

### SC-AUD-002 — An action that belongs to no single tenant says so

🟢 Platform-wide acts are distinguishable from acts on one tenant, rather than looking like an entry
whose tenant went missing. An action nobody triggered — a scheduled job — is likewise
distinguishable from one a person took.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/audit-tail-flow.test.js`
    - empty filter → empty query object
    - actor → actorTag
    - action + entity
    - since → from
    - limit → pageSize
    - maps fields + truncated entityId
    - null-actorTag → "—"
    - short entityId not truncated

<!-- END proof -->

### SC-AUD-003 — Every change to a subscription is recorded with what it was before and after

🟢 Plan changes, scheduled changes, activations, accepted versions and cancellations.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/audit-tail-flow.test.js`
    - empty filter → empty query object
    - actor → actorTag
    - action + entity
    - since → from
    - limit → pageSize
    - maps fields + truncated entityId
    - null-actorTag → "—"
    - short entityId not truncated

<!-- END proof -->

### SC-AUD-004 — A failure to record something never blocks the act itself

🟢 A gap in the record is better than an outage for the tenant. Where no recording is configured at
all, the platform skips it rather than failing — a deliberate degradation for the smallest
installations.

_Source:_ release 1.0.0-rc.6

### SC-AUD-005 — Serious actions are marked as serious

🟢 Suspending a tenant, acting as one, publishing or ending a plan version, cancelling a
subscription, deactivating a user and handing over administrative rights are all findable as the
weighty acts they are.

_Source:_ release 1.0.0-rc.6

### SC-AUD-006 — The record can be searched by who, what, which object and since when

🟢 And it hands back a bounded page rather than everything at once.

_Source:_ release 1.0.0-rc.0

### SC-AUD-007 — What a customer bought is frozen at purchase

🟢 A plan change creates a new agreement and keeps the old one. Nothing rewrites what was agreed.

_Source:_ `docs/explanation/concepts.md` · `docs/explanation/capability-to-contract.md`

### SC-AUD-008 — A published version stays readable for as long as anything references it

🟢 So the question "what did this customer actually buy" always has an answer.

_Source:_ `docs/explanation/data-model.md`

### SC-AUD-009 — What a promotional code promised at redemption stays with the redemption

🟢

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - audit: failure in AuditLogger does not crash the auth flow

<!-- END proof -->

### SC-AUD-010 — A charge names where it came from and which agreement line it belongs to

🟡 _(Decided, not yet delivered.)_ Activation, renewal, a prorated plan change, an add-on booking, a
credit — so an account can be walked back to what was agreed.

_Source:_ #214

### SC-AUD-011 — A charge carries the period it belongs to

🟡 _(Decided, not yet delivered.)_ Which charges belong on one invoice has to be derivable, and a set
of individually booked amounts with no grouping leaves that to guesswork.

_Source:_ #214
