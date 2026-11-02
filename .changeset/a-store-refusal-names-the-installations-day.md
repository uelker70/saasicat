---
'@saasicat/core': minor
'@saasicat/nest': minor
---

A plan change that loses a race reads the installation's day, and never a 500

A store refuses a plan change whose target lost its version on sale between the
platform's check and the write (`NO_ACTIVE_PLAN_VERSION`). A store knows no
zone, so the refusal named the day in UTC, where the platform's own check names
the installation's. `PersistenceRefusal` now carries the moments behind the
values that are days (`dayMoments`, a new optional fifth argument, set by
`noActivePlanVersion`), and the platform answers such a refusal with each day
in the installation's zone, said to be a day in `dayParams`, its English
sentence naming the same day (`refusalBodyIn`, `SC-UI-028`). The refusal as the
store raises it is unchanged, so a persistence contract harness reads what it
read.

Scheduling a plan change, taking a version offer for the end of the term and
the early switch after a retirement answered a store's refusal — a subscription
gone meanwhile — with a 500. They now answer it as the check does, like every
other plan write (`SC-OPS-016`).
