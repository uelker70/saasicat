# Test coverage, and what it does not cover

A percentage is not a risk assessment. This page says which parts of SaaSiCat
are exercised by which suite, what is left, and why that is acceptable — so that
someone deciding whether to depend on this can judge it, and someone changing it
knows where the net has holes.

Measured 2026-08-20. The numbers come from `pnpm run coverage`, which records
them in `coverage-baseline.json` and fails when they drop.

## What the numbers say

| Package                         | Lines               | Also covered by                       |
| ------------------------------- | ------------------- | ------------------------------------- |
| `@saasicat/ui-vue`              | 94.23%              | component suite, Playwright           |
| `@saasicat/spec`                | 94.90%              | —                                     |
| `@saasicat/nest`                | 87.72%              | —                                     |
| `create-saasicat-admin`         | 84.10%              | —                                     |
| `@saasicat/cli`                 | 83.76%              | end-to-end command runs               |
| `@saasicat/types`               | 80.41%              | codegen drift test                    |
| `@saasicat/adapter-prisma`      | 65.23% → **67.11%** | persistence contract, real PostgreSQL |
| `@saasicat/adapter-drizzle`     | 60.33% → **75.42%** | persistence contract, real PostgreSQL |
| `@saasicat/persistence-testing` | 74.30%              | it _is_ the contract                  |

Two of these need reading twice.

**The adapters have two numbers.** Their repository layer — the reason they
exist — is exercised by the persistence contract, which needs a real database
and therefore does not run in the same CI job as the coverage step. The first
number is the service-free suites alone; the second includes the contract. Both
are recorded and both are checked, the second one in the `persistence-contract`
job.

**`@saasicat/nest` measures its ESM output only.** The package also ships a
CommonJS bundle built from the same sources, which is nearly half of the built
lines and would otherwise be counted as a second, untested copy of code that is
tested. What the CommonJS build can break that ESM cannot — an export resolving
to two identities, a bundle missing a dependency — is checked by
`cjs-entry-identity.test.js` and `dist-is-self-contained.test.js` rather than by
line counts.

## What is not covered, by name

### `@saasicat/adapter-drizzle` — six of fourteen adapters

The contract exercises eight: audit write and query, MFA, plan versions, promo
codes, promo-code redemptions, subscriptions, and the transaction runner. These
six are not:

| Adapter                                   | What it does                                 | Risk if it is broken                                                                                                                  |
| ----------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DrizzlePlanCatalogImportSink`            | writes an imported plan catalogue            | An import fails or writes wrong rows. Operator-triggered, visible immediately, no silent data loss: the import runs in a transaction. |
| `DrizzlePlanCatalogReadSink`              | reads the catalogue back                     | The admin UI shows a stale or empty catalogue. Visible on the first page load.                                                        |
| `DrizzleSuperAdminBootstrapAdapter`       | creates the first operator                   | Setup fails at the one moment somebody is watching it.                                                                                |
| `DrizzleAuditStatsAdapter`                | aggregates audit rows for the dashboard      | A KPI card is wrong. No enforcement decision reads it.                                                                                |
| `DrizzlePromoCodeValidationLogRepository` | records rejected promo attempts              | A diagnostic trail is incomplete. Nothing depends on it.                                                                              |
| `DrizzlePromoSubscriptionLookup`          | resolves a subscription for promo validation | **The exception.** A wrong answer here can let a promo code apply where it should not.                                                |

The last row is the one worth acting on, and it is the reason this table exists
rather than a sentence saying "some adapters are not in the contract".

The equivalent Prisma adapters are covered for all but the same gaps — the
contract touches 12 of 25 exported classes there. `adapter-drizzle` trailing
`adapter-prisma` is a known and deliberate state, recorded in the project's
planning notes; this page names what the gap actually is.

### `@saasicat/persistence-testing` at 74.30%

This package _is_ the contract. Its uncovered lines are the assertions that only
run when an adapter fails a case — the error paths of a test harness. Covering
them would mean writing a deliberately broken adapter to fail against, which
tests the harness rather than the platform.

### `@saasicat/types` functions at 57.45%

Generated type guards. Most are never called by this repository's own code
because the types are used at compile time; a consumer validating untrusted
input calls them. The codegen drift test regenerates the whole file and fails on
any difference, which is a stronger guarantee than executing each guard once.

## Where the net is thinnest

Ranked by what a failure would cost, not by percentage:

1. **`DrizzlePromoSubscriptionLookup`** — the only uncovered adapter whose wrong
   answer has a money consequence rather than a display consequence.
2. **The `@saasicat/nest` branch figure (71.81%)** is the lowest of its three.
   Branches are conditions, and the conditions in a platform module are mostly
   "is this feature configured" — the shapes nobody runs are configurations
   nobody has yet.
3. **`create-saasicat-admin` at 84.10%** generates a project. Its failure mode
   is a file that does not compile, which the person running it sees at once.

## How to read a change to these numbers

The ratchet only fails on a drop. A rise needs no explanation, a drop needs one
of two: tests for what changed, or a recorded reason with
`pnpm run coverage:update`. There is no threshold to reach and none to argue
about — the only rule is that the number does not get worse without somebody
saying why.
