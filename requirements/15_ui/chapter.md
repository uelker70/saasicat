---
title: Working in the interface
---

The administration is an application SaaSiCat hands over; the tenant-facing pieces are guests in
somebody else's. This chapter says what a person can expect from either: that screens behave
alike, that failures appear where they were caused, and that nothing irreversible happens without
saying what it will do.

### SC-UI-001 — Every standard screen is built the same way

The same blocks in the same order, so a screen an integrator adds stands next to the shipped ones
without looking like a guest, and a person who has learned one screen has learned the rest.

_Source:_ ADR 0008 · `docs/explanation/design-guide.md`

### SC-UI-002 — Mounting a shipped screen costs no wiring

An application that needs one operation to behave differently replaces that one operation and
keeps the other nine. Before this, mounting one screen cost between 8 and 145 lines of glue with
no rule saying which.

_Source:_ ADR 0008

### SC-UI-003 — Replacing one operation that does not exist is refused at start-up

With the list of the ones that do. A typo in an override is otherwise a call that quietly keeps
the old behaviour until somebody notices an approval was never recorded.

_Source:_ release 0.26.0

### SC-UI-004 — Nothing is written until the person saves or publishes

Editors keep unsaved work across the steps of a wizard, and a step only moves on when the save
actually succeeded — a rejected save used to look exactly like a successful one.

_Source:_ release 1.0.0-rc.0

### SC-UI-005 — A failure appears where the person was looking

A page that could not load says so under its title; an action that failed inside an open dialog
says so in the dialog; only a failure with nothing on screen to attach to becomes a notification.
Never a notification for a failed load, and never one for something already visible.

_Source:_ `docs/explanation/design-guide.md`

### SC-UI-006 — What a person is shown after a failure is what the failing side said

Not the diagnostic that helps a developer find it. The two are kept apart deliberately, so a
stack-shaped message never reaches a screen.

_Source:_ release 0.26.0

### SC-UI-007 — Loading, empty and error are handled deliberately on every screen

Through the same shared elements rather than a variant per page.

_Source:_ `docs/explanation/design-guide.md` · internal engineering guidelines

### SC-UI-008 — Equivalent actions behave the same everywhere

Delete, save, cancel, edit, back, filter, search, pagination, confirmation and validation errors
work the same way on every screen unless there is a stated reason not to.

_Source:_ internal engineering guidelines

### SC-UI-009 — A destructive action says what it will destroy, by name

Not "Are you sure?" but "Delete API key 'Production Integration'? This action cannot be undone."

_Source:_ internal engineering guidelines

### SC-UI-010 — An action sits with the object it acts on

"Publish this version" does not share a footer with "delete this bundle and every version of it".
One releases a draft; the other destroys the thing.

_Source:_ release 1.0.0-rc.6

### SC-UI-011 — A list says how many rows there are, or says it is showing what it received

It does not present the number of rows in hand as a total it cannot know.

_Source:_ release 0.26.0

### SC-UI-012 — The interface works on desktop, tablet and phone

Every header control stays inside the viewport from the narrowest supported width. Where space
runs out, labels are dropped before controls are — nothing a person can press is removed. No
screen pushes the page sideways, except where horizontal scrolling is a deliberate part of a
component such as a wide table.

_Source:_ internal engineering guidelines · release 0.26.0

### SC-UI-013 — A tenant-facing section can be embedded without adopting a UI framework

The plan section, the upgrade wizard and the add-on store render inside the integrator's own
application. For a developer evaluating SaaSiCat, "you also need this UI framework" is not a line
item on the decision — it is the end of it. A component that is a guest in somebody else's product
does not bring a framework with it.

_Source:_ ADR 0010 · #206

### SC-UI-014 — The administration brings its own UI framework

It is the application SaaSiCat hands over and it owns its own page, so the integrator installs one
package and nothing else — no framework, no build plugin, no stylesheet compiler. The framework's
own global stylesheet stays an import the integrator writes, because bundling it would mean they
could no longer decline it.

_Source:_ ADR 0011 · #207

### SC-UI-015 — One colour makes the administration look like the integrator's product

The brand colour is a single value passed at start-up and it moves everything that follows from
it. Asking an integrator to restate the status colours as well is how those drifted: a scaffolded
warning colour once sat at 2.15:1 beside a platform role painting 4.8:1.

_Source:_ ADR 0011 · `docs/guides/upgrade-to-1.0.md`

### SC-UI-016 — Light and dark are both shipped, and a person can pick

Or follow whatever their system says. Two installations sharing one address do not inherit each
other's pick.

_Source:_ #137 · ADR 0009

### SC-UI-017 — A confirmation shows the answer to the question actually being asked

While a new answer is on its way, the previous one is not left on screen to be confirmed. A reader
could otherwise tick "I understand this happens on 1 January" and get something else, and the
screen and the invoice would describe different events.

_Source:_ #212

### SC-UI-018 — Where two answers are outstanding, the current question's answer wins

Not the one that happens to arrive last. A slower response is not necessarily the older one, and
prices resolved against a plan the tenant has since left are not stale — they are about a
different question.

_Source:_ #212

### SC-UI-019 — A row that opens is a control

Operable from the keyboard, announced as expandable, and controls inside its header do not toggle
it on the way past. The page decides which row is open, so opening one can close another and load
what it needs.

_Source:_ #133 · `docs/explanation/design-guide.md`

### SC-UI-020 — A page never takes the whole screen down because data arrived in a shape it did not expect

A malformed payload leaves a page that says so, not a blank content area beside a working shell.

_Source:_ release 0.24.1

### SC-UI-021 — A campaign that worked looks like a success, not a fault

A fully redeemed promotional code is shown as spent, not in the colour reserved for errors.

_Source:_ release 1.0.0-rc.0
