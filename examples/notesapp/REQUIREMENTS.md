# NotesApp — Stakeholder Requirements

NotesApp is the reference integration for SaaSiCat: a small, runnable, multi-tenant
application whose only purpose is to show a developer how to make their own software
SaaS-capable. This document states what NotesApp has to be and do, seen from the people it
serves — not how any of it is built. An example application carries requirements of its own
because it has real users: developers who read it in order to copy it. A defect in a
reference is copied along with everything else it teaches, which is why the properties
below are requirements rather than good intentions.

Three roles appear throughout. The **integrating developer** is the primary stakeholder —
someone with an existing application who has never seen SaaSiCat and wants to be finished in
an afternoon. The **tenant**, a customer of the application, and their own **tenant
administrator** are the roles NotesApp models on the customer side; the **operator** runs the
installation from the SuperAdmin surface. The last two exist here because a platform rule is
only visible once somebody exercises it. Identifiers are `NAP-<CHAPTER>-<NNN>`, numbered per
chapter from 001. They are stable: a number is never reassigned, and a requirement that is
withdrawn stays in place marked `Withdrawn` rather than being deleted.

## 1. The role of the example

NotesApp has no end customers and sells nothing. It is a teaching object whose authority
comes from being running code rather than prose. Everything else in this document follows
from what it is for, so that is fixed first: who reads it, what standing it has beside the
documentation, and what it is allowed to be about.

### NAP-ROLE-001 — NotesApp is the application an integrating developer copies from

A developer making their own software SaaS-capable can read one complete application and see
how each part of the integration is done, instead of assembling the answer from separate
chapters. Whatever the example shows is what strangers will build.

_Source:_ `README.md`

### NAP-ROLE-002 — Reading the example is a full alternative to reading the documentation

A developer who prefers code to prose can start at the example and arrive at the same
understanding. It is not an appendix to the documentation but a second door into it.

_Source:_ `README.md`

### NAP-ROLE-003 — NotesApp is the finished state of the quickstart

A developer who works through the quickstart ends up with this application. Any difference
between what a quickstart step promises and what the example contains is a defect in one of
the two, never a variation.

_Source:_ `docs/quickstart.md`

### NAP-ROLE-004 — NotesApp is the application the tutorials build

Every file a tutorial prints is a file of this application, so a reader who follows along and
a reader who reads the example see the same code.

_Source:_ `docs/tutorial/01-first-plan.md`

### NAP-ROLE-005 — NotesApp runs

It is not a sketch or a set of fragments. A reader can start it and observe every behaviour
it claims, which is the difference between a reference and an illustration.

_Source:_ `README.md`

### NAP-ROLE-006 — The example's own subject matter stays trivial

Notes are deliberately the least interesting domain available, so that what a reader has to
understand is the integration and never the business logic around it.

_Source:_ `README.md`

### NAP-ROLE-007 — The example is the yardstick for the effort figures the product quotes

When the documentation claims a number — lines of application-owned code, the size of the
administrative bundle, how much glue a standard page costs — that number is measured on this
application, so a reader can check it rather than believe it.

_Source:_ ADR 0008 · ADR 0011

## 2. The loop the example demonstrates

SaaSiCat's product is a chain: a capability declared in code, found automatically, packaged
into plans, sold as a contract, and enforced at runtime. Each link is easy to describe and
hard to believe until it has been seen working end to end. This chapter is what a reader must
be able to observe in the running example, in order.

### NAP-LOOP-001 — A reader can see a paid capability declared in ordinary application code

The two things the product sells — creating a note and exporting notes — are declared where
the application already does its work, not in a separate registry a developer has to keep in
step by hand.

_Source:_ `docs/explanation/capability-to-contract.md`

### NAP-LOOP-002 — A reader can see the platform find those declarations by itself

Starting the application is enough for both declared capabilities to appear; nobody lists
them anywhere, and a reader can inspect what was found.

_Source:_ `docs/explanation/capability-to-contract.md`

### NAP-LOOP-003 — A reader can see the same declarations sold as two differently priced plans

An entry-level plan and a fuller one differ only in which capabilities and which allowance
they include, which is what makes packaging a commercial decision rather than a code change.

_Source:_ `docs/tutorial/01-first-plan.md`

### NAP-LOOP-004 — A reader can see a countable limit declared once and counted by the application

The application says what is countable and how to count it in one place; the platform decides
when the count has been reached.

_Source:_ `docs/tutorial/01-first-plan.md`

### NAP-LOOP-005 — A reader can observe all three outcomes of enforcement

