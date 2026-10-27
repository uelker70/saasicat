---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/ui-vue': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

The administration lists every contract of the installation

A new standard page, `contracts`, lists every contract, a former subscriber's
and a deleted tenant's included, the latest start first, fifty to a page,
narrowed to where the contracts stand on a day — today in the installation's
time zone unless the operator picks another: in force on it, ended before it,
starting after it, never in force, or all. Each names its subscriber as the
record names it now, its tenant or that the application no longer has it or
deleted it, the plan and add-ons it was concluded on, its first and last day,
its standing and its price, and opens in the subscriber's record with that
contract open (`/admin/subscribers/:id?contract=<id>`). The subscriptions page
says that it shows the current state per tenant and points to the register.

`GET admin/contracts` is new, served where a subscriber's contracts are, under
`contracts.read`. Nothing is stored and nothing is migrated: where a contract
stands is `contractStandingOn` in `@saasicat/core`, and a store answers the
moments `contractRegisterWindowOf` gives it, which the persistence contract
checks after every scenario. `SubscriptionContractRepository` gains
`listRegister` in both adapters and in `FakeSubscriptionContractRepository`; a
repository of your own adds it. `startOfDayInZone`, `CALENDAR_DAY_PATTERN` and
`contractInsideWindow` are new in `@saasicat/core`, and `useContractDossier`
gains `open`.
