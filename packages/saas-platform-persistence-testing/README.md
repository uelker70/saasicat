# @saasicat/persistence-testing

The executable persistence contract for SaaSicat adapters. One `node:test`
suite that every adapter (Prisma today, Drizzle/TypeORM tomorrow) must pass
**against a real database** — this is what makes "functionally equivalent
adapters" a verified claim instead of prose.

Verified scenarios:

- tenant subscription lookup + tenant isolation
- plan-version resolution (live vs. superseded vs. draft)
- `countByPlanVersionId` counts current AND pending bindings in one query
- transaction rollback discards writes
- `findByTenantIdLocked` serializes concurrent transactions (row lock)
- concurrent `claimSlot` grants exactly `maxRedemptions` slots
- claim / exhaust / release lifecycle
- one promo redemption per subscription (unique guard)
- audit write → query roundtrip incl. `actorTag` wildcard filters
- MFA secret roundtrip

Scenario groups gate on declared capabilities and provided slices; a
gated-off group reports as **skipped with reason** — coverage gaps stay
visible, never silent. Roadmap scenarios (subscription contracts, reference
migrations N→N+1) are registered as visible skips until the slices ship.

## Usage

```js
import { persistenceAdapterContract } from '@saasicat/persistence-testing';

persistenceAdapterContract({
    name: 'adapter-drizzle @ postgres',
    create: async () => ({
        adapter: {
            capabilities: { transactions: true, pessimisticLocking: true, /* … */ },
            transactionRunner,
            subscriptionRepository,
            planVersionRepository,
            promoCodeRepository,          // optional slices activate more scenarios
            promoCodeRedemptionRepository,
            mfa,
            audit,
            auditQuery,
        },
        seed: { createPlanVersion, createSubscription, createPromoCode },
        reset: () => truncatePlatformTables(),
        close: () => pool.end(),
    }),
});
```

Run the file with `node --test` and a disposable database. The kit tests
**resolved port instances** (DI-free); seeding is adapter-owned because
fixture writes are schema-specific. See
`@saasicat/adapter-prisma/tests-integration/` for the reference harness.

In-memory fakes must not be used to "verify" an adapter — they cannot
emulate lock semantics (declare `pessimisticLocking: false` and the lock
scenarios gate off, visibly).