A request that is allowed, one refused because the plan does not include the capability, and
one refused because the allowance is exhausted each produce their own distinct, predictable
answer, and the example shows how to provoke all three.

_Source:_ `docs/explanation/capability-to-contract.md`

### NAP-LOOP-006 — A reader can see that no request handler contains platform logic

Nothing in the application checks a limit or a plan. Declaring, selling and enforcing are
three separate places, and the handler is none of them.

_Source:_ `docs/tutorial/01-first-plan.md`

### NAP-LOOP-007 — A reader can see the whole platform integration in one place

The wiring is a single configuration, not a dozen modules a developer has to discover and
assemble in the right order.

_Source:_ `README.md`

### NAP-LOOP-008 — A reader can see the platform's data living beside the application's own

The tables the platform needs and the tables the application owns are one schema in one
database, so a developer can tell at a glance what adopting the platform costs their data
model.

_Source:_ `README.md`

## 3. The tenant's application

NotesApp models a customer-facing application because several platform rules are only
observable from the customer's chair: what an exhausted allowance feels like, what a locked
capability looks like, and what a customer may decide about their own subscription. This
chapter is what a tenant can do, and what they are owed while doing it.

### NAP-TENANT-001 — A tenant sees only their own data

Everything a tenant reads or creates belongs to their own tenancy. A second tenant using the
same installation at the same time is unaffected and invisible.

_Source:_ `README.md`

### NAP-TENANT-002 — A tenant can always see which plan they are on and how much they have used

Plan and consumption are shown where the work happens, not buried in a billing area, so
nobody meets their limit as a surprise.

_Source:_ current practice

### NAP-TENANT-003 — A locked capability is presented as an explanation and an offer

A tenant whose plan does not include a capability sees that it exists, why it is unavailable,
and how to obtain it — never a dead control or a failure.

_Source:_ current practice

### NAP-TENANT-004 — A tenant who reaches a limit is told the number and the way out

The refusal names what was reached and how much was allowed, and offers the upgrade in the
same place, rather than reporting a generic error.

_Source:_ current practice

### NAP-TENANT-005 — A tenant administrator can manage their own subscription without an operator

Reviewing the plan, previewing a change, switching, booking an add-on and cancelling are all
self-service, and the date on which a decision takes effect is stated before it is confirmed.

_Source:_ #212

### NAP-TENANT-006 — Cost-relevant self-service is reserved for the tenant's administrator

Only a tenant's administrator may change what the tenancy is charged for, and the example
identifies itself as one — so the flow it exists to demonstrate is actually reachable in it.

_Source:_ current practice

### NAP-TENANT-007 — Every screen has a defined state while loading, when empty and on failure

A tenant always knows whether the application is working, has nothing to show, or has failed;
none of the three is left to be inferred from a blank area.

_Source:_ current practice

### NAP-TENANT-008 — The customer-facing and the operator-facing surfaces look like one product

Both take their brand from the same decision, so an integrator sets a colour once rather than
maintaining two appearances that drift apart.

_Source:_ `docs/guides/build-the-admin-frontend.md`

## 4. The operator's application

The administrative surface is the part of SaaSiCat an integrating developer is least likely to
build themselves, so the example has to answer whether it is worth adopting. That question is
only answered by showing all of it, with the application's own vocabulary on it, and by
showing where an application can still overrule the platform.

### NAP-ADMIN-001 — An operator gets the complete administrative surface, not a demo subset

Discovery, catalogue, plans, bundles, tenants, users, audit, subscriptions and promotional
codes are all present and usable. A reader deciding whether the platform is enough for them
can see the whole of it.

_Source:_ `README.md`

### NAP-ADMIN-002 — An operator can see which capabilities the running application declared

The declarations the platform found at start-up are reviewable in the interface, which is
where the loop becomes visible to somebody who never reads the code.

_Source:_ `docs/tutorial/02-admin-ui.md`

### NAP-ADMIN-003 — An operator can suspend and reactivate a tenant, and the action is recorded

The two actions that change what a customer may do are available with a confirmation, and
they leave a trace an auditor can read afterwards.

_Source:_ current practice

### NAP-ADMIN-004 — An operator sees figures that belong to this application

The dashboard carries the application's own numbers beside the platform's, because what is
worth counting is an application decision and an integrator has to see how to contribute one.

_Source:_ current practice

### NAP-ADMIN-005 — An operator reads the application's own words, not the keys underneath them

Capabilities, allowances, columns and plan choices are shown with the names, descriptions and
icons the application gives them.

_Source:_ current practice

### NAP-ADMIN-006 — An operator can sign in, and signing out ends the session

