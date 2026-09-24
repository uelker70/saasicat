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
- a contract written on a transaction is undone with it, and found by the offer it came from
- a checkout offer is consumed once, whoever asks first, and a consume on a rolled-back transaction
  leaves it open
- `findByTenantIdLocked` serializes concurrent transactions (row lock)
- concurrent `claimSlot` grants exactly `maxRedemptions` slots
- claim / exhaust / release lifecycle
- a slot held for a checkout counts against the limit beside the redemptions, however many
  checkouts race for it, and ends exactly once — released, expired, or turned into the
  redemption on the transaction it was handed over on and no other
- one promo redemption per subscription (unique guard)
- audit write → query roundtrip incl. `actorTag` wildcard filters
- MFA secret roundtrip
- a gateway event is claimed once per account, a session is confirmed once however many events
  report it, an event that changed nothing gives its session back while staying claimed itself, and
  a claim rolled back with its transaction is free for the retry
- a confirmed payment method replaces the one in use and keeps it as history, per subscriber
- a change of payment method a tenant started is completed once, and only for the account, session
  and subscriber it was started for
- the applied settings: one row per installation, replaced only by a writer that
  read its current fingerprint — so replicas starting together record one change,
  concurrently — with the change and the record it supersedes landing together;
  changes listed in the order they were recorded, acknowledged once

Scenario groups gate on declared capabilities and provided slices. A group the
capabilities rule out, such as the lock scenarios with `pessimisticLocking:
false`, reports as **skipped with reason**. A group whose port or seed writer
the harness does not provide **fails**, unless the adapter names it in `gaps` —
then it reports as skipped. A gap named there that the harness does provide
fails the suite, so the list stays true. A skipped scenario is easy to read
past in a green run; a harness that forgot to wire a port would otherwise pass
without checking it.

The list describes the harness as it is built, not the adapter package. Where a
port adds a member only under an option — `@saasicat/adapter-prisma`'s
`validityWindows` and `atomicOnboardingSelection`, off by default for a 0.6
schema — compute `gaps` from the same option rather than writing a constant, so
the declaration moves when the schema does.

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
    name: 'my-adapter @ postgres',
    create: async () => ({
        adapter: {
            capabilities: { transactions: true, pessimisticLocking: true /* … */ },
            transactionRunner,
            subscriptionRepository,
            planVersionRepository,
            planRepository,
            bundleRepository,
            subscriptionBundleRepository,
            tenantSubscriptionWrite,
            promoCodeRepository,
            promoCodeRedemptionRepository,
            promoCodeHoldRepository,
            promoSubscriptionLookup,
            mfa,
            audit,
            auditQuery,
            // Leave a part out and name it in `gaps` below; left out and not
            // named, its scenarios fail.
        },
        seed: {
            createPlanVersion,
            createSubscription,
            createBundleVersion,
            clearBookingRequestDate,
            setBookingCycle,
            createPromoCode,
        },
        reset: () => truncatePlatformTables(),
        close: () => pool.end(),
    }),
    // The parts this adapter deliberately does not provide. A part named here
    // that the harness does provide fails the suite as well.
    gaps: [
        'subscriptionContracts',
        'subscribers',
        'paymentEventLog',
        'subscriberPaymentMethods',
        'checkoutOffers',
        'appliedSettings',
    ],
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
