---
'@saasicat/types': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
---

Thread the caller's `TransactionContext` through the entitlement lookup ports.

`EntitlementService.deriveLimits` used to call
`SubscriptionContractRepository.findActiveByTenantId`,
`SubscriptionBundleRepository.listActiveBySubscription` and
`BundleRepository.findVersionById` without the surrounding transaction. Inside
`enforceLimit` — which holds the subscription row lock in an interactive
transaction — every one of those lookups therefore had to draw an **extra**
pool connection. Once N parallel `enforceLimit` calls occupy N pool slots, the
lookups starve, nothing ever completes and all transactions expire
(observed in production-like load: 10 parallel creations at the limit against
the node-pg default pool of 10 → 0/10 succeed).

The three port methods now accept an optional trailing `tx?: TransactionContext`
(backward compatible — existing adapters keep working unchanged), the service
forwards its transaction, and the Prisma adapters query on the transaction
connection when it is provided.
