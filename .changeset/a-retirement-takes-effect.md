---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A retired version's subscriptions move to the replacement at their date

At the date each subscription was told, the platform moves it from the retired
version onto the replacement, at the replacement's price, keeping its period
and its term (`SC-SUB-031`). The quarter-hourly run that sends version notices
does it, and catches up a run that did not happen; with
`versionNotices.includeCron: false`, call `RetirementMoveService.moveDue`
yourself. A subscription that has ended by its date, or whose own scheduled
change takes it off the version by then, is left alone; a change scheduled for
later survives the move.

- **What a moved subscription pays.** A plan line of the retired version prices
  no period that starts on or after the date the subscriber was told: the period
  waits for the contract the move writes and is charged at the replacement's
  price, however late that contract comes (`SC-PRIC-062`). A contract a
  retirement writes adds no prorated difference.
- **Switching early.** Until the date, a subscriber may switch to the
  replacement at once from the plan section — `POST /billing/retirement/switch`,
  for the tenant's administrators, audited as `SWITCH_TO_RETIREMENT_REPLACEMENT`
  (`SC-SUB-032`). The term stays. Where the replacement costs more, the contract
  holds the difference as a discount line until the date, so the subscriber
  pays what they paid until then (`SC-PRIC-063`); where it costs the same or
  less, its price applies from the next period. The switch opens after a trial,
  not while a change is scheduled, and ends the right to cancel without notice.
  New codes: `RETIREMENT_SWITCH_NOT_PENDING`, `RETIREMENT_SWITCH_IN_TRIAL`,
  `RETIREMENT_SWITCH_NOT_OPEN`, `RETIREMENT_SWITCH_CHANGED`.
- **Ending a replacement.** A version subscriptions still move onto cannot be
  terminated before the day after the last of their dates:
  `PLAN_TERMINATE_BEFORE_RETIREMENT_MOVES` (`SC-PLAN-029`). While a move onto
  it is past its date and not made, it cannot be terminated at all:
  `PLAN_TERMINATE_WHILE_MOVES_OVERDUE`.
- **Audit.** Each move is recorded as `PLAN_VERSION_RETIREMENT_MOVE`, and a move
  that cannot be made once as `PLAN_VERSION_RETIREMENT_MOVE_FAILED`, by the new
  platform job actor: `AuditActor` is `AdminActor` or `PlatformJobActor`
  (`source: 'job'`, `userId: null`, tag `job:platform:retirement-moves`). An
  `AuditPort` of your own accepts a `null` user; the canonical
  `audit_logs.userId` already is nullable.
- **`TenantSubscriptionWritePort.changePlanImmediate`** takes
  `keepsPendingChange`: the scheduled change survives the write, and one that
  only moves the rhythm on the plan being left follows the subscription to its
  new plan (`scheduledChangeAfterWrite` in `@saasicat/core`). It also takes
  `restoresQuotedVersion`, which binds the version named whether or not it
  still takes bookings: a move or a switch whose contract cannot be written is
  put back with it, onto the retired version, which is off sale. Both shipped
  adapters honour both and the persistence contract holds them to it; a port of
  your own has to.
- **The plan cockpit** shows beside a retired version how many of its
  subscriptions moved, wait for their date, are overdue or ended
  (`SC-SUB-033`); `versionRetirements.list` answers `VersionRetirementView`
  with `progress`. The tenant usage carries `retirementSwitch`, and
  `useTenantBilling` gains `switchToReplacement`. New wording keys:
  `planDetail.versions.retiredProgress.*` and `versionRetiredSwitch*`.
