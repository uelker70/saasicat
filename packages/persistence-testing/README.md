# @saasicat/persistence-testing

## What this is

The executable persistence contract for SaaSiCat adapters. One `node:test`
suite that every adapter (Prisma and Drizzle ship today, TypeORM plugs into
the same harness) must pass **against a real database** — this is what makes
"functionally equivalent adapters" a verified claim instead of prose.

Verified scenarios:

- tenant subscription lookup + tenant isolation
- plan-version resolution (live vs. superseded vs. draft)
- semantic plan-key mapping at the port boundary
- atomic plan + `planVersionId` changes and tx-bound onboarding promo rollback
- PlanVersion and BundleVersion validity windows with auto-succession
- `countByPlanVersionId` counts current AND pending bindings in one query
- transaction rollback discards writes
- `findByTenantIdLocked` serializes concurrent transactions (row lock)
- concurrent `claimSlot` grants exactly `maxRedemptions` slots
- claim / exhaust / release lifecycle
- one promo redemption per subscription (unique guard)
- audit write → query roundtrip incl. `actorTag` wildcard filters
- MFA secret roundtrip
- the applied settings: one row per installation, replaced only by a writer that
  read its current fingerprint — so replicas starting together record one change,
  concurrently — with the change and the record it supersedes landing together;
  changes listed in the order they were recorded, acknowledged once

Scenario groups gate on declared capabilities and provided slices; a
gated-off group reports as **skipped with reason** — coverage gaps stay
visible, never silent. Roadmap scenarios (subscription contracts, reference
migrations N→N+1) are registered as visible skips until the slices ship.

## What this is not

Not a test framework and not a set of fixtures for your application. It is one
executable contract: the suite an adapter must pass before it can claim to
implement the ports.

Not runnable without a database. The semantics it checks — row locks, rollback,
atomic promo redemption, tenant isolation — are exactly the ones an in-memory
double cannot have, so it needs a real PostgreSQL and says so when it does not
find one.

## Usage

```js
import { persistenceAdapterContract } from '@saasicat/persistence-testing';

persistenceAdapterContract({
    name: 'adapter-drizzle @ postgres',
    create: async () => ({
        adapter: {
            capabilities: { transactions: true, pessimisticLocking: true /* … */ },
            transactionRunner,
            subscriptionRepository,
            planVersionRepository,
            promoCodeRepository, // optional slices activate more scenarios
            promoCodeRedemptionRepository,
            mfa,
            audit,
            auditQuery,
            tenantSubscriptionWrite, // optional: enables atomic plan-binding scenarios
            planRepository, // optional: enables plan lifecycle scenarios
            bundleRepository, // optional: enables bundle validity scenarios
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
`@saasicat/adapter-prisma/tests/integration/` for the reference harness.

In-memory fakes must not be used to "verify" an adapter — they cannot
emulate lock semantics (declare `pessimisticLocking: false` and the lock
scenarios gate off, visibly).

## Next

- [Ports and adapters](../../docs/explanation/adr/0007-ports-and-adapters.md) — what a port promises
- [Test coverage](../../docs/explanation/test-coverage.md) — what this contract reaches, and what it
  does not