Both halves work. A sign-out that leaves the operator signed in is a defect the example must
not model, because every integrator inherits the same seam.

_Source:_ current practice

### NAP-ADMIN-007 — An application can overrule a single platform operation and keep the rest

Where an application needs to do something of its own around one action, it wraps that action
and every neighbouring one still comes from the platform, unchanged and unmentioned.

_Source:_ ADR 0008

### NAP-ADMIN-008 — An operator can change the interface language and its light or dark appearance

Both are offered in the running example rather than described, so an integrator can see what
their own operators will get without building it first.

_Source:_ #137 · `docs/tutorial/02-admin-ui.md`

### NAP-ADMIN-009 — The demonstration data is complete enough to exercise every page

Every administrative page has something to show, the spread includes the awkward cases an
operator meets in practice, and nothing seeded is a state the product would refuse — a
demonstration record that could never be created is the one thing an integrator must not
copy.

_Source:_ #222 · #234

## 5. Learning from the example

A reference has to be checkable. A reader who cannot verify what the example claims has to
trust it, and trust is exactly what a stranger reading source-available code does not have to
give. This chapter is about the difference between an example that asserts and one that can
be confirmed.

### NAP-LEARN-001 — A reader can reproduce every claim with the commands the example prints

The observable behaviour — what is allowed, what is refused, and with which answer — is
accompanied by the commands that produce it and the responses they actually return.

_Source:_ `README.md`

### NAP-LEARN-002 — A reader is told where each concern is handled

The example names, for every part of the integration, the one place it lives, so a developer
looking for a specific answer does not have to read all of it.

_Source:_ `README.md`

### NAP-LEARN-003 — A reader is shown how to test their own integration

The example demonstrates the testing approach the documentation recommends, and it works
without a database, so a developer can copy a test as readily as they copy a module.

_Source:_ `docs/quickstart.md`

### NAP-LEARN-004 — Every stand-in names its replacement and what else changes with it

Where the example substitutes something a real application would do differently, it says what
to put there instead and how far the change reaches — most often not at all.

_Source:_ `README.md`

### NAP-LEARN-005 — Each guided path ends in something the reader can check

A tutorial finishes with an observable result rather than a claim of completion, so a reader
knows whether they succeeded.

_Source:_ `docs/README.md`

### NAP-LEARN-006 — The example says where to go after it

A reader who has understood the example is pointed at the next decisions — collecting real
payments, a different persistence technology, installing the published packages — instead of
being left at the end of a working demo.

_Source:_ `README.md`

### NAP-LEARN-007 — Where the example imposes an inconvenience, it names it

A cost a developer would otherwise discover by being confused — a rebuild that is required, a
port that must be free, a step whose order matters — is written down where they will meet it.

_Source:_ current practice

## 6. Where the demonstration stops

An example that pretends to be production is more dangerous than one that admits what it is
not: the parts it fakes are precisely the parts a reader would otherwise ship. This chapter
fixes what NotesApp must be explicit about not being, and it applies at every point of
contact, not once in a preface.

### NAP-LIMIT-001 — The example states unmistakably that its sign-in is not authentication

Identifying callers from a header is a demonstration device. A reader meets that statement
wherever they meet the mechanism, because the one who copies it is the one who did not read
the introduction.

_Source:_ `README.md`

### NAP-LIMIT-002 — Every demonstration-grade part names the production-grade choice

Where the example does something adequate for a demonstration and inadequate for customers,
it names what a real application uses instead.

_Source:_ current practice

### NAP-LIMIT-003 — The example collects no payments, and says what that does not change

A reader is told that adding payment collection later leaves the packaging and enforcement
model where it is, so nobody delays adopting the platform until a payment provider is chosen.

_Source:_ `README.md`

### NAP-LIMIT-004 — The example shows one of the two ways to hold a catalogue, and names the other

Plans can live in a file the application ships or in the catalogue an operator edits. The
example demonstrates one of them, and a reader can tell which one they are looking at and
that the alternative exists.

_Source:_ `docs/quickstart.md`

### NAP-LIMIT-005 — The example wires one persistence technology, and says what changes for the other

A developer using the other supported technology learns from the example what is the same for
them and what they have to do differently.

_Source:_ `README.md`

### NAP-LIMIT-006 — The example says that its own dependency arrangement is not the one to copy

Inside this repository the example consumes the platform from the workspace. A reader
building their own application is told to install the published packages instead.

_Source:_ `README.md`

## 7. Comprehensibility

SaaSiCat is source-available and read by strangers, and there is nobody for them to ask.
Anything not written in the code or beside it does not exist for the reader. For a reference
integration that makes comprehensibility the single most important property — ahead of
elegance, and ahead of being small.

