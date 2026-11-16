# ADR 0015 — The application erases a tenant; the platform decides when and keeps the proof

**Status:** accepted · **Date:** 2026-11-16

## Context

A tenant whose subscription ended is deleted on a day fixed when its end is recorded
([ADR 0012](0012-the-subscriber-owns-the-commercial-record.md), `SC-CANC-027`). What is deleted is
spread across stores only the application knows: its database, with tables SaaSiCat has never seen;
files in a bucket, found through rows of that database; perhaps a search index. SaaSiCat keeps rows
of its own about the tenant as well — its reasons, its end, the downloads of its export, its notices,
its audit entries — and the subscriber's commercial record, which must outlive the tenant
(`SC-PRIV-011`).

A deletion is irreversible, may take hours for a large file store, and runs while other instances of
the same application run beside it. It has to be provable afterwards, to the subscriber and to an
authority, without naming anybody (`SC-PRIV-023`), and it must not take the commercial record with
it. Both consumers had begun to write deletion runs of their own, each deciding the day, the order
and the proof differently.

## Decision

**The application erases; the platform decides when, guards and records.** The application lists
its stores as `TenantEraser`s — a stable name, `count(tenantId)` and `erase(tenantId)` — in the
order they are erased, and reports through a `TenantKeepReportPort` what the tenant has to keep for
obligations of its own. The platform finds the tenants whose day has come, asks the installation's
mark before anything begins (`SC-PRIV-021`), begins each deletion in one transaction with its record
and the `deleting` reason, has every store count before the first one erases, calls the stores in
turn, and closes the record once every store has confirmed.

- **A list, not a fixed pair of ports.** A list holds one store or five, in the order the
  application's data needs: files before the rows that find them. The record keeps each store's
  counts under its name.
- **What is already gone is done.** An eraser may be called again — a lost answer, a run repeated —
  and resolves for a tenant it no longer holds; a store too large for one call makes progress on
  each. The platform keeps no position inside a store: it calls again until the store confirms
  (`SC-PRIV-018`).
- **One tenant per call, asked twice.** The platform calls a store only with one tenant's
  identifier, and every eraser begins with `assertOneTenant` (`SC-PRIV-016`). The platform cannot
  check the second half in the application's code; it is a rule of the documentation, and the
  example's test holds the example's eraser to it.
- **The guard.** The platform counts the subscriber's commercial record before the first store and
  after each, and halts the deletion at the store that took any of it, naming it. It cannot prevent
  the loss — the store has erased by then — but it stops further stores and says which one to
  repair.
- **The platform's own rows lose their persons, not their facts.** The deletion closes in one
  transaction with the platform's rows of the tenant naming roles instead of persons, its reasons
  losing their notes and its notices their recipients; the audit entries naming the tenant are
  erased by the application's data store with the tenant's other rows, since the audit log is the
  application's table (`SC-AUD-021`).

## Alternatives considered

- **Two fixed ports, one for data and one for files.** Simple to explain, wrong for an application
  with a search index, a second database or no files at all, and silent on the order between them.
- **The platform deletes by itself**, from the tenant's row through foreign keys or from a list of
  tables configured. It would have to know the application's schema, which it does not, and a
  cascade it relied on would take whatever the application's keys reach — a contract with a
  cascading key included.
- **Deletion in parts reported back** (`erase` answering "not finished"). It would let the platform
  show progress inside a store, at the cost of a port every application has to implement in two
  states. Repeating an idempotent call gives the same result with one.
- **The application decides the day and calls the platform to record it.** Every application would
  then carry the rules the platform already holds for the day, the brake and the reminders, and two
  instances could each decide differently.

## Consequences

- `tenantBilling.subscriptionEnds.deletion.erasers` and `deletion.keep` are required wherever tenants
  are served; the record of each deletion is kept with the subscriber in three tables of
  `@saasicat/spec` (fragment 33).
- That every eraser asks `assertOneTenant` first stays prose: `SC-PRIV-016` holds for the platform's
  calls, and for the application's own code only as far as its tests hold it.
- The guard detects a lost commercial record after the store that lost it, not before. A halted
  deletion is not taken up again by any run.
- An application's own audit adapter has to store the tenant an entry names, or its data eraser
  finds nothing to erase there.
- Holds, ends and notices gain methods a persistence adapter of one's own implements, under the
  persistence contract.

## Migration

AutohausPro's own deletion run goes into its erasers: each store it deletes from becomes one, and
its scheduling and its proof go, since the platform decides the day and keeps the record. An
application without a deletion run writes its erasers new; the notes app shows one
(`examples/notesapp/src/saas/notes-data-eraser.ts`).

## What breaks if you ignore this

An eraser that does not begin with `assertOneTenant` erases every tenant's rows the first time it is
called with an identifier that is `undefined`, and nothing in the platform can see it. An eraser
that throws for a tenant already gone fails every run after a lost answer, and the tenant is never
closed. Listing the database before the files leaves the files with nothing that names them. A
foreign key that cascades from the tenant into a contract or an invoice takes the tax record along
on the first deletion; the guard halts the run and names the store, but the record is gone. An
application that deletes tenants in a run of its own beside the platform's deletes them twice, on
two days, with two proofs that disagree.
