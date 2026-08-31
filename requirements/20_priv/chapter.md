---
title: What is kept, and what is never written down
---

Two questions a tenant and an operator both eventually ask: what does this system record about me,
and what does it throw away. The requirements below answer them, and one of them constrains
SaaSiCat itself — a record that survives has to be one that is safe to keep.

### SC-PRIV-001 — Nothing that could cause harm is written to a log

🟢 🔒 No passwords, tokens, keys, session secrets or complete sensitive payloads, and no personal data
beyond what a diagnosis needs. A production failure needs context, not secrets.

_Source:_ internal engineering guidelines

### SC-PRIV-002 — A network address is recorded as a fingerprint, never in the clear

🟢 🔒 In the anti-abuse trail and in the record of registration steps alike.

_Source:_ release 1.0.0-rc.7

### SC-PRIV-003 — Passwords and verification codes cannot be read back out of storage

🟢 🔒

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-helpers.test.js`
    - verifyOtpCode returns false on a broken hash (no throw)
- `packages/nest/tests/registration-service.test.js`
    - start() stores OTP only as a hash, never in plaintext

<!-- END proof -->

### SC-PRIV-004 — The record of a registration carries no address, password or code in the clear

🟢 🔒 Recording the address would make the trail itself a way to find out who has an account.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() stores OTP only as a hash, never in plaintext

<!-- END proof -->

### SC-PRIV-005 — Payment details are kept masked

🟢 🔒 SaaSiCat records how a tenant would pay, not enough to pay as them.

_Source:_ `docs/explanation/data-model.md`

### SC-PRIV-006 — A record that history depends on is retired, not deleted

🟢 🔒 Plans, add-ons, promotional codes and catalogue entries are withdrawn from use and kept. Only an
unpublished draft is removed outright.

_Source:_ `docs/explanation/data-model.md`

### SC-PRIV-007 — An abandoned registration is removed rather than kept in a reduced form

🟢 🔒 The address it holds is exactly the thing that has to become usable again.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - runCleanup() deletes expired, leaves active alone
    - runCleanup() frees the email again after deletion → repeated start() works

<!-- END proof -->

### SC-PRIV-008 — Failed attempts are part of the record, not only successful ones

🟢 🔒

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - audit: verifyOtp success → OTP_VERIFIED, wrong → OTP_VERIFY_FAILED

<!-- END proof -->

### SC-PRIV-009 — A migration that would destroy data stops and says what it found

🟢 🔒 Rather than merging rows nobody meant to merge, or discarding them. Which of two colliding
records survives is not a decision a migration takes on its own.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/schema-apply-dry-run.test.js`
    - it names the lines, and leaves the file untouched
    - and the real run writes exactly those lines
    - past tense belongs to the run that did it

<!-- END proof -->

### SC-PRIV-010 — History is not rewritten

🟢 🔒 A period a tenant was already billed for is left as it stands, even by a correction that would
otherwise be tidier. Rewriting it changes what the record says happened.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`
