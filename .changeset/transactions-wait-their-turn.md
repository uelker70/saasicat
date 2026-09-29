---
'@saasicat/core': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
---

Bound how many of the platform's transactions hold a connection at once

Both transaction runners opened a transaction for every request that asked,
and the Prisma runner used Prisma's defaults. The platform's transactions take
row locks and then read further, so under a burst at a quota limit every
pooled connection could end up held by a transaction waiting for a read that
needed one, until Prisma's five-second `timeout` aborted them with `P2028`.

- `prismaPersistence({ transactions })` takes `maxConcurrent`, `timeout` and
  `maxWait`; `drizzlePersistence({ transactions })` takes `maxConcurrent`.
  Transactions beyond `maxConcurrent` wait in arrival order before they open.
  Your pool size minus five is a sound start. Unset, nothing changes.
- Wired by hand, the runners read the same options from
  `PRISMA_TRANSACTION_OPTIONS_TOKEN` and `DRIZZLE_TRANSACTION_OPTIONS_TOKEN`.
- `concurrencyGate` in `@saasicat/core` is the queue both runners use.
