---
'@saasicat/core': major
'@saasicat/nest': patch
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': patch
'@saasicat/persistence-testing': major
---

Keep the plan version a subscriber bought when a scheduled change only moves
the rhythm

A change of rhythm is scheduled for the period end, and when it came due both
adapters bound the subscription to the newest version of the plan — a new
price and new features the subscriber had not accepted, held by the contract
frozen after it. Moving a subscriber to a newer version is what accepting a
pending version is for (`SC-SUB-012`).

- `ImmediatePlanChangeInput` carries `keepsBoundVersion`, which the platform
  sets: `true` where a scheduled change comes due, `false` for a change of
  plan and for onboarding, which sell at the version in effect. A store keeps
  the version the subscription is bound to where the flag is set and the plan
  does not change; another plan is bound to its version in effect either way.
  A store of your own reads the flag; code that builds the input passes it.
- A version the write binds is no longer offered as pending: the subscriber is
  not asked to accept a version they are already on.
- The Prisma write claims the row only while it is bound to the version it
  read, so an acceptance landing between its read and its write is not
  written over; the caller is told the subscription changed. The Drizzle
  write already decides under a row lock.
- The persistence contract checks all three: a change of rhythm keeps the
  version, a sale binds the version in effect, and another plan is bound to
  its own whatever the flag says.
