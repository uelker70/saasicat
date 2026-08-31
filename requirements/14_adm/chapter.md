---
title: Administration and access to it
---

Who may act on the platform, and what has to be true before they can. Most of this chapter is
about the beginning and the end of a session — bootstrapping the first administrator, requiring a
second factor, and the roles that separate a tenant's administrator from a platform one.

### SC-ADM-001 — Only a platform administrator reaches the administration surface

🟢 🔒

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-manifest-module.test.js`
    - throws when the controller should be registered and
    - accepts empty
    - does NOT throw when
    - accepts a configured
    - additionally accepts
    - throws on missing

<!-- END proof -->

### SC-ADM-002 — A tenant-facing endpoint with no access rules configured refuses, it does not open

🟢 🔒 Failing loudly is the only safe reading; waving requests through would be silent.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/admin-manifest-module.test.js`
    - throws when the controller should be registered and
    - accepts empty
    - does NOT throw when
    - accepts a configured
    - additionally accepts
    - throws on missing

<!-- END proof -->

### SC-ADM-003 — The administration requires a second factor

🟢 🔒 A one-time code alongside the sign-in. A code that cannot be checked — malformed, or a stored
secret that is unreadable — is treated as wrong, and the underlying cause is recorded so it can be
diagnosed rather than leaving somebody staring at "code invalid".

_Source:_ `docs/reference/error-codes.md` · `SECURITY.md`

### SC-ADM-004 — A one-time code is accepted across a small clock difference

🟢 Half a minute either way, so an administrator with a slightly wrong clock is not locked out.

_Source:_ `SECURITY.md`

### SC-ADM-005 — Actions with lasting consequences need the second factor and an explicit confirmation

🟢 🔒 Suspending or reactivating a tenant, acting as a tenant, exporting their data, cancelling their
subscription, and granting or withdrawing a pilot. The most serious of them ask the operator to
type the tenant's name.

_Source:_ release 1.0.0-rc.6

### SC-ADM-006 — Two actions require a written reason before they run

🟢 Resetting somebody's password and deactivating a user. The reason is part of the record, which is
why a confirmation can carry a value rather than only a yes.

_Source:_ release 0.26.0

### SC-ADM-007 — There is no default confirmation that answers yes

🟢 An implementation that approved everything would silently approve every deletion, revocation and
deactivation, so an installation supplies its own or gets none.

_Source:_ release 0.26.0

### SC-ADM-008 — A password that cannot be retrieved again is shown without a way to dismiss it

🟢 Giving that dialog a cancel button would let an operator throw away something they cannot get
back.

_Source:_ release 0.26.0

### SC-ADM-009 — First-run setup stops working the moment an administrator exists

🟢 Whatever token is presented. An installation cannot be taken over after it has been bootstrapped,
and the token is compared in a way that does not leak how close a guess was.

_Source:_ `SECURITY.md`

### SC-ADM-010 — Without a setup token configured, there is no setup route

🟢 That is the correct steady state once an installation is bootstrapped, rather than a route sitting
there refusing people.

_Source:_ `SECURITY.md`

### SC-ADM-011 — The first administrator is set up with a second factor immediately

🟢 Not as a later step somebody might skip.

_Source:_ release 1.0.0-rc.4

### SC-ADM-012 — Test-only bypasses are ignored in production

🟢 🔒 The switches that skip the second factor and the rate limits exist for continuous integration
and are honoured only outside production. An integrator cannot add their own.

_Source:_ `SECURITY.md`

### SC-ADM-013 — A tenant-facing action that costs money requires the tenant's own administrator

🟢 🔒 Changing a plan, booking an add-on and cancelling are not things any signed-in user of a tenant
may do. Reading stays open to everyone who is signed in.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-route-that-costs-money-asks-for-the-role.test.js`
    - the controller has routes, and each carries its metadata
    - every writing route asks for the tenant administrator
    - the three that cost money are actually among them
    - reading and previewing stay open to every tenant user

<!-- END proof -->

### SC-ADM-014 — An administrator identity may live in the platform's tables or the application's

🟢 The second factor works either way, so an installation that already has an admin user table does
not have to keep a second one.

_Source:_ `docs/explanation/data-model.md`

### SC-ADM-015 — The administration only offers what the application actually has

🟢 A screen or an action for something the application never declared is not shown at all.

_Source:_ release 1.0.0-rc.6

### SC-ADM-016 — Signing out ends the session

🟢 It used to leave the operator looking at a sign-in form while still signed in.

_Source:_ release 0.22.0

### SC-ADM-017 — An expired session offers a fresh sign-in once, not in a loop

🟢 Repeating it forever is how a rejected session becomes an unbreakable login loop.

_Source:_ release 0.22.0

### SC-ADM-018 — A one-time code that was just accepted can currently be accepted again

🟢 Within its validity window. This is a known limitation, named rather than left to be discovered,
and the ordering of the checks plus transport encryption are the current mitigations.

_Source:_ `SECURITY.md`
