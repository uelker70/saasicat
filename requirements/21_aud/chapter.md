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

<!-- END proof -->

### SC-AUD-002 — An action that belongs to no single tenant says so

🟢 Platform-wide acts are distinguishable from acts on one tenant, rather than looking like an entry
whose tenant went missing. An action nobody triggered — a scheduled job — is likewise
distinguishable from one a person took.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/prisma-adapters.test.js`
    - PrismaAuditAdapter
        - write maps actor to userId + actorTag on audit_logs

<!-- END proof -->

### SC-AUD-003 — Every change to a subscription is recorded with what it was before and after

🟢 Plan changes, scheduled changes, activations, accepted versions and cancellations.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscription-change-is-recorded-before-and-after.test.js`
    - a plan change is recorded with what it was before and after
        - the entry names the plan and cycle on both sides of the change
        - the before is read from the subscription, not echoed from the request

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

- `packages/nest/tests/promo-service.test.js`
    - what a code promised at redemption stays with the redemption
        - the redemption records the terms, not a pointer to them
        - and editing the code afterwards does not rewrite them

<!-- END proof -->

### SC-AUD-010 — A charge names where it came from and which agreement line it belongs to

🟡 _(Decided, not yet delivered.)_ Activation, renewal, a prorated plan change, an add-on booking, a
credit — so an account can be walked back to what was agreed.

_Source:_ #214

### SC-AUD-011 — A charge carries the period it belongs to

🟡 _(Decided, not yet delivered.)_ Which charges belong on one invoice has to be derivable, and a set
of individually booked amounts with no grouping leaves that to guesswork.

_Source:_ #214

### SC-AUD-012 — A contract carries both parties as they were when it was concluded

🟡 _(Decided, not yet delivered.)_ 💰 The subscriber, and the issuer as `config/saas.yaml` named
it that day, so the contract still says which legal entity was the counterparty after either
changes and after the tenant is gone. A copy made while an existing contract is migrated says
so, and is never presented as what was true at conclusion. Either party may have changed since the
contract was concluded, which the migration cannot see, so the operator confirms each migrated copy
against the contract as concluded, correcting it where it differs, before that contract is
invoiced; until then it is not.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-issuer-is-the-same-entity-or-another-one.test.js`
    - the copy a contract takes of the issuer
        - carries the same three fields the start compares, and the address beside them
        - never loses all three because one of them could not be read
        - does not carry the declaration, which is about the change and not the party
- `packages/nest/tests/a-contract-is-concluded-with-its-subscriber.test.js`
    - a contract names the parties it is concluded with
        - it copies the tenant's subscriber and the issuer the configuration names
        - where the configuration names no issuer, the contract says none was named
        - a party a caller names itself is not the one written
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - every contract names the subscriber it is concluded with
        - each contract names its tenant's subscriber, with a copy that says the migration made it

<!-- END proof -->

### SC-AUD-013 — Every invoice line can be traced to the charge and the contract line it came from

🟡 _(Decided, not yet delivered.)_ 💰 The charge already names its agreement line (`SC-AUD-010`);
the invoice line adds the step from the document to the charge.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-AUD-014 — An invoice downloaded later is the document that was issued, not a new rendering

🟡 _(Decided, not yet delivered.)_ 💰 The rendered document is archived when the invoice is
issued, and every later download, by the tenant or by the operator, returns that archived file;
an invoice whose document is not yet archived is not offered at all (`SC-PRIC-033`). Rendering
it again from today's data would hand out a document the subscriber never received.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-AUD-015 — An archived invoice is checked against the checksum recorded when it was rendered

🟡 _(Decided, not yet delivered.)_ 💰 The document is rendered from what the invoice records and
nothing else, never the current time or today's settings, and its checksum is recorded with the
invoice before it is archived. An archiving attempt repeated after an interruption (`SC-PRIC-033`)
stores a file with that checksum, every download is checked against it, and a file that does not
match is not handed out but shown to the operator. The register's export (`SC-ADM-022`) carries each
checksum.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-AUD-016 — Concluding or changing a contract gives the subscriber a confirmation to keep

🟡 _(Decided, not yet delivered.)_ 💰 It names the plan and the bundles, their prices with the tax
treatment (`SC-PRIC-038`), the term, the notice period and the version of the operator's terms that
applied. That version is the one `config/saas.yaml` named when the contract was concluded or changed,
which the contract records; the confirmation takes it from the contract, so one rendered again after
new terms are published still names the terms the subscriber agreed to (`SC-AUD-015`). It is
rendered and archived like an invoice (`SC-AUD-015`),
sent to the subscriber's invoice email and offered for download beside the invoices (`SC-UI-023`).
German law asks for the terms of a contract concluded online, general terms included, to be
retrievable and storable when it is concluded.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`