### NAP-CLARITY-001 — A competent stranger gets through the example without asking anyone

Nothing in it depends on undocumented local setup, on a machine's particularities, or on
knowledge that exists only in the heads of the people who built the platform.

_Source:_ internal engineering guidelines

### NAP-CLARITY-002 — Everything a reader reads is English

Code, comments, messages, configuration and prose are in one language, because the audience is
an international developer community rather than the team that wrote it.

_Source:_ #150

### NAP-CLARITY-003 — A statement in the example is part of what it teaches

A comment, a heading or a printed response is read as the contract. A wrong one is a defect of
the same kind as wrong code, because it sends the next reader off with a false premise.

_Source:_ internal engineering guidelines

### NAP-CLARITY-004 — Where the example does something non-obvious, it says why

A reader who wonders why a thing is arranged the way it is finds the reason beside it, so they
can judge whether the same reason applies to them.

_Source:_ current practice

### NAP-CLARITY-005 — The example warns about mistakes that are easy to make and hard to diagnose

Where a plausible variation produces a failure that names the wrong cause, the example says so
in advance rather than leaving the reader to debug it.

_Source:_ current practice

### NAP-CLARITY-006 — A reader can tell the application's own code from the platform's

The boundary between what an integrator writes and what they receive is visible without
tracing imports, because that boundary is the thing being taught.

_Source:_ `README.md`

### NAP-CLARITY-007 — The example is held to the product's own standards, with no example discount

It builds, it typechecks, it is formatted and linted, its prose is checked, and its references
resolve, exactly as the shipped packages are. A reader may assume that what they copy is code
the project itself would accept.

_Source:_ current practice

## 8. The cost of integrating

The measure of this project is not how clean the platform is but how few moves an integrator
has to make. Every requirement here is a number somebody can check, because effort claims that
are not measured drift upwards without anybody deciding that they should.

### NAP-EFFORT-001 — Six actions take a developer from an existing backend to the working loop

From an application that already stores data per tenant to a discovered, packaged and enforced
capability is six actions, and no action hides further steps inside it.

_Source:_ `docs/quickstart.md`

### NAP-EFFORT-002 — The developer writes by hand only what nothing can guess

The wiring is generated. What remains for the developer is the substance: what their allowance
counts, and how their application recognises a caller.

_Source:_ `docs/quickstart.md`

### NAP-EFFORT-003 — The platform code an application owns stays small enough to read at once

A developer can hold the whole of their own platform-facing code in view — the documentation
puts it under a hundred lines, and this application is where that claim is measured.

_Source:_ `docs/quickstart.md`

### NAP-EFFORT-004 — Mounting a standard administrative page costs nothing

A page the platform provides is a route. Where the example still wraps one, the wrapper exists
because the application decides something — its wording, its plan choices, the actions its
operators get — and never merely to connect the page to its data.

_Source:_ ADR 0008

### NAP-EFFORT-005 — The administrative interface imposes no UI framework on the developer

The example's administrative application installs no user-interface framework of its own, so
an integrator inherits pages rather than a technology choice.

_Source:_ ADR 0011 · #207

### NAP-EFFORT-006 — Effort is measured on this application rather than asserted

Every figure the product quotes about integration cost is derived from the example as it
stands, so a reader can reproduce it and a regression in it is visible.

_Source:_ ADR 0011

## 9. Staying in step with the platform

An out-of-date reference is worse than none: it teaches the wrong integration to everybody who
reads it, and it does so with the full authority of running code. The requirements here are
about time — they say that the example is never allowed to lag, whatever else is under
pressure in a release.

### NAP-CURRENT-001 — A platform change is finished only once the example has followed it

Anything an integrator copies — the data model, the wiring, the tooling, the guidance — is not
done while the example still shows the previous shape of it.

_Source:_ current practice

### NAP-CURRENT-002 — The example's data model never falls behind the shipped one

Of every part of the platform's data model the example has adopted, it carries the current and
complete version. Leaving a part out entirely is a decision a reader can make too; carrying
half of one is not.

_Source:_ `.github/workflows/ci.yml`

### NAP-CURRENT-003 — A guided path and the example can never disagree

Where a tutorial prints code, that code is the example's code. Neither can be changed without
the other following.

_Source:_ current practice

### NAP-CURRENT-004 — The example is never exempted from a check to keep a build green

Excluding it would remove the very signal that tells the project when its reference has fallen
behind.

_Source:_ internal engineering guidelines

### NAP-CURRENT-005 — The example takes platform-owned files from the platform, not from a copy

