# @saasicat/adapter-drizzle

## 0.6.0

### Minor Changes

- 0c08fc3: Remove the BusinessType catalog concept across the public contracts, NestJS
  modules, persistence adapters, UI, OpenAPI specification, and canonical database
  schema. Subscriptions now always reference a plan version; bundles remain the
  only composable catalog add-on.

### Patch Changes

- Updated dependencies [0c08fc3]
    - @saasicat/types@0.6.0

## 0.5.0

### Patch Changes

- @saasicat/types@0.5.0

## 0.4.0

### Minor Changes

- 9cf68f6: New package: the Drizzle + PostgreSQL persistence adapter — the proof that SaaSicat's ports are ORM-agnostic in practice, not just on paper.

    - `drizzlePersistence({ db })` bundle for `SaasPlatformModule.forRoot({ persistence })`, mirroring `prismaPersistence()` slice by slice (core incl. transaction runner and audit write/query/stats, entitlement with row-locked `findByTenantIdLocked`, promo repositories with atomic `claimSlot`/`releaseSlot`/`markExhaustedIfFull` as guarded UPDATE … RETURNING, SuperAdmin bootstrap, plan-catalog read/import sinks).
    - Driver-independent: typed against `PgDatabase` from `drizzle-orm/pg-core`, so node-postgres and postgres.js clients both work; row counts come from RETURNING instead of driver-specific result shapes.
    - Targets the same canonical schema (`@saasicat/spec` reference SQL) as adapter-prisma — ids and `updatedAt` are generated app-side to match Prisma's client-side behavior, enum columns are declared as text and coerced by Postgres.
    - Passes the identical `@saasicat/persistence-testing` contract against a real PostgreSQL (CI runs both adapters in the persistence-contract job), plus drizzle-specific interop tests for enum round-trips and the subscription CHECK constraint.

### Patch Changes

- @saasicat/types@0.4.0
