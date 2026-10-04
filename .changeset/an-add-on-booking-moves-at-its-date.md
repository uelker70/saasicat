---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/ui-vue': minor
---

An add-on booking moves at its retirement's date

A booking an add-on retirement told continues on the replacement at its date
(`SC-BUN-049`): a run every quarter of an hour moves it, keeping its period,
its terms and its rhythm, and writes the contract that charges it.

- **The move and its contract are one** (`SC-BUN-050`). The contract's line
  for the booking names the replacement, marked with the retirement. Where the
  contract cannot be written — `ContractFreezeSourcePort.loadBookedBundles`
  handing no line for the replacement included — the booking goes back onto
  the version retired, and the next run makes both. Each move is audited as
  `BUNDLE_VERSION_RETIREMENT_MOVE`, and one that cannot be made, once per
  process, as `BUNDLE_VERSION_RETIREMENT_MOVE_FAILED`, by the actor
  `job:platform:add-on-retirement-moves`.
- **Charges wait for the move.** The charge journal charges a booking's
  periods from its date at the replacement's price, from the line the move
  writes, however late it came, and a period before the date at the version
  retired. A booking that ended, or whose subscription did, before any move
  came is not moved: its periods from the date are charged at the version it
  ran on.
- **The promise holds** (`SC-BUN-051`). The move binds the replacement whatever
  its sale by then, and the add-on cannot be deleted while bookings still move
  onto one of its versions: `BUNDLE_DELETE_WHILE_RETIREMENT_MOVES_PENDING`,
  with `count` and `bundleKey`.
- **The operator sees why a notice waits** (`SC-BUN-052`, `SC-SUB-039`).
  Beside each retired version, plan and add-on alike, the ones not told yet
  are counted by what holds their notice back:
  `RetirementProgress.notToldReasons`, worded by the catalogue keys
  `common.retirementProgress.notToldBecause.*`. A booking that ended past its
  date before anything moved it counts as ended rather than overdue
  (`SC-BUN-053` supersedes `SC-BUN-047`).
- **Ports.** `SubscriptionBundleRepository.moveToVersion(id, from, to)` is
  optional and in both shipped adapters: it writes `to` only while the booking
  is on `from`, and answers `null` otherwise. A start with confirmed terms is
  refused without it, and the persistence contract gains the gap
  `bookingsMoved`. With `versionNotices.includeCron: false`, call
  `BundleRetirementMoveService.moveDue(new Date())` from your scheduler.
- **A booking's end** is read as `canceledEffectiveAt ?? canceledAt` by the
  charge journal too, as by every other reader: a booking on a row from before
  the two dates separated is no longer charged past its `canceledAt`.