Where the platform ships something an application applies — a constraint, a migration — the
example applies the shipped file. A file the platform owns cannot drift from itself, and a
copy silently can.

_Source:_ current practice

### NAP-CURRENT-006 — The example performs the upgrade it asks consumers to perform

When the platform requires an upgrade step from existing installations, the example carries out
the same step in the same order, so the instruction is demonstrated and not merely written.

_Source:_ `docs/guides/upgrade-to-1.0.md`

## 10. Security

The example is a demonstration, and it is also the first security architecture many integrators
will ever see for this platform. Both are true at once, which is why it has to be honest about
the parts it fakes and rigorous about the parts a reader will keep.

### NAP-SEC-001 — A caller without an identity gets nothing

Every application route refuses an unidentified caller. The demonstration relaxes who a caller
may claim to be, never whether they must be somebody.

_Source:_ `README.md`

### NAP-SEC-002 — Tenant separation is decided on the server from the caller's identity

Every tenant-scoped read and write takes its tenancy from the authenticated request context and
never from a parameter the caller supplies to the endpoint — which is what lets a developer
replace the demonstration sign-in with real authentication without touching a handler.

_Source:_ current practice · internal engineering guidelines

### NAP-SEC-003 — Checking incoming data is the consuming application's job

The platform cannot validate requests in an application that has not asked it to. The example
shows the developer installing that check themselves, because without it the platform's own
declared constraints are silently inert in their application.

_Source:_ internal engineering guidelines

### NAP-SEC-004 — Administrative endpoints are guarded on the server

An endpoint that only an operator may reach says so on the server. A control the interface does
not draw is not a permission, and the example does not model it as one.

_Source:_ current practice

### NAP-SEC-005 — The example contains no real secret

The credentials in it are demonstration credentials, announced as such wherever they appear,
and the file holding a developer's own settings is not part of the repository.

_Source:_ internal engineering guidelines

### NAP-SEC-006 — The example never teaches a shortcut that would destroy data in production

Where a convenient option would make a failure go away by discarding data, the example refuses
it and explains why, rather than leaving a reader to copy the convenient answer.

_Source:_ #236

### NAP-SEC-007 — Password storage is a replaceable seam with a named production choice

The example stores passwords in a way that is honest about being demonstration-grade and names
what a real application should use instead.

_Source:_ current practice

## 11. Operation

A reference that does not start is not a reference. These requirements are about the first ten
minutes and about the tenth restart — the two moments where an example most often fails a
reader, and where a failure is read as a defect of the product rather than of the demonstration.

### NAP-OPS-001 — One command brings up the whole application

Database, backend, operator interface and customer interface come up together from a single
command, against a real database, with nothing to install first beyond a container runtime.

_Source:_ `docs/tutorial/04-going-live.md`

### NAP-OPS-002 — Starting it a second time is safe

Every step taken on start-up either does nothing on a second run or refuses with a sentence
saying why. Restarts, retried deployments and re-run pipeline steps are ordinary, and the
example must survive them the way a consumer's installation has to.

_Source:_ `CONTRIBUTING.md`

### NAP-OPS-003 — A reader can keep what they changed across restarts

Someone exploring the interface can stop the demonstration data from being restored, so their
own experiments survive a restart.

_Source:_ `README.md`

### NAP-OPS-004 — A step that cannot be applied safely refuses with a reason

Where the platform cannot know whether existing data still matters, the example stops with an
explanation naming the decision to be made — never with an unexplained failure from the
database.

_Source:_ #236 · `docs/guides/upgrade-to-1.0.md`

### NAP-OPS-005 — Every published address can be moved from one place

A developer whose machine already uses one of the default ports changes it in a single file,
and nothing else needs editing.

_Source:_ `README.md`

### NAP-OPS-006 — There is one truth about where the application's own backend listens

The operating description, the development tooling and the template a newcomer reads name the
same address. Two answers for one address is how an interface ends up talking to a different
application while reporting a sign-in problem.

_Source:_ current practice

### NAP-OPS-007 — Browser and API share an origin, so no cross-origin configuration is needed

The example does not ask a reader to configure anything about cross-origin requests, because
the arrangement it demonstrates removes the question.

_Source:_ `README.md`

### NAP-OPS-008 — A redeployed installation serves the new interface

Someone who rebuilds and restarts sees the version they just built, not a cached previous one.

_Source:_ current practice

### NAP-OPS-009 — The example runs without containers too, and says which settings belong to which way

A developer who prefers to run the backend directly can, and the example separates the two
setups clearly enough that the plausible mixture of them cannot be assembled by accident.

_Source:_ `README.md`
