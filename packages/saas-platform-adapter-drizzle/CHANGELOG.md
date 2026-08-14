# @saasicat/adapter-drizzle

## 0.24.1

### Patch Changes

- @saasicat/types@0.24.1

## 0.24.0

### Patch Changes

- @saasicat/types@0.24.0

## 0.23.0

### Patch Changes

- @saasicat/types@0.23.0

## 0.22.2

### Patch Changes

- @saasicat/types@0.22.2

## 0.22.1

### Patch Changes

- @saasicat/types@0.22.1

## 0.22.0

### Patch Changes

- @saasicat/types@0.22.0

## 0.21.0

### Patch Changes

- @saasicat/types@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [6c0d40d]
    - @saasicat/types@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [0c17a83]
- Updated dependencies [b01eaa0]
- Updated dependencies [edfbdfe]
    - @saasicat/types@0.19.0

## 0.18.1

### Patch Changes

- @saasicat/types@0.18.1

## 0.18.0

### Patch Changes

- @saasicat/types@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [cbd1737]
    - @saasicat/types@0.17.0

## 0.16.0

### Patch Changes

- @saasicat/types@0.16.0

## 0.15.1

### Patch Changes

- @saasicat/types@0.15.1

## 0.15.0

### Patch Changes

- @saasicat/types@0.15.0

## 0.14.0

### Patch Changes

- @saasicat/types@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [362a1a7]
    - @saasicat/types@0.13.0

## 0.12.1

### Patch Changes

- @saasicat/types@0.12.1

## 0.12.0

### Patch Changes

- @saasicat/types@0.12.0

## 0.11.0

### Patch Changes

- @saasicat/types@0.11.0

## 0.10.1

### Patch Changes

- @saasicat/types@0.10.1

## 0.10.0

### Patch Changes

- @saasicat/types@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [b30a110]
    - @saasicat/types@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [1003a52]
    - @saasicat/types@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [05729ce]
    - @saasicat/types@0.7.0

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
